import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { promises as fs } from 'node:fs'
import { basename, join, relative } from 'node:path'
import type { PTNotesService } from '../service/PTNotesService'
import type { Schedule } from '@shared/planner'
import { buildDashboardSnapshot, buildActivityFromDates, buildRecentNotes } from '@shared/dashboard'
import type { DashboardSnapshot } from '@shared/dashboard'
import { defaultCalendar, formatDate } from '@shared/planner'

export function registerDashboardIpc(service: PTNotesService): void {
  ipcMain.handle(
    'dashboard:getSnapshot',
    async (_e: IpcMainInvokeEvent, project: string): Promise<DashboardSnapshot> => {
      const todayIso = formatDate(new Date())
      const ctx = service.dashboardContext(project)

      const [kanban, notes, scheduleMetas, calendar] = await Promise.all([
        service.loadKanban(project).catch(() => ({
          version: 1 as const,
          columns: [],
          cards: []
        })),
        service.listNotes(project).catch(() => []),
        service.listSchedules(project).catch(() => []),
        service.readCalendar(project).catch(() => defaultCalendar())
      ])

      const schedules: Schedule[] = []
      for (const meta of scheduleMetas) {
        const s = await service.readSchedule(project, meta.id)
        if (s) schedules.push(s)
      }

      const projectDir = ctx.projectDir
      const kanbanMtime = await statSafe(ctx.kanbanPath)

      const chatSessions = await service.listChatSessions(project).catch(() => [])
      const chatsUpdatedAt = chatSessions.slice(0, 10).map((c) => ({
        name: c.title || `Chat ${c.sessionId.slice(0, 7)}`,
        path: `chat/${c.sessionId}.json`,
        mtime: c.updatedAt
      }))

      const filesMtimes = await collectRecentFileMtimes(ctx.filesDir, ctx.filesDir, 20)

      const projectName = projectDir ? basename(projectDir) : project

      const recentNotes = buildRecentNotes(notes, 5)
      const activity = buildActivityFromDates(
        notes,
        kanbanMtime,
        schedules,
        filesMtimes,
        chatsUpdatedAt,
        8
      )

      const snapshot = buildDashboardSnapshot({
        projectId: project,
        projectName,
        kanban,
        schedules,
        notes,
        calendar,
        todayIso,
        kanbanUpdatedAt: kanbanMtime,
        filesMtimes: filesMtimes.slice(0, 12),
        chatsUpdatedAt: chatsUpdatedAt.slice(0, 6)
      })
      snapshot.recentNotes = recentNotes
      snapshot.activity = activity

      return snapshot
    }
  )
}

async function statSafe(path: string): Promise<number | null> {
  try {
    const s = await fs.stat(path)
    return s.mtimeMs
  } catch {
    return null
  }
}

interface FileMtimeEntry {
  name: string
  path: string
  mtime: number
}

async function collectRecentFileMtimes(
  rootDir: string,
  dir: string,
  limit: number
): Promise<FileMtimeEntry[]> {
  const out: FileMtimeEntry[] = []
  try {
    const entries = await fs.opendir(dir, { bufferSize: 32 })
    for await (const entry of entries) {
      const full = join(dir, entry.name)
      try {
        const s = await fs.stat(full)
        if (entry.isDirectory()) {
          const sub = await collectRecentFileMtimes(rootDir, full, limit)
          out.push(...sub)
        } else {
          out.push({
            name: entry.name,
            path: `files/${relative(rootDir, full)}`,
            mtime: s.mtimeMs
          })
        }
      } catch {
        // ignore single unreadable entries
      }
      if (out.length >= limit * 4) break
    }
  } catch {
    return []
  }
  out.sort((a, b) => b.mtime - a.mtime)
  return out.slice(0, limit)
}
