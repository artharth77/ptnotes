import React, { useEffect, useMemo, useState } from 'react'
import type { MermaidRenderResult } from '@shared/types'
import type {
  ActivityItem,
  DashboardSnapshot,
  OverdueItem,
  RecentNote,
  WorkloadPerAssignee
} from '@shared/dashboard'
import { useAppStore } from './store/useAppStore'
import { MdiIcon } from './components/MdiIcon'
import {
  mdiAccountGroupOutline,
  mdiAlertCircleOutline,
  mdiCalendarClockOutline,
  mdiChartDonut,
  mdiFileDocumentOutline,
  mdiFileImport,
  mdiHistory,
  mdiNotePlusOutline,
  mdiNotebookOutline,
  mdiPlusBoxMultipleOutline,
  mdiRocketLaunchOutline
} from '@mdi/js'

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

  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [workloadSvg, setWorkloadSvg] = useState<string | null>(null)
  const [kanbanPieSvg, setKanbanPieSvg] = useState<string | null>(null)

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
    })
    if (!snapshot) return
    void (async (): Promise<void> => {
      if (snapshot.workload.length) {
        const pieLines = snapshot.workload
          .slice(0, 10)
          .map((w) => `    "${w.owner}" : ${w.totalItems}`)
          .join('\n')
        const mermaid = `pie showData title Workload by Assignee\n${pieLines}\n`
        try {
          const out: MermaidRenderResult = await window.ptnotes.diagrams.render(mermaid)
          if (out.ok && out.svg) setWorkloadSvg(out.svg)
        } catch {
          // ignore chart errors; the table still renders
        }
      }
      if (snapshot.kanbanStats.rows.some((r) => r.count > 0)) {
        const pieLines = snapshot.kanbanStats.rows
          .filter((r) => r.count > 0)
          .map((r) => `    "${r.title.replace(/"/g, "'")}" : ${r.count}`)
          .join('\n')
        const mermaid = `pie showData title Kanban Status\n${pieLines}\n`
        try {
          const out: MermaidRenderResult = await window.ptnotes.diagrams.render(mermaid)
          if (out.ok && out.svg) setKanbanPieSvg(out.svg)
        } catch {
          // ignore chart errors; the summary still renders
        }
      }
    })()
  }, [snapshot])

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

  return (
    <div className="dashboard-page" key={activeProject}>
      <header className="dashboard-header">
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
              </h3>
              {snapshot.workload.length === 0 ? (
                <div className="widget-empty muted">No active assignees</div>
              ) : (
                <>
                  {workloadSvg ? (
                    <div
                      className="widget-chart"
                      dangerouslySetInnerHTML={{ __html: workloadSvg }}
                    />
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
                      {snapshot.workload.slice(0, 8).map((w) => (
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
              )}
            </div>

            <div className="dashboard-widget">
              <h3>
                <MdiIcon path={mdiChartDonut} size={16} /> Kanban Status
              </h3>
              <div className="widget-kpi-row">
                <div className="kpi">
                  <span className="kpi-value">{snapshot.kanbanStats.totalDone}</span>
                  <span className="kpi-label">Done</span>
                </div>
                <div className="kpi">
                  <span className="kpi-value">{snapshot.kanbanStats.totalActive}</span>
                  <span className="kpi-label">Active</span>
                </div>
                <div className="kpi">
                  <span className="kpi-value">{snapshot.kanbanStats.totalCards}</span>
                  <span className="kpi-label">Total</span>
                </div>
              </div>
              {kanbanPieSvg ? (
                <div className="widget-chart" dangerouslySetInnerHTML={{ __html: kanbanPieSvg }} />
              ) : snapshot.kanbanStats.rows.some((r) => r.count > 0) ? (
                <div className="widget-empty muted">Generating chart…</div>
              ) : (
                <div className="widget-empty muted">No kanban data yet</div>
              )}
              <ul className="widget-list kanban-legend">
                {snapshot.kanbanStats.rows
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
              </h3>
              {snapshot.recentNotes.length === 0 ? (
                <div className="widget-empty muted">No notes yet.</div>
              ) : (
                <ul className="widget-list notes-list">
                  {snapshot.recentNotes.map((n) => (
                    <li
                      key={n.id}
                      className="notes-item clickable"
                      onClick={() => {
                        void openNote(n)
                      }}
                    >
                      <MdiIcon path={mdiNotebookOutline} size={16} />
                      <div className="notes-main">
                        <div className="notes-title">
                          {n.name}
                          {n.starred && <span className="star">★</span>}
                        </div>
                        <div className="muted small mono">{agoTs(n.updatedAt)} ago</div>
                      </div>
                    </li>
                  ))}
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
