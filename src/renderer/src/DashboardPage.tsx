import React, { useEffect, useMemo, useState } from 'react'
import type { InfographicRenderResult } from '@shared/types'
import type {
  ActivityItem,
  DashboardSnapshot,
  OverdueItem,
  RecentNote,
  WorkloadPerAssignee
} from '@shared/dashboard'
import { useAppStore } from './store/useAppStore'
import { MdiIcon } from './components/MdiIcon'
import { useIsDarkTheme } from './useIsDarkTheme'
import {
  mdiAccountGroupOutline,
  mdiAlertCircleOutline,
  mdiArrowLeft,
  mdiCalendarClockOutline,
  mdiChartDonut,
  mdiFileDocumentOutline,
  mdiFileImport,
  mdiHistory,
  mdiNotePlusOutline,
  mdiNotebookOutline,
  mdiPlusBoxMultipleOutline,
  mdiRocketLaunchOutline,
  mdiStar
} from '@mdi/js'

const MOCK_NOW = typeof Date !== 'undefined' ? Date.now() : 0
const CHART_PIXEL_WIDTH = 720
const CHART_WIDTH = 720
const CHART_HEIGHT = 440

const darkPiePalette = [
  '#60a5fa',
  '#34d399',
  '#fbbf24',
  '#f87171',
  '#a78bfa',
  '#22d3ee',
  '#fb923c',
  '#f472b6'
]
const lightPiePalette = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#06b6d4',
  '#f97316',
  '#ec4899'
]

const antvThemeConfig = (dark: boolean, fontSizeStep: number): Record<string, unknown> => ({
  baseFontSize: 16 + fontSizeStep,
  labelFontSize: 18 + fontSizeStep,
  axisFontSize: 15 + fontSizeStep,
  legendFontSize: 16 + fontSizeStep,
  titleFontSize: 22 + fontSizeStep,
  titleFontWeight: 600,
  subtitleFontSize: 14 + fontSizeStep,
  annotationFontSize: 15 + fontSizeStep,
  colors: dark ? darkPiePalette : lightPiePalette,
  backgroundColor: dark ? 'transparent' : 'transparent',
  textColor: dark ? '#f2f4f7' : '#1f2937',
  labelColor: dark ? '#d1d5db' : '#111827',
  subTextColor: dark ? '#9ca3af' : '#6b7280',
  borderColor: dark ? 'rgba(255,255,255,0.08)' : '#e5e7eb',
  splitLineColor: dark ? 'rgba(255,255,255,0.08)' : '#e5e7eb',
  axisLineColor: dark ? 'rgba(255,255,255,0.12)' : '#d1d5db'
})

const fontSizeStepFor = (size: 'small' | 'default' | 'large' | 'xlarge'): number =>
  size === 'small' ? -1 : size === 'large' ? 2 : size === 'xlarge' ? 4 : 0

const mockWorkloadRows: WorkloadPerAssignee[] = [
  {
    owner: 'Alice (Frontend)',
    kanbanCards: 4,
    kanbanStoryPoints: 13,
    plannerTasks: 3,
    totalItems: 7,
    bucket: 'medium'
  },
  {
    owner: 'Bob (Backend)',
    kanbanCards: 2,
    kanbanStoryPoints: 8,
    plannerTasks: 5,
    totalItems: 7,
    bucket: 'medium'
  },
  {
    owner: 'Carol (Design)',
    kanbanCards: 1,
    kanbanStoryPoints: 2,
    plannerTasks: 2,
    totalItems: 3,
    bucket: 'low'
  },
  {
    owner: 'Dan (QA)',
    kanbanCards: 5,
    kanbanStoryPoints: 5,
    plannerTasks: 1,
    totalItems: 6,
    bucket: 'medium'
  },
  {
    owner: '(unassigned)',
    kanbanCards: 2,
    kanbanStoryPoints: 0,
    plannerTasks: 1,
    totalItems: 3,
    bucket: 'low'
  }
]

const mockKanbanRows: (import('@shared/dashboard').KanbanPieRow & {})[] = [
  { columnId: 'todo', title: 'To Do', color: '#a0aec0', count: 8, isDone: false },
  { columnId: 'in-progress', title: 'In Progress', color: '#4299e1', count: 5, isDone: false },
  { columnId: 'review', title: 'In Review', color: '#9f7aea', count: 2, isDone: false },
  { columnId: 'done', title: 'Done', color: '#2f855a', count: 6, isDone: true }
]

const recentNotesMockup: (RecentNote & { mock: true; snippet: string })[] = [
  {
    id: 'welcome-to-ptnotes',
    name: '👋 Welcome to PTNotes',
    updatedAt: MOCK_NOW - 1000 * 60 * 12,
    createdAt: MOCK_NOW - 1000 * 60 * 60 * 48,
    starred: true,
    snippet:
      'Get started quickly: create notes with markdown, plan sprints in Kanban, and schedule tasks in Planner. AI chat assistant is one click away via Ask AI.',
    mock: true
  },
  {
    id: 'product-specs-v2',
    name: 'Product Specs — Dashboard v2',
    updatedAt: MOCK_NOW - 1000 * 60 * 60 * 2,
    createdAt: MOCK_NOW - 1000 * 60 * 60 * 72,
    starred: false,
    snippet:
      'P0 Scope: 6 core widgets (Workload table + pie, Kanban status, Overdue triage, Planner health gradient, Activity feed, Recent notes) + 5 Quick Actions. P1: Filters, save-as-template, export PNG.',
    mock: true
  },
  {
    id: 'sprint-42-retro',
    name: 'Sprint 42 — Retro notes',
    updatedAt: MOCK_NOW - 1000 * 60 * 60 * 26,
    createdAt: MOCK_NOW - 1000 * 60 * 60 * 200,
    starred: false,
    snippet:
      'What went well: Kanban comment sync landed; user flow for planner import from CSV is 3× faster. Improve: shorten PR cycle time; add smoke tests for the note editor.',
    mock: true
  },
  {
    id: 'rest-api-docs',
    name: 'REST API Docs — auth & webhooks',
    updatedAt: MOCK_NOW - 1000 * 60 * 60 * 50,
    createdAt: MOCK_NOW - 1000 * 60 * 60 * 240,
    starred: true,
    snippet:
      'POST /oauth/token, scopes read/write/admin. Webhook signature uses HMAC-SHA256 of timestamp + body with the app secret. Retry policy: 3× exponential backoff up to 60s.',
    mock: true
  },
  {
    id: 'q4-roadmap-planning',
    name: 'Q4 Roadmap — planning notes',
    updatedAt: MOCK_NOW - 1000 * 60 * 60 * 80,
    createdAt: MOCK_NOW - 1000 * 60 * 60 * 300,
    starred: false,
    snippet:
      'Themes: (1) shared dashboard MVP polish + exports, (2) offline mobile shell via PWA, (3) native calendar 2-way sync with Outlook/Google. Capacity: 3 devs × 12 weeks — ~36 story pts/week.',
    mock: true
  }
]

function agoTs(ts: number): string {
  const diff = Math.max(0, Date.now() - ts)
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  const mo = Math.floor(d / 30)
  return `${mo}mo ago`
}

function activityIcon(kind: ActivityItem['kind']): string {
  switch (kind) {
    case 'note':
      return mdiNotebookOutline
    case 'kanban':
      return mdiPlusBoxMultipleOutline
    case 'planner':
      return mdiCalendarClockOutline
    case 'files':
      return mdiFileDocumentOutline
    case 'chat':
      return mdiRocketLaunchOutline
  }
}

function severityLabel(sev: OverdueItem['severity']): string {
  if (sev === 'overdue') return 'Overdue'
  if (sev === 'today') return 'Today'
  return 'Upcoming'
}

function severityBadgeClass(sev: OverdueItem['severity']): string {
  if (sev === 'overdue') return 'badge badge-overdue'
  if (sev === 'today') return 'badge badge-today'
  return 'badge badge-upcoming'
}

function workloadBucketClass(bucket: WorkloadPerAssignee['bucket']): string {
  if (bucket === 'high') return 'pill pill-high'
  if (bucket === 'medium') return 'pill pill-medium'
  return 'pill pill-low'
}

export function DashboardPage(): React.JSX.Element {
  const activeProject = useAppStore((s) => s.activeProject)
  const setTab = useAppStore((s) => s.setTab)
  const selectNote = useAppStore((s) => s.selectNote)
  const selectSchedule = useAppStore((s) => s.selectSchedule)
  const createNote = useAppStore((s) => s.createNote)
  const setChatOpen = useAppStore((s) => s.setChatOpen)
  const setRightView = useAppStore((s) => s.setRightView)
  const restoreLastTab = useAppStore((s) => s.restoreLastTab)
  const fontSize = useAppStore((s) => s.fontSize)
  const isDark = useIsDarkTheme()

  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [workloadSvg, setWorkloadSvg] = useState<string | null>(null)
  const [kanbanPieSvg, setKanbanPieSvg] = useState<string | null>(null)
  const [workloadChartErr, setWorkloadChartErr] = useState<string | null>(null)
  const [kanbanChartErr, setKanbanChartErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!activeProject) {
      queueMicrotask(() => {
        if (!cancelled) {
          setSnapshot(null)
          setLoading(false)
        }
      })
      return
    }
    void (async (): Promise<void> => {
      setLoading(true)
      setLoadError(null)
      try {
        const snap = await window.ptnotes.dashboard.getSnapshot(activeProject)
        if (!cancelled) setSnapshot(snap)
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activeProject])

  useEffect(() => {
    queueMicrotask(() => {
      setWorkloadSvg(null)
      setKanbanPieSvg(null)
      setWorkloadChartErr(null)
      setKanbanChartErr(null)
    })
    const workloadRows = snapshot?.workload.length ? snapshot.workload : mockWorkloadRows
    const kanbanRows = snapshot?.kanbanStats.rows.some((r) => r.count > 0)
      ? snapshot.kanbanStats.rows
      : mockKanbanRows
    const theme = isDark ? 'dark' : 'light'
    const themeConfig = antvThemeConfig(isDark, fontSizeStepFor(fontSize))
    void (async (): Promise<void> => {
      if (workloadRows.length) {
        const values = workloadRows
          .slice(0, 10)
          .map((w) => ({ label: w.owner, value: w.totalItems }))
        const infographic = {
          template: 'chart-pie-donut-plain-text',
          theme,
          themeConfig,
          data: { values },
          width: CHART_WIDTH,
          height: CHART_HEIGHT,
          title: 'Workload by Assignee'
        }
        try {
          const out: InfographicRenderResult = await window.ptnotes.infographic.render(
            infographic,
            CHART_PIXEL_WIDTH
          )
          if (out.ok && out.svg) setWorkloadSvg(out.svg)
          else setWorkloadChartErr(out.error ?? 'Could not render')
        } catch (e) {
          setWorkloadChartErr(e instanceof Error ? e.message : String(e))
        }
      }
      if (kanbanRows.some((r) => r.count > 0)) {
        const values = kanbanRows
          .filter((r) => r.count > 0)
          .map((r) => ({ label: r.title, value: r.count }))
        const infographic = {
          template: 'chart-pie-donut-pill-badge',
          theme,
          themeConfig,
          data: { values },
          width: CHART_WIDTH,
          height: CHART_HEIGHT,
          title: 'Kanban Status'
        }
        try {
          const out: InfographicRenderResult = await window.ptnotes.infographic.render(
            infographic,
            CHART_PIXEL_WIDTH
          )
          if (out.ok && out.svg) setKanbanPieSvg(out.svg)
          else setKanbanChartErr(out.error ?? 'Could not render')
        } catch (e) {
          setKanbanChartErr(e instanceof Error ? e.message : String(e))
        }
      }
    })()
  }, [snapshot, isDark, fontSize])

  const sortedOverdue = useMemo<OverdueItem[]>(() => {
    if (!snapshot) return []
    return [...snapshot.overdue.overdue, ...snapshot.overdue.today, ...snapshot.overdue.upcoming]
  }, [snapshot])

  const openOverdue = (item: OverdueItem): void => {
    if (item.kind === 'kanban-card') {
      setTab('kanban')
    } else {
      if (item.scheduleId) {
        void selectSchedule(item.scheduleId)
      }
      setTab('planner')
    }
  }

  const openNote = async (note: RecentNote): Promise<void> => {
    await selectNote(note.id)
    setTab('notes')
  }

  const handleNewNote = async (): Promise<void> => {
    await createNote('Untitled Note')
    setTab('notes')
  }

  const handleAskAI = (): void => {
    setRightView('chat')
    setChatOpen(true)
  }

  const recentNotesToShow = snapshot?.recentNotes.length ? snapshot.recentNotes : recentNotesMockup
  const recentNotesIsMock = !snapshot?.recentNotes.length
  const workloadRows = snapshot?.workload.length ? snapshot.workload : mockWorkloadRows
  const workloadIsMock = !snapshot?.workload.length
  const kanbanRowsSnapshot = snapshot?.kanbanStats.rows ?? []
  const kanbanRows = kanbanRowsSnapshot.some((r) => r.count > 0)
    ? kanbanRowsSnapshot
    : mockKanbanRows
  const kanbanIsMock = !kanbanRowsSnapshot.some((r) => r.count > 0)
  const kanbanKPIs = kanbanIsMock
    ? {
        totalDone: kanbanRows.filter((r) => r.isDone).reduce((a, r) => a + r.count, 0),
        totalActive: kanbanRows.filter((r) => !r.isDone).reduce((a, r) => a + r.count, 0),
        totalCards: kanbanRows.reduce((a, r) => a + r.count, 0)
      }
    : snapshot!.kanbanStats

  return (
    <div className="dashboard-page" key={activeProject}>
      <header className="dashboard-header">
        <div className="dashboard-header-title">
          <button
            className="btn ghost dashboard-back-btn"
            onClick={restoreLastTab}
            title="Back to previous tab"
          >
            <span className="btn-icon">
              <MdiIcon path={mdiArrowLeft} size={18} />
            </span>
          </button>
          <div>
            <h1>Dashboard</h1>
            <p className="muted">
              Project overview —{' '}
              {activeProject
                ? snapshot
                  ? `Generated ${new Date(snapshot.generatedAt).toLocaleString()}`
                  : 'Loading data…'
                : 'No project open'}
            </p>
          </div>
        </div>
        <div className="dashboard-stat-row">
          {snapshot && (
            <>
              <div className="stat">
                <span className="stat-value">{snapshot.kanbanStats.totalCards}</span>
                <span className="stat-label">Cards</span>
              </div>
              <div className="stat">
                <span className="stat-value">{snapshot.plannerHealth.totalTasks}</span>
                <span className="stat-label">Tasks</span>
              </div>
              <div className="stat">
                <span className="stat-value">{snapshot.overdue.total}</span>
                <span className="stat-label">Needs attention</span>
              </div>
              <div className="stat">
                <span className="stat-value">
                  {snapshot.plannerHealth.percentComplete.toFixed(1)}%
                </span>
                <span className="stat-label">Planner complete</span>
              </div>
            </>
          )}
        </div>
      </header>

      {loading && (
        <div className="dashboard-empty">
          <MdiIcon path={mdiHistory} size={22} /> Loading dashboard data…
        </div>
      )}
      {loadError && !snapshot && (
        <div className="dashboard-empty dashboard-warn">
          <MdiIcon path={mdiAlertCircleOutline} size={22} /> Failed to load snapshot: {loadError}
        </div>
      )}

      {!loading && snapshot && (
        <>
          <section className="dashboard-grid">
            <div className="dashboard-widget">
              <h3>
                <MdiIcon path={mdiAccountGroupOutline} size={16} /> Workload
                {workloadIsMock && (
                  <span className="muted small" style={{ marginLeft: 8 }}>
                    (sample preview — add cards/tasks to see real data)
                  </span>
                )}
              </h3>
              <>
                {workloadSvg ? (
                  <div className="widget-chart" dangerouslySetInnerHTML={{ __html: workloadSvg }} />
                ) : workloadChartErr ? (
                  <>
                    <div className="widget-empty dashboard-warn">
                      <MdiIcon path={mdiAlertCircleOutline} size={16} /> Chart unavailable:{' '}
                      {workloadChartErr}
                    </div>
                    <ul className="widget-list kanban-legend">
                      {workloadRows.slice(0, 8).map((w) => (
                        <li key={w.owner}>
                          <span className="color-swatch" />
                          <span className="legend-title">{w.owner}</span>
                          <span className="legend-count">{w.totalItems}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <div className="widget-empty muted">Generating chart…</div>
                )}
                <table className="widget-table widget-workload-table">
                  <thead>
                    <tr>
                      <th>Assignee</th>
                      <th>Cards</th>
                      <th>Tasks</th>
                      <th>SP</th>
                      <th>Load</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workloadRows.slice(0, 8).map((w) => (
                      <tr key={w.owner}>
                        <td className="owner">{w.owner}</td>
                        <td>{w.kanbanCards}</td>
                        <td>{w.plannerTasks}</td>
                        <td>{w.kanbanStoryPoints}</td>
                        <td>
                          <span className={workloadBucketClass(w.bucket)}>{w.bucket}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            </div>

            <div className="dashboard-widget">
              <h3>
                <MdiIcon path={mdiChartDonut} size={16} /> Kanban Status
                {kanbanIsMock && (
                  <span className="muted small" style={{ marginLeft: 8 }}>
                    (sample preview — create a Kanban board for real data)
                  </span>
                )}
              </h3>
              <div className="widget-kpi-row">
                <div className="kpi">
                  <span className="kpi-value">{kanbanKPIs.totalDone}</span>
                  <span className="kpi-label">Done</span>
                </div>
                <div className="kpi">
                  <span className="kpi-value">{kanbanKPIs.totalActive}</span>
                  <span className="kpi-label">Active</span>
                </div>
                <div className="kpi">
                  <span className="kpi-value">{kanbanKPIs.totalCards}</span>
                  <span className="kpi-label">Total</span>
                </div>
              </div>
              {kanbanPieSvg ? (
                <div className="widget-chart" dangerouslySetInnerHTML={{ __html: kanbanPieSvg }} />
              ) : kanbanChartErr ? (
                <>
                  <div className="widget-empty dashboard-warn">
                    <MdiIcon path={mdiAlertCircleOutline} size={16} /> Chart unavailable:{' '}
                    {kanbanChartErr}
                  </div>
                  <ul className="widget-list kanban-legend">
                    {kanbanRows
                      .filter((r) => r.count > 0)
                      .slice(0, 8)
                      .map((r) => (
                        <li key={r.columnId}>
                          <span
                            className="color-swatch"
                            style={{ background: r.isDone ? '#2f855a' : r.color }}
                          />
                          <span className="legend-title">{r.title}</span>
                          <span className="legend-count">{r.count}</span>
                        </li>
                      ))}
                  </ul>
                </>
              ) : kanbanRows.some((r) => r.count > 0) ? (
                <div className="widget-empty muted">Generating chart…</div>
              ) : (
                <div className="widget-empty muted">No kanban data yet</div>
              )}
              <ul className="widget-list kanban-legend">
                {kanbanRows
                  .filter((r) => r.count > 0)
                  .slice(0, 8)
                  .map((r) => (
                    <li key={r.columnId}>
                      <span
                        className="color-swatch"
                        style={{ background: r.isDone ? '#2f855a' : r.color }}
                      />
                      <span className="legend-title">{r.title}</span>
                      <span className="legend-count">{r.count}</span>
                    </li>
                  ))}
              </ul>
            </div>

            <div className="dashboard-widget">
              <h3>
                <MdiIcon path={mdiAlertCircleOutline} size={16} /> Overdue &amp; Upcoming
              </h3>
              {sortedOverdue.length === 0 ? (
                <div className="widget-empty muted">
                  Nothing overdue or upcoming in the next 7 days — nice!
                </div>
              ) : (
                <>
                  <div className="widget-kpi-row tight">
                    <span className={`pill pill-overdue`}>
                      Overdue {snapshot.overdue.overdue.length}
                    </span>
                    <span className={`pill pill-today`}>Today {snapshot.overdue.today.length}</span>
                    <span className={`pill pill-upcoming`}>
                      Upcoming {snapshot.overdue.upcoming.length}
                    </span>
                  </div>
                  <ul className="widget-list overdue-list">
                    {sortedOverdue.slice(0, 10).map((item) => (
                      <li
                        key={`${item.kind}-${item.id}`}
                        className="overdue-item clickable"
                        onClick={() => openOverdue(item)}
                      >
                        <div className="overdue-item-head">
                          <span className={`${severityBadgeClass(item.severity)}`}>
                            {severityLabel(item.severity)}
                          </span>
                          <span className="muted mono">{item.dueDate}</span>
                        </div>
                        <div className="overdue-title">{item.title}</div>
                        <div className="overdue-meta">
                          <span className="muted">
                            {item.kind === 'kanban-card'
                              ? `Card • ${item.columnTitle ?? ''}`
                              : `Task • ${item.scheduleName ?? ''}`}
                          </span>
                          {item.assignee && <span className="owner-chip">{item.assignee}</span>}
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>

            <div className="dashboard-widget dashboard-span-2">
              <h3>
                <MdiIcon path={mdiCalendarClockOutline} size={16} /> Planner Health
              </h3>
              {snapshot.plannerHealth.scheduleCount === 0 &&
              snapshot.plannerHealth.totalTasks === 0 ? (
                <div className="widget-empty muted">
                  No schedules yet — create one in the Planner tab.
                </div>
              ) : (
                <div className="planner-health">
                  <div className="widget-kpi-row">
                    <div className="kpi big">
                      <span className="kpi-value">
                        {snapshot.plannerHealth.percentComplete.toFixed(1)}%
                      </span>
                      <span className="kpi-label">Weighted complete</span>
                    </div>
                    <div className="kpi big">
                      <span className="kpi-value">{snapshot.plannerHealth.onTimeTasks}</span>
                      <span className="kpi-label">On time</span>
                    </div>
                    <div className="kpi big">
                      <span className="kpi-value">{snapshot.plannerHealth.lateTasks}</span>
                      <span className="kpi-label">Late active</span>
                    </div>
                    <div className="kpi big">
                      <span className="kpi-value">{snapshot.plannerHealth.ownerCount}</span>
                      <span className="kpi-label">Owners</span>
                    </div>
                  </div>
                  <div className="health-progress-bar" aria-hidden>
                    <div
                      className="health-progress-fill"
                      style={{
                        width: `${Math.max(0, Math.min(100, snapshot.plannerHealth.percentComplete))}%`
                      }}
                    />
                  </div>
                  <div className="health-grid">
                    <div className="health-cell">
                      <span className="muted">Schedules</span>
                      <strong>{snapshot.plannerHealth.scheduleCount}</strong>
                    </div>
                    <div className="health-cell">
                      <span className="muted">Tasks</span>
                      <strong>{snapshot.plannerHealth.totalTasks}</strong>
                    </div>
                    <div className="health-cell">
                      <span className="muted">Leaf tasks</span>
                      <strong>{snapshot.plannerHealth.totalLeafTasks}</strong>
                    </div>
                    <div className="health-cell">
                      <span className="muted">Critical path</span>
                      <strong>{snapshot.plannerHealth.criticalPathDays} d</strong>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="dashboard-widget dashboard-span-2">
              <h3>
                <MdiIcon path={mdiHistory} size={16} /> Recent Activity
              </h3>
              {snapshot.activity.length === 0 ? (
                <div className="widget-empty muted">No recent activity.</div>
              ) : (
                <ul className="widget-list activity-list">
                  {snapshot.activity.map((a) => (
                    <li key={`${a.kind}-${a.path}`} className="activity-item">
                      <span className="activity-icon">
                        <MdiIcon path={activityIcon(a.kind)} size={16} />
                      </span>
                      <div className="activity-main">
                        <div className="activity-title">
                          <span>{a.name}</span>
                          {a.detail && <span className="muted small">· {a.detail}</span>}
                        </div>
                        <div className="muted small mono">{a.path}</div>
                      </div>
                      <span className="muted small">{agoTs(a.updatedAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="dashboard-widget dashboard-span-2">
              <h3>
                <MdiIcon path={mdiNotebookOutline} size={16} /> Recent Notes
                {recentNotesIsMock && (
                  <span className="muted small" style={{ marginLeft: 8 }}>
                    (preview mockup — create notes to see yours)
                  </span>
                )}
              </h3>
              {recentNotesToShow.length === 0 ? (
                <div className="widget-empty muted">No notes yet.</div>
              ) : (
                <ul className="widget-list notes-list">
                  {recentNotesToShow.map((n) => {
                    const isMock = (n as { mock?: boolean }).mock
                    const snippet = (n as { snippet?: string }).snippet
                    return (
                      <li
                        key={n.id}
                        className={`notes-item ${isMock ? '' : 'clickable'}`}
                        onClick={() => {
                          if (isMock) return
                          void openNote(n)
                        }}
                      >
                        <MdiIcon path={mdiNotebookOutline} size={16} />
                        <div className="notes-main">
                          <div className="notes-title">
                            {n.name}
                            {n.starred && (
                              <span className="star">
                                <MdiIcon path={mdiStar} size={12} />
                              </span>
                            )}
                          </div>
                          {snippet ? (
                            <p className="notes-snippet muted small">{snippet}</p>
                          ) : (
                            <div className="muted small mono">{agoTs(n.updatedAt)} ago</div>
                          )}
                        </div>
                        {!snippet && (
                          <span className="muted small notes-ago">{agoTs(n.updatedAt)}</span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </section>

          <section className="dashboard-quick-actions">
            <h2>Quick Actions</h2>
            <div className="quick-actions-grid">
              <button className="qa-btn qa-note" onClick={() => void handleNewNote()}>
                <MdiIcon path={mdiNotePlusOutline} size={22} />
                <span className="qa-label">New Note</span>
              </button>
              <button className="qa-btn qa-card" onClick={() => setTab('kanban')}>
                <MdiIcon path={mdiPlusBoxMultipleOutline} size={22} />
                <span className="qa-label">New Card</span>
              </button>
              <button className="qa-btn qa-task" onClick={() => setTab('planner')}>
                <MdiIcon path={mdiCalendarClockOutline} size={22} />
                <span className="qa-label">New Task</span>
              </button>
              <button className="qa-btn qa-files" onClick={() => setTab('files')}>
                <MdiIcon path={mdiFileImport} size={22} />
                <span className="qa-label">Import Files</span>
              </button>
              <button className="qa-btn qa-ai" onClick={() => handleAskAI()}>
                <MdiIcon path={mdiRocketLaunchOutline} size={22} />
                <span className="qa-label">Ask AI</span>
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

export default DashboardPage
