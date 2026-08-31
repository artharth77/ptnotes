import {
  mdiAccountGroupOutline,
  mdiChatProcessingOutline,
  mdiCogOutline,
  mdiPuzzleOutline
} from '@mdi/js'
import { useAppStore } from '../store/useAppStore'
import { ProjectDropdown } from './ProjectDropdown'
import { MdiIcon } from './MdiIcon'

const NO_RUNS: never[] = []

export function TopBar(): React.JSX.Element {
  const chatOpen = useAppStore((s) => s.chatOpen)
  const moduleOpen = useAppStore((s) => s.moduleOpen)
  const botsOpen = useAppStore((s) => s.botsOpen)
  const chatBusy = useAppStore((s) => s.chatBusy)
  const activeProjectForBots = useAppStore((s) => s.activeProject)
  const activeBotGroupId = useAppStore((s) =>
    s.activeProject ? s.activeBotGroupId[s.activeProject] : null
  )
  const botGroupBusy = useAppStore((s) =>
    activeBotGroupId ? (s.botGroupBusy[activeBotGroupId] ?? false) : false
  )
  const botsBusy = !!activeProjectForBots && botGroupBusy
  const moduleRuns = useAppStore((s) =>
    s.activeProject ? (s.moduleRuns[s.activeProject] ?? NO_RUNS) : NO_RUNS
  )
  // Bot-task runs belong to the group chat's Tasks button, never the Module button.
  const modulesBusy = moduleRuns.some(
    (r) => r.module.id !== 'bot-task' && !['done', 'failed', 'cancelled'].includes(r.status)
  )
  const setRightView = useAppStore((s) => s.setRightView)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const sidebarVisible = useAppStore((s) => s.sidebarVisible)
  const setSidebarVisible = useAppStore((s) => s.setSidebarVisible)
  const activeProject = useAppStore((s) => s.activeProject)

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button
          className="btn ghost"
          onClick={() => setSidebarVisible(!sidebarVisible)}
          title={sidebarVisible ? 'Hide left panel' : 'Show left panel'}
        >
          <span className="btn-icon">
            {sidebarVisible ? (
              <svg
                className="sidebar-toggle-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M9 3v18" />
                <path d="m16 9-3 3 3 3" />
              </svg>
            ) : (
              <svg
                className="sidebar-toggle-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M9 3v18" />
                <path d="m14 9 3 3-3 3" />
              </svg>
            )}
          </span>
        </button>
        <span className="app-logo">PTNotes</span>
        <ProjectDropdown />
      </div>
      <div className="topbar-right">
        <button className="btn ghost" onClick={() => setSettingsOpen(true)} title="Settings">
          <span className="btn-icon">
            <MdiIcon path={mdiCogOutline} size={18} />
          </span>{' '}
          Settings
        </button>
        <div className="panel-view-toggle">
          <button
            className={`view-btn ${chatOpen ? 'active' : ''}`}
            onClick={() => setRightView('chat')}
            disabled={!activeProject}
            title="Toggle AI assistant (⌘⇧C)"
          >
            {chatBusy ? (
              <span className="topbar-chat-spinner" />
            ) : (
              <span className="btn-icon">
                <MdiIcon path={mdiChatProcessingOutline} size={16} />
              </span>
            )}{' '}
            Chat
          </button>
          <button
            className={`view-btn ${botsOpen ? 'active' : ''}`}
            onClick={() => setRightView('bots')}
            disabled={!activeProject}
            title="Toggle bot group chat"
          >
            {botsBusy ? (
              <span className="topbar-chat-spinner" />
            ) : (
              <span className="btn-icon">
                <MdiIcon path={mdiAccountGroupOutline} size={16} />
              </span>
            )}{' '}
            Groups
          </button>
          <button
            className={`view-btn ${moduleOpen ? 'active' : ''}`}
            onClick={() => setRightView('modules')}
            disabled={!activeProject}
            title={
              activeProject
                ? modulesBusy
                  ? 'Modules are running…'
                  : 'Toggle module panel (⌘⇧M)'
                : 'Open a project to use modules'
            }
          >
            {modulesBusy ? (
              <span className="topbar-chat-spinner" />
            ) : (
              <span className="btn-icon">
                <MdiIcon path={mdiPuzzleOutline} size={16} />
              </span>
            )}{' '}
            Module
          </button>
        </div>
      </div>
    </header>
  )
}
