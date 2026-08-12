import { mdiChatProcessingOutline, mdiCogOutline } from '@mdi/js'
import { useAppStore } from '../store/useAppStore'
import { ProjectDropdown } from './ProjectDropdown'
import { MdiIcon } from './MdiIcon'

export function TopBar(): React.JSX.Element {
  const chatOpen = useAppStore((s) => s.chatOpen)
  const chatBusy = useAppStore((s) => s.chatBusy)
  const setChatOpen = useAppStore((s) => s.setChatOpen)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const sidebarVisible = useAppStore((s) => s.sidebarVisible)
  const setSidebarVisible = useAppStore((s) => s.setSidebarVisible)

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
        <button
          className={`btn ghost ${chatOpen ? 'active' : ''}`}
          onClick={() => setChatOpen(!chatOpen)}
          title="Toggle AI assistant"
        >
          {chatBusy ? (
            <span className="topbar-chat-spinner" />
          ) : (
            <span className="btn-icon">
              <MdiIcon path={mdiChatProcessingOutline} size={18} />
            </span>
          )}{' '}
          Chat
        </button>
      </div>
    </header>
  )
}
