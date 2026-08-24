import { ipcMain, BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import type { IpcMainInvokeEvent } from 'electron'
import type { PTNotesService } from '../service/PTNotesService'
import { AIConfigStore } from '../ai/config'
import { ChatSession, isLocalEndpoint } from '../ai/chatSession'
import type { ToolsProvider, PromptSectionProvider } from '../ai/chatSession'
import { createClient } from '../ai/client'
import { AiTraceRecorder } from '../ai/trace'
import type {
  AIConfig,
  AIProviderConfig,
  AskAnswer,
  AskRequest,
  AskResponse,
  ChatMessage,
  ChatStreamEvent,
  ConfirmRequest,
  ConfirmResponse
} from '@shared/types'

const CONFIRM_TIMEOUT_MS = 180_000

export interface AskResult {
  answers: AskAnswer[]
  cancelled?: boolean
}

export interface SessionRegistry {
  getSession(event: IpcMainInvokeEvent, project: string): ChatSession
  clear(project: string): void
  stop(project: string): void
  respond(resp: ConfirmResponse): void
  askResponse(resp: AskResponse): void
}

export function createSessionRegistry(
  service: PTNotesService,
  configStore: AIConfigStore,
  toolsProvider?: ToolsProvider,
  promptSectionProvider?: PromptSectionProvider
): SessionRegistry {
  const sessions = new Map<string, ChatSession>()
  const pendingConfirms = new Map<
    string,
    { resolve: (approved: boolean) => void; timer: NodeJS.Timeout }
  >()
  const pendingAsks = new Map<string, { resolve: (res: AskResult) => void }>()

  return {
    getSession(event, project) {
      let session = sessions.get(project)
      if (!session) {
        const send = (evt: ChatStreamEvent): void => {
          const win = BrowserWindow.fromWebContents(event.sender)
          win?.webContents.send('ai:stream', evt)
        }
        session = new ChatSession(
          () => configStore.load(),
          {
            service,
            activeProject: project,
            confirm: (req: Omit<ConfirmRequest, 'id'>) => {
              const id = randomUUID()
              const timer = setTimeout(() => {
                const pending = pendingConfirms.get(id)
                if (!pending) return
                pendingConfirms.delete(id)
                pending.resolve(false)
              }, CONFIRM_TIMEOUT_MS)
              const promise = new Promise<boolean>((resolve) => {
                pendingConfirms.set(id, { resolve, timer })
              })
              send({ type: 'confirm', confirm: { id, ...req } })
              return promise
            },
            ask: (req: Omit<AskRequest, 'id'>) => {
              const id = randomUUID()
              const promise = new Promise<AskResult>((resolve) => {
                pendingAsks.set(id, { resolve })
              })
              send({ type: 'ask', ask: { id, ...req } })
              return promise
            }
          },
          send,
          toolsProvider,
          promptSectionProvider
        )
        sessions.set(project, session)
      }
      return session
    },
    clear(project) {
      sessions.delete(project)
    },
    stop(project) {
      sessions.get(project)?.stop()
    },
    respond(resp) {
      const pending = pendingConfirms.get(resp.id)
      if (!pending) return
      clearTimeout(pending.timer)
      pendingConfirms.delete(resp.id)
      pending.resolve(resp.approved)
    },
    askResponse(resp) {
      const pending = pendingAsks.get(resp.id)
      if (!pending) return
      pendingAsks.delete(resp.id)
      pending.resolve({ answers: resp.answers, cancelled: !!resp.cancelled })
    }
  }
}

export type ListModelsResult = string[] | { error: string }

/** Build a raw-AI-trace recorder for one chat session, appending to <project>/.data/chat/. */
export async function chatTraceRecorder(
  service: PTNotesService,
  project: string,
  sessionId: string
): Promise<AiTraceRecorder> {
  const meta = await service.chatTraceMeta(project, sessionId)
  return new AiTraceRecorder({
    project,
    key: sessionId,
    kind: 'chat',
    initialSeq: meta.count,
    hasSystem: meta.hasSystem,
    append: (header, lines) => service.appendChatTrace(project, sessionId, header, lines)
  })
}

export function registerAiIpc(
  registry: SessionRegistry,
  configStore: AIConfigStore,
  service: PTNotesService
): void {
  ipcMain.handle('ai:getConfig', async (): Promise<AIProviderConfig> => configStore.load())

  ipcMain.handle('ai:getProfiles', async (): Promise<AIConfig> => configStore.getAll())

  ipcMain.handle('ai:saveProfiles', async (_e, config: AIConfig): Promise<AIConfig> =>
    configStore.saveAll(config)
  )

  ipcMain.handle(
    'ai:listModels',
    async (_e, baseUrl: string, apiKey: string): Promise<ListModelsResult> => {
      if (!baseUrl) return { error: 'Base URL is required' }
      try {
        const client = createClient({ baseUrl, apiKey, model: '' })
        const res = await client.models.list()
        const ids = res.data
          .map((m) => m.id)
          .filter((id): id is string => typeof id === 'string')
          .sort()
        return ids
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  ipcMain.handle('ai:clear', async (_e, project: string): Promise<void> => {
    registry.clear(project)
  })

  ipcMain.handle(
    'ai:generateTitle',
    async (_e, _project: string, sessionId: string, firstMessage: string): Promise<string> => {
      const config = await configStore.load()
      if (!config.model) return ''
      if (!config.apiKey && !isLocalEndpoint(config.baseUrl)) return ''
      const prompt = [
        'You are PTNotes assistant. Write a concise, human-readable title (max 8 words, no quotes)',
        'for a chat conversation that begins with the following user message.',
        'Reply with the title only.',
        '',
        `User message: "${firstMessage.slice(0, 2000)}"`
      ].join('\n')
      const trace = await chatTraceRecorder(service, _project, sessionId)
      const startTs = Date.now()
      trace.append({
        role: 'user',
        ts: startTs,
        content: prompt
      })
      try {
        const client = createClient(config)
        const res = await client.chat.completions.create({
          model: config.model,
          messages: [
            { role: 'system', content: prompt },
            { role: 'user', content: firstMessage.slice(0, 2000) }
          ],
          max_tokens: 30,
          temperature: 0.4
        })
        const title = (res.choices?.[0]?.message?.content ?? '').trim()
        trace.append({
          role: 'assistant',
          ts: Date.now(),
          durationMs: Date.now() - startTs,
          model: config.model,
          baseUrl: config.baseUrl,
          endpoint: 'title',
          content: title,
          finishReason: res.choices?.[0]?.finish_reason,
          ...(res.usage ? { usage: res.usage } : {})
        })
        await trace.flush()
        return title
      } catch (err) {
        trace.append({
          role: 'assistant',
          ts: Date.now(),
          durationMs: Date.now() - startTs,
          model: config.model,
          baseUrl: config.baseUrl,
          endpoint: 'title',
          error: err instanceof Error ? err.message : String(err)
        })
        await trace.flush()
        return ''
      }
    }
  )

  ipcMain.handle('ai:stop', async (_e, project: string): Promise<void> => {
    registry.stop(project)
  })

  ipcMain.handle('ai:confirmResponse', async (_e, resp: ConfirmResponse): Promise<void> => {
    registry.respond(resp)
  })

  ipcMain.handle('ai:askResponse', async (_e, resp: AskResponse): Promise<void> => {
    registry.askResponse(resp)
  })

  ipcMain.handle(
    'ai:send',
    async (
      event: IpcMainInvokeEvent,
      project: string,
      sessionId: string,
      text: string,
      history?: ChatMessage[],
      activeNoteId?: string | null,
      activeScheduleId?: string | null
    ) => {
      const session = registry.getSession(event, project)
      const trace = await chatTraceRecorder(service, project, sessionId)
      await session.send(text, history, activeNoteId, activeScheduleId, trace)
    }
  )
}
