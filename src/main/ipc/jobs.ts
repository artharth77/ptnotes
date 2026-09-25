import { rpc, type InvokeCtx } from '../rpc/registry'

import type { AiTraceFile, ScheduleJob, ScheduleJobInput, ScheduleJobRun } from '@shared/types'
import type { JobsStore } from '../jobs/db'
import type { JobScheduler } from '../jobs/scheduler'

export function registerJobsIpc(store: JobsStore, scheduler: JobScheduler): void {
  rpc.handle('jobs:list', async (_e: InvokeCtx, project: string): Promise<ScheduleJob[]> => {
    store.reconcileRuns(project)
    return store.listJobs(project)
  })

  rpc.handle(
    'jobs:save',
    async (_e: InvokeCtx, project: string, input: ScheduleJobInput): Promise<ScheduleJob> =>
      store.saveJob(project, input)
  )

  rpc.handle(
    'jobs:moveScope',
    async (
      _e: InvokeCtx,
      src: string,
      dest: string,
      id: string,
      input: ScheduleJobInput
    ): Promise<ScheduleJob> => store.moveJobScope(src, dest, id, input)
  )

  rpc.handle(
    'jobs:setEnabled',
    async (_e: InvokeCtx, project: string, id: string, enabled: boolean): Promise<ScheduleJob> =>
      store.setJobEnabled(project, id, enabled)
  )

  rpc.handle('jobs:delete', async (_e: InvokeCtx, project: string, id: string): Promise<boolean> =>
    store.deleteJob(project, id)
  )

  rpc.handle('jobs:runNow', async (_e: InvokeCtx, project: string, id: string) => {
    scheduler.runNow(project, id)
  })

  rpc.handle(
    'jobs:runs',
    async (
      _e: InvokeCtx,
      project: string,
      jobId: string,
      limit?: number
    ): Promise<ScheduleJobRun[]> => store.listRuns(project, jobId, limit ?? 5)
  )

  rpc.handle(
    'jobs:readTrace',
    async (_e: InvokeCtx, project: string, runId: string): Promise<AiTraceFile | null> =>
      store.readRunTraceByRunId(project, runId)
  )
}
