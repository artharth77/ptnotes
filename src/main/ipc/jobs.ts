import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import type { AiTraceFile, ScheduleJob, ScheduleJobInput, ScheduleJobRun } from '@shared/types'
import type { JobsStore } from '../jobs/db'
import type { JobScheduler } from '../jobs/scheduler'

export function registerJobsIpc(store: JobsStore, scheduler: JobScheduler): void {
  ipcMain.handle(
    'jobs:list',
    async (_e: IpcMainInvokeEvent, project: string): Promise<ScheduleJob[]> => {
      store.reconcileRuns(project)
      return store.listJobs(project)
    }
  )

  ipcMain.handle(
    'jobs:save',
    async (
      _e: IpcMainInvokeEvent,
      project: string,
      input: ScheduleJobInput
    ): Promise<ScheduleJob> => store.saveJob(project, input)
  )

  ipcMain.handle(
    'jobs:setEnabled',
    async (
      _e: IpcMainInvokeEvent,
      project: string,
      id: string,
      enabled: boolean
    ): Promise<ScheduleJob> => store.setJobEnabled(project, id, enabled)
  )

  ipcMain.handle(
    'jobs:delete',
    async (_e: IpcMainInvokeEvent, project: string, id: string): Promise<boolean> =>
      store.deleteJob(project, id)
  )

  ipcMain.handle('jobs:runNow', async (_e: IpcMainInvokeEvent, project: string, id: string) => {
    scheduler.runNow(project, id)
  })

  ipcMain.handle(
    'jobs:runs',
    async (
      _e: IpcMainInvokeEvent,
      project: string,
      jobId: string,
      limit?: number
    ): Promise<ScheduleJobRun[]> => store.listRuns(project, jobId, limit ?? 5)
  )

  ipcMain.handle(
    'jobs:readTrace',
    async (_e: IpcMainInvokeEvent, project: string, runId: string): Promise<AiTraceFile | null> =>
      store.readRunTraceByRunId(project, runId)
  )
}
