import { rpc, type InvokeCtx } from '../rpc/registry'

import type { AiTraceFile, AskAnswer, ModuleRun } from '@shared/types'
import type {
  BotProfile,
  BotUpsertInput,
  GroupChatData,
  GroupChatMeta,
  GroupMessagePageOpts,
  GroupPatch,
  NewGroupInput
} from '@shared/bots'
import type { GroupChatManager } from '../bots/orchestrator'
import type { BotsStore } from '../bots/db'
import type { ModuleRunManager } from '../modules/runs'

export function registerBotsIpc(
  store: BotsStore,
  manager: GroupChatManager,
  moduleManager: ModuleRunManager
): void {
  // ---- bot library (global) ----
  rpc.handle('bots:listBots', async (): Promise<BotProfile[]> => store.listBots())

  rpc.handle('bots:saveBot', async (_e: InvokeCtx, input: BotUpsertInput) => {
    store.saveBot(input)
    return store.listBots()
  })

  rpc.handle('bots:deleteBot', async (_e: InvokeCtx, id: string) => {
    return store.deleteBot(id)
  })

  rpc.handle('bots:getUserName', async (): Promise<string> => store.getUserName())

  rpc.handle('bots:setUserName', async (_e: InvokeCtx, name: string) =>
    store.setUserName(String(name ?? ''))
  )

  rpc.handle('bots:listMemories', async (_e: InvokeCtx, project: string, botId?: string) =>
    store.listMemories(project, botId)
  )

  rpc.handle(
    'bots:deleteMemory',
    async (_e: InvokeCtx, project: string, botId: string, memoryId: string) =>
      store.deleteMemory(project, botId, memoryId)
  )

  // ---- group chats (per project) ----
  rpc.handle(
    'bots:listGroups',
    async (_e: InvokeCtx, project: string): Promise<GroupChatMeta[]> => {
      // Drop task-queue rows left running by a previous crash/quit before showing anything.
      store.reconcileQueue(project)
      manager.reconcileAsks(project)
      return store.listGroups(project)
    }
  )

  rpc.handle(
    'bots:readGroup',
    async (
      _e: InvokeCtx,
      project: string,
      groupId: string,
      opts?: GroupMessagePageOpts
    ): Promise<GroupChatData | null> => store.readGroup(project, groupId, opts)
  )

  rpc.handle(
    'bots:createGroup',
    async (_e: InvokeCtx, project: string, input: NewGroupInput): Promise<GroupChatMeta> =>
      store.createGroup(project, input)
  )

  rpc.handle(
    'bots:updateGroup',
    async (
      _e: InvokeCtx,
      project: string,
      groupId: string,
      patch: GroupPatch
    ): Promise<GroupChatMeta> => store.updateGroup(project, groupId, patch)
  )

  rpc.handle(
    'bots:deleteGroup',
    async (_e: InvokeCtx, project: string, groupId: string): Promise<boolean> => {
      manager.stop(project, groupId)
      manager.cancelAsksForGroup(project, groupId)
      return store.deleteGroup(project, groupId)
    }
  )

  rpc.handle(
    'bots:clearGroupMessages',
    async (_e: InvokeCtx, project: string, groupId: string): Promise<void> =>
      manager.clearGroupHistory(project, groupId)
  )

  rpc.handle(
    'bots:askResponse',
    async (
      _e: InvokeCtx,
      project: string,
      groupId: string,
      messageId: string,
      answers: AskAnswer[],
      cancelled: boolean
    ): Promise<boolean> => manager.resolveBotAsk(project, groupId, messageId, answers, cancelled)
  )

  // ---- orchestration ----
  rpc.handle('bots:send', async (_e: InvokeCtx, project: string, groupId: string, text: string) => {
    await manager.send(project, groupId, text)
  })

  rpc.handle('bots:stop', (_e: InvokeCtx, project: string, groupId: string) => {
    manager.stop(project, groupId)
  })

  // ---- background bot tasks ----
  rpc.handle('bots:listTasks', async (_e: InvokeCtx, project: string): Promise<ModuleRun[]> => {
    const runs = await moduleManager.list(project)
    return runs.filter((r) => r.module.id === 'bot-task')
  })

  rpc.handle(
    'bots:clearTaskHistory',
    async (_e: InvokeCtx, project: string, deleteOutputFiles = false): Promise<number> => {
      const runs = await moduleManager.list(project)
      const terminal = runs.filter(
        (r) => r.module.id === 'bot-task' && ['done', 'failed', 'cancelled'].includes(r.status)
      )
      let removed = 0
      for (const run of terminal) {
        if (await moduleManager.deleteRun(project, run.runId, deleteOutputFiles)) removed++
      }
      return removed
    }
  )

  rpc.handle(
    'bots:readTrace',
    async (_e: InvokeCtx, project: string, groupId: string): Promise<AiTraceFile | null> =>
      store.readGroupTrace(project, groupId)
  )
}
