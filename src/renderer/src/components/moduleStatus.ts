import type { ModuleRun } from '@shared/types'

export const STATUS_LABELS: Record<ModuleRun['status'], string> = {
  queued: 'Queued',
  planning: 'Planning',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled'
}
