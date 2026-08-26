import type { ModuleRun, ToolCallInfo } from '@shared/types'

export const STATUS_LABELS: Record<ModuleRun['status'], string> = {
  queued: 'Queued',
  planning: 'Planning',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled'
}

/** Live subagent/chat tool-call states shown while a call has no result yet. */
export const TOOL_STATE_LABELS: Record<string, string> = {
  receiving: 'receiving…',
  queued: 'queued',
  running: 'running…'
}

/** Display state for a tool call: final (ok/fail) or transient lifecycle. */
export function toolDisplayState(tc: ToolCallInfo): string {
  return tc.ok === true ? 'ok' : tc.ok === false ? 'fail' : (tc.status ?? 'interrupted')
}
