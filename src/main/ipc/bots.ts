import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import type { AiTraceFile, ModuleRun } from '@shared/types'
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
  ipcMain.handle('bots:listBots', async (): Promise<BotProfile[]> => store.listBots())

  ipcMain.handle('bots:saveBot', async (_e: IpcMainInvokeEvent, input: BotUpsertInput) => {
    store.saveBot(input)
    return store.listBots()
  })

  ipcMain.handle('bots:deleteBot', async (_e: IpcMainInvokeEvent, id: string) => {
    return store.deleteBot(id)
  })

  ipcMain.handle(
    'bots:listMemories',
    async (_e: IpcMainInvokeEvent, project: string, botId?: string) =>
      store.listMemories(project, botId)
  )

  ipcMain.handle(
    'bots:deleteMemory',
    async (_e: IpcMainInvokeEvent, project: string, botId: string, memoryId: string) =>
      store.deleteMemory(project, botId, memoryId)
  )

  // ---- group chats (per project) ----
  ipcMain.handle(
    'bots:listGroups',
    async (_e: IpcMainInvokeEvent, project: string): Promise<GroupChatMeta[]> => {
      // Drop task-queue rows left running by a previous crash/quit before showing anything.
      store.reconcileQueue(project)
      return store.listGroups(project)
    }
  )

  ipcMain.handle(
    'bots:readGroup',
    async (
      _e: IpcMainInvokeEvent,
      project: string,
      groupId: string,
      opts?: GroupMessagePageOpts
    ): Promise<GroupChatData | null> => store.readGroup(project, groupId, opts)
  )

  ipcMain.handle(
    'bots:createGroup',
    async (_e: IpcMainInvokeEvent, project: string, input: NewGroupInput): Promise<GroupChatMeta> =>
      store.createGroup(project, input)
  )

  ipcMain.handle(
    'bots:updateGroup',
    async (
      _e: IpcMainInvokeEvent,
      project: string,
      groupId: string,
      patch: GroupPatch
    ): Promise<GroupChatMeta> => store.updateGroup(project, groupId, patch)
  )

  ipcMain.handle(
    'bots:deleteGroup',
    async (_e: IpcMainInvokeEvent, project: string, groupId: string): Promise<boolean> => {
      manager.stop(project, groupId)
      return store.deleteGroup(project, groupId)
    }
  )

  ipcMain.handle(
    'bots:clearGroupMessages',
    async (_e: IpcMainInvokeEvent, project: string, groupId: string): Promise<void> => {
      manager.stop(project, groupId)
      await store.clearGroupMessages(project, groupId)
    }
  )

  // ---- orchestration ----
  ipcMain.handle(
    'bots:send',
    async (_e: IpcMainInvokeEvent, project: string, groupId: string, text: string) => {
      await manager.send(project, groupId, text)
    }
  )

  ipcMain.handle('bots:stop', (_e: IpcMainInvokeEvent, project: string, groupId: string) => {
    manager.stop(project, groupId)
  })

  // ---- background bot tasks ----
  ipcMain.handle(
    'bots:listTasks',
    async (_e: IpcMainInvokeEvent, project: string): Promise<ModuleRun[]> => {
      const runs = await moduleManager.list(project)
      return runs.filter((r) => r.module.id === 'bot-task')
    }
  )

  ipcMain.handle(
    'bots:clearTaskHistory',
    async (_e: IpcMainInvokeEvent, project: string, deleteOutputFiles = false): Promise<number> => {
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

  ipcMain.handle(
    'bots:readTrace',
    async (_e: IpcMainInvokeEvent, project: string, groupId: string): Promise<AiTraceFile | null> =>
      store.readGroupTrace(project, groupId)
  )
}
