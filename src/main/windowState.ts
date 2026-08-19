import { promises as fs } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { WindowState } from '@shared/types'

const STATE_FILE = 'window-state.json'

const DEFAULTS: WindowState = { width: 1280, height: 820 }

function isValidNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export class WindowStateStore {
  private readonly filePath: string

  constructor() {
    this.filePath = join(app.getPath('userData'), STATE_FILE)
  }

  async load(): Promise<WindowState> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<WindowState>
      const state: WindowState = {
        width: isValidNumber(parsed.width) ? parsed.width : DEFAULTS.width,
        height: isValidNumber(parsed.height) ? parsed.height : DEFAULTS.height
      }
      if (isValidNumber(parsed.x)) state.x = parsed.x
      if (isValidNumber(parsed.y)) state.y = parsed.y
      if (typeof parsed.isMaximized === 'boolean') state.isMaximized = parsed.isMaximized
      return state
    } catch {
      return { ...DEFAULTS }
    }
  }

  async save(state: WindowState): Promise<WindowState> {
    const next: WindowState = {
      width: isValidNumber(state.width) ? state.width : DEFAULTS.width,
      height: isValidNumber(state.height) ? state.height : DEFAULTS.height
    }
    if (isValidNumber(state.x)) next.x = state.x
    if (isValidNumber(state.y)) next.y = state.y
    if (typeof state.isMaximized === 'boolean') next.isMaximized = state.isMaximized
    await fs.writeFile(this.filePath, JSON.stringify(next, null, 2), {
      encoding: 'utf8',
      mode: 0o600
    })
    return next
  }
}
