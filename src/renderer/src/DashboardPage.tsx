import React, { useEffect, useMemo, useState } from 'react'
import type {
  ActivityItem,
  DashboardSnapshot,
  OverdueItem,
  RecentNote,
  WorkloadPerAssignee
} from '@shared/dashboard'
import { useAppStore } from './store/useAppStore'
import { MdiIcon } from './components/MdiIcon'
import { DonutChart } from './components/DonutChart'
import { useIsDarkTheme } from './useIsDarkTheme'
import {
  mdiAccountGroupOutline,
  mdiAlertCircleOutline,
  mdiArrowLeft,
  mdiCalendarClockOutline,
  mdiChartDonut,
  mdiFileDocumentOutline,
  mdiFolderOpenOutline,
  mdiHistory,
  mdiNotePlusOutline,
  mdiNotebookOutline,
  mdiPlusBoxMultipleOutline,
  mdiRocketLaunchOutline,
  mdiStar
} from '@mdi/js'

const fontSizeStepFor = (size: 'small' | 'default' | 'large' | 'xlarge'): number =>
  size === 'small' ? -1 : size === 'large' ? 2 : size === 'xlarge' ? 4 : 0

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
  const openNoteCreate = useAppStore((s) => s.openNoteCreate)
  const openPlannerCreate = useAppStore((s) => s.openPlannerCreate)
  const openKanbanCreate = useAppStore((s) => s.openKanbanCreate)
  const refreshKanban = useAppStore((s) => s.refreshKanban)
  const setChatOpen = useAppStore((s) => s.setChatOpen)
  const fontSize = useAppStore((s) => s.fontSize)
  const setRightView = useAppStore((s) => s.setRightView)
  const restoreLastTab = useAppStore((s) => s.restoreLastTab)
  const isDark = useIsDarkTheme()

  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [activeWorkload, setActiveWorkload] = useState<string | null>(null)
  const [activeKanban, setActiveKanban] = useState<string | null>(null)
  const [overdueFilter, setOverdueFilter] = useState<'all' | 'overdue' | 'today' | 'upcoming'>(
    'all'
  )

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

  const sortedOverdue = useMemo<OverdueItem[]>(() => {
    if (!snapshot) return []
    return [...snapshot.overdue.overdue, ...snapshot.overdue.today, ...snapshot.overdue.upcoming]
  }, [snapshot])

  const displayedOverdue = useMemo<OverdueItem[]>(() => {
    if (!snapshot) return []
    return overdueFilter === 'all' ? sortedOverdue : snapshot.overdue[overdueFilter]
  }, [sortedOverdue, overdueFilter, snapshot])

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

  const handleNewNote = (): void => {
    setTab('notes')
    window.setTimeout(() => openNoteCreate(), 340)
  }

  const handleNewPlanner = (): void => {
    setTab('planner')
    window.setTimeout(() => openPlannerCreate(), 340)
  }

  const handleNewCard = async (): Promise<void> => {
    if (!activeProject) return setTab('kanban')
    await refreshKanban()
    const firstColumnId = useAppStore.getState().kanban?.columns[0]?.id
    if (firstColumnId) {
      setTab('kanban')
      openKanbanCreate(firstColumnId)
    } else {
      setTab('kanban')
    }
  }

  const handleAskAI = (): void => {
    setRightView('chat')
    setChatOpen(true)
  }

  const recentNotesToShow = snapshot?.recentNotes ?? []
  const workloadRows = snapshot?.workload ?? []
  const kanbanRows = snapshot?.kanbanStats.rows ?? []
  const kanbanKPIs = snapshot
    ? snapshot.kanbanStats
    : { totalDone: 0, totalActive: 0, totalCards: 0 }

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
                <span className="stat-hint">
                  Total kanban cards in this project — manage them in the Kanban tab.
                </span>
              </div>
              <div className="stat">
                <span className="stat-value">{snapshot.plannerHealth.totalTasks}</span>
                <span className="stat-label">Tasks</span>
                <span className="stat-hint">
                  All planner tasks across every schedule in this project.
                </span>
              </div>
              <div className="stat">
                <span className="stat-value">{snapshot.overdue.total}</span>
                <span className="stat-label">Needs attention</span>
                <span className="stat-hint">
                  Kanban cards and planner tasks that are overdue, due today, or due within the next
                  7 days.
                </span>
              </div>
              <div className="stat">
                <span className="stat-value">
                  {snapshot.plannerHealth.percentComplete.toFixed(1)}%
                </span>
                <span className="stat-label">Planner complete</span>
                <span className="stat-hint">
                  Weighted completion of all planner leaf tasks — read-only rollup from children.
                </span>
              </div>
            </>
          )}
        </div>
      </header>

      <div className="dashboard-body">
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
                <>
                  {workloadRows.length === 0 ? (
                    <div className="widget-empty muted">
                      No kanban cards or planner tasks assigned yet.
                    </div>
                  ) : (
                    <DonutChart
                      isDark={isDark}
                      fontSizeStep={fontSizeStepFor(fontSize)}
                      data={workloadRows
                        .slice(0, 10)
                        .map((w) => ({ label: w.owner, value: w.totalItems }))}
                      centerLabel="Items"
                      activeKey={activeWorkload}
                      onActiveChange={setActiveWorkload}
                    />
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
                      {workloadRows.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="widget-empty muted">
                            No cards or tasks assigned yet.
                          </td>
                        </tr>
                      ) : (
                        workloadRows.slice(0, 8).map((w) => (
                          <tr
                            key={w.owner}
                            className={activeWorkload === w.owner ? 'active' : ''}
                            onMouseEnter={() => setActiveWorkload(w.owner)}
                            onMouseLeave={() => setActiveWorkload(null)}
                          >
                            <td className="owner">{w.owner}</td>
                            <td>{w.kanbanCards}</td>
                            <td>{w.plannerTasks}</td>
                            <td>{w.kanbanStoryPoints}</td>
                            <td>
                              <span className={workloadBucketClass(w.bucket)}>{w.bucket}</span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </>
              </div>

              <div className="dashboard-widget">
                <h3>
                  <MdiIcon path={mdiChartDonut} size={16} /> Kanban Status
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
                {kanbanRows.some((r) => r.count > 0) ? (
                  <DonutChart
                    isDark={isDark}
                    fontSizeStep={fontSizeStepFor(fontSize)}
                    data={kanbanRows
                      .filter((r) => r.count > 0)
                      .map((r) => ({
                        label: r.title,
                        value: r.count,
                        color: r.isDone ? '#2f855a' : r.color
                      }))}
                    centerLabel="Cards"
                    activeKey={activeKanban}
                    onActiveChange={setActiveKanban}
                  />
                ) : (
                  <div className="widget-empty muted">No kanban data yet</div>
                )}
                <ul className="widget-list kanban-legend">
                  {kanbanRows.slice(0, 8).map((r) => (
                    <li
                      key={r.columnId}
                      className={activeKanban === r.title ? 'active' : ''}
                      onMouseEnter={() => setActiveKanban(r.title)}
                      onMouseLeave={() => setActiveKanban(null)}
                    >
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
                      <button
                        type="button"
                        className={`pill pill-filter pill-overdue${
                          overdueFilter === 'overdue'
                            ? ' active'
                            : overdueFilter === 'all'
                              ? ''
                              : ' deactive'
                        }`}
                        onClick={() =>
                          setOverdueFilter(overdueFilter === 'overdue' ? 'all' : 'overdue')
                        }
                      >
                        Overdue {snapshot.overdue.overdue.length}
                      </button>
                      <button
                        type="button"
                        className={`pill pill-filter pill-today${
                          overdueFilter === 'today'
                            ? ' active'
                            : overdueFilter === 'all'
                              ? ''
                              : ' deactive'
                        }`}
                        onClick={() =>
                          setOverdueFilter(overdueFilter === 'today' ? 'all' : 'today')
                        }
                      >
                        Today {snapshot.overdue.today.length}
                      </button>
                      <button
                        type="button"
                        className={`pill pill-filter pill-upcoming${
                          overdueFilter === 'upcoming'
                            ? ' active'
                            : overdueFilter === 'all'
                              ? ''
                              : ' deactive'
                        }`}
                        onClick={() =>
                          setOverdueFilter(overdueFilter === 'upcoming' ? 'all' : 'upcoming')
                        }
                      >
                        Upcoming {snapshot.overdue.upcoming.length}
                      </button>
                    </div>
                    <ul className="widget-list overdue-list">
                      {displayedOverdue.slice(0, 10).map((item) => (
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
                      {displayedOverdue.length === 0 && (
                        <li className="widget-empty muted">No {overdueFilter} items.</li>
                      )}
                    </ul>
                  </>
                )}
              </div>
            </section>

            <div className="dashboard-masonry">
              <div className="dashboard-widget">
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
                        <span className="stat-hint">
                          Share of planner leaf-task weight that is already complete — On Hold tasks
                          are excluded from the denominator.
                        </span>
                      </div>
                      <div className="kpi big">
                        <span className="kpi-value">{snapshot.plannerHealth.onTimeTasks}</span>
                        <span className="kpi-label">On time</span>
                        <span className="stat-hint">
                          Active tasks whose planned finish date is not in the past.
                        </span>
                      </div>
                      <div className="kpi big">
                        <span className="kpi-value">{snapshot.plannerHealth.lateTasks}</span>
                        <span className="kpi-label">Late active</span>
                        <span className="stat-hint">
                          Active tasks past their planned finish date — not yet completed.
                        </span>
                      </div>
                      <div className="kpi big">
                        <span className="kpi-value">{snapshot.plannerHealth.ownerCount}</span>
                        <span className="kpi-label">Owners</span>
                        <span className="stat-hint">
                          Number of distinct people assigned to planner tasks in this project.
                        </span>
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
                        <span className="stat-hint">
                          Number of planner schedules in this project — create more in the Planner
                          tab.
                        </span>
                      </div>
                      <div className="health-cell">
                        <span className="muted">Tasks</span>
                        <strong>{snapshot.plannerHealth.totalTasks}</strong>
                        <span className="stat-hint">
                          All planner tasks across every schedule in this project.
                        </span>
                      </div>
                      <div className="health-cell">
                        <span className="muted">Leaf tasks</span>
                        <strong>{snapshot.plannerHealth.totalLeafTasks}</strong>
                        <span className="stat-hint">
                          Tasks without children — the ones that actually carry dates and completion
                          status.
                        </span>
                      </div>
                      <div className="health-cell">
                        <span className="muted">Critical path</span>
                        <strong>{snapshot.plannerHealth.criticalPathDays} d</strong>
                        <span className="stat-hint">
                          Longest chain of dependent planned tasks — the schedule cannot finish
                          sooner than this many working days.
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="dashboard-widget">
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

              <div className="dashboard-widget">
                <h3>
                  <MdiIcon path={mdiNotebookOutline} size={16} /> Recent Notes
                </h3>
                {recentNotesToShow.length === 0 ? (
                  <div className="widget-empty muted">No notes yet.</div>
                ) : (
                  <ul className="widget-list notes-list">
                    {recentNotesToShow.map((n) => (
                      <li
                        key={n.id}
                        className="notes-item clickable"
                        onClick={() => void openNote(n)}
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
                          <div className="muted small mono">{agoTs(n.updatedAt)} ago</div>
                        </div>
                        <span className="muted small notes-ago">{agoTs(n.updatedAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {!loading && snapshot && (
        <section className="dashboard-quick-actions">
          <div className="quick-actions-grid">
            <button className="qa-btn qa-note" onClick={handleNewNote}>
              <MdiIcon path={mdiNotePlusOutline} size={26} />
              <span className="qa-label">New Note</span>
            </button>
            <button className="qa-btn qa-card" onClick={() => void handleNewCard()}>
              <MdiIcon path={mdiPlusBoxMultipleOutline} size={26} />
              <span className="qa-label">New Card</span>
            </button>
            <button className="qa-btn qa-task" onClick={handleNewPlanner}>
              <MdiIcon path={mdiCalendarClockOutline} size={26} />
              <span className="qa-label">New Planner</span>
            </button>
            <button className="qa-btn qa-files" onClick={() => setTab('files')}>
              <MdiIcon path={mdiFolderOpenOutline} size={26} />
              <span className="qa-label">File Explorer</span>
            </button>
            <button className="qa-btn qa-ai" onClick={() => handleAskAI()}>
              <MdiIcon path={mdiRocketLaunchOutline} size={26} />
              <span className="qa-label">Ask AI</span>
            </button>
          </div>
        </section>
      )}
    </div>
  )
}

export default DashboardPage
