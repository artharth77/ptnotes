import { ipcMain, BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import type { IpcMainInvokeEvent } from 'electron'
import type { PTNotesService } from '../service/PTNotesService'
import { AIConfigStore } from '../ai/config'
import { ChatSession, isLocalEndpoint } from '../ai/chatSession'
import { createClient } from '../ai/client'
import type { AIProviderConfig, ChatStreamEvent, ConfirmResponse } from '@shared/types'

const CONFIRM_TIMEOUT_MS = 60_000

export function registerAiIpc(service: PTNotesService): void {
  const configStore = new AIConfigStore()
  const sessions = new Map<string, ChatSession>()
  const pendingConfirms = new Map<
    string,
    { resolve: (approved: boolean) => void; timer: NodeJS.Timeout }
  >()

  ipcMain.handle('ai:getConfig', async (): Promise<AIProviderConfig> => configStore.load())

  ipcMain.handle('ai:setConfig', async (_e, config: AIProviderConfig): Promise<AIProviderConfig> =>
    configStore.save(config)
  )

  ipcMain.handle('ai:clear', async (_e, project: string): Promise<void> => {
    sessions.delete(project)
  })

  ipcMain.handle(
    'ai:generateTitle',
    async (_e, _project: string, firstMessage: string): Promise<string> => {
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
        return (res.choices?.[0]?.message?.content ?? '').trim()
      } catch {
        return ''
      }
    }
  )

  ipcMain.handle('ai:stop', async (_e, project: string): Promise<void> => {
    sessions.get(project)?.stop()
  })

  ipcMain.handle('ai:confirmResponse', async (_e, resp: ConfirmResponse): Promise<void> => {
    const pending = pendingConfirms.get(resp.id)
    if (!pending) return
    clearTimeout(pending.timer)
    pendingConfirms.delete(resp.id)
    pending.resolve(resp.approved)
  })

  ipcMain.handle('ai:send', async (event: IpcMainInvokeEvent, project: string, text: string) => {
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
          confirm: (req) => {
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
          }
        },
        send
      )
      sessions.set(project, session)
    }
    await session.send(text)
  })
}
