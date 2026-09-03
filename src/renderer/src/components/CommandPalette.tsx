import { useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  mdiBrightness4,
  mdiCogOutline,
  mdiFolderOpenOutline,
  mdiMenu,
  mdiMessageTextOutline,
  mdiNoteEditOutline,
  mdiRefresh,
  mdiViewDashboardOutline,
  mdiViewGridOutline,
  mdiViewListOutline,
  mdiViewModuleOutline,
  mdiWeatherNight,
  mdiWeatherSunny
} from '@mdi/js'
import { useAppStore } from '../store/useAppStore'
import type { Tab } from '@shared/types'
import { MdiIcon } from './MdiIcon'

export type CommandPaletteAction = {
  id: string
  title: string
  subtitle?: string
  iconPath: string
  category: string
  run: () => void
}

type SettingsCategory =
  'storage' | 'ai' | 'modules' | 'about' | 'skills' | 'toolsets' | 'bots' | 'appearance'

function fuzzyMatch(haystack: string, needle: string): number | null {
  if (!needle) return 0
  const h = haystack.toLowerCase()
  const n = needle.toLowerCase()
  let score = 0
  let hIndex = 0
  let nIndex = 0
  let consecutive = 0
  while (hIndex < h.length && nIndex < n.length) {
    if (h[hIndex] === n[nIndex]) {
      consecutive += 1
      score += 1 + consecutive
      nIndex += 1
    } else {
      consecutive = 0
    }
    hIndex += 1
  }
  return nIndex === n.length ? score : null
}

function useActions(): CommandPaletteAction[] {
  const activeProject = useAppStore((s) => s.activeProject)
  const tab = useAppStore((s) => s.tab)
  const setTab = useAppStore((s) => s.setTab)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const setSettingsCategory = useAppStore((s) => s.setSettingsCategory)
  const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen)
  const setSidebarVisible = useAppStore((s) => s.setSidebarVisible)
  const sidebarVisible = useAppStore((s) => s.sidebarVisible)
  const setTheme = useAppStore((s) => s.setTheme)
  const theme = useAppStore((s) => s.theme)
  const createNote = useAppStore((s) => s.createNote)
  const newChat = useAppStore((s) => s.newChat)
  const refreshProjects = useAppStore((s) => s.refreshProjects)
  const refreshNotes = useAppStore((s) => s.refreshNotes)
  const createProject = useAppStore((s) => s.createProject)

  return useMemo<CommandPaletteAction[]>(() => {
    const closeAndRun = (fn: () => void): void => {
      setCommandPaletteOpen(false)
      fn()
    }
    const switchTab = (t: Tab, label: string, icon: string): CommandPaletteAction => ({
      id: `tab:${t}`,
      title: `Switch to ${label}`,
      subtitle: tab === t ? 'Currently active' : undefined,
      iconPath: icon,
      category: 'View',
      run: () => closeAndRun(() => setTab(t))
    })

    const openSettings = (
      category: SettingsCategory,
      label: string,
      icon: string
    ): CommandPaletteAction => ({
      id: `settings:${category}`,
      title: `Open ${label} Settings`,
      iconPath: icon,
      category: 'Settings',
      run: () =>
        closeAndRun(() => {
          setSettingsCategory(category)
          setSettingsOpen(true)
        })
    })

    const withProject: CommandPaletteAction[] = activeProject
      ? [
          {
            id: 'note:quick',
            title: 'Create Quick Note',
            subtitle: 'Uses timestamp as title',
            iconPath: mdiNoteEditOutline,
            category: 'Create',
            run: () =>
              closeAndRun(() => {
                const ts = new Date()
                  .toISOString()
                  .replace(/[-:.TZ]/g, '')
                  .slice(0, 14)
                void createNote(`Note ${ts}`)
              })
          },
          {
            id: 'notes:refresh',
            title: 'Refresh Notes',
            subtitle: activeProject,
            iconPath: mdiRefresh,
            category: 'Project',
            run: () => closeAndRun(() => void refreshNotes())
          },
          {
            id: 'chat:new',
            title: 'New AI Chat Session',
            subtitle: activeProject,
            iconPath: mdiMessageTextOutline,
            category: 'Create',
            run: () => closeAndRun(() => void newChat(activeProject))
          }
        ]
      : []

    const themeActions: CommandPaletteAction[] = [
      {
        id: 'theme:light',
        title: 'Use Light Theme',
        subtitle: theme === 'light' ? 'Currently active' : undefined,
        iconPath: mdiWeatherSunny,
        category: 'Appearance',
        run: () => closeAndRun(() => setTheme('light'))
      },
      {
        id: 'theme:dark',
        title: 'Use Dark Theme',
        subtitle: theme === 'dark' ? 'Currently active' : undefined,
        iconPath: mdiWeatherNight,
        category: 'Appearance',
        run: () => closeAndRun(() => setTheme('dark'))
      },
      {
        id: 'theme:system',
        title: 'Use System Theme',
        subtitle: theme === 'system' ? 'Currently active' : undefined,
        iconPath: mdiBrightness4,
        category: 'Appearance',
        run: () => closeAndRun(() => setTheme('system'))
      }
    ]

    const projectActions: CommandPaletteAction[] = [
      {
        id: 'project:blank',
        title: 'Create Untitled Project',
        iconPath: mdiFolderOpenOutline,
        category: 'Create',
        run: () =>
          closeAndRun(() => {
            const ts = new Date().toISOString().slice(0, 10)
            void createProject(`Project ${ts}`)
          })
      },
      {
        id: 'projects:refresh',
        title: 'Refresh Projects List',
        iconPath: mdiRefresh,
        category: 'Project',
        run: () => closeAndRun(() => void refreshProjects())
      }
    ]

    return [
      ...projectActions,
      ...withProject,
      switchTab('notes', 'Notes', mdiViewListOutline),
      switchTab('kanban', 'Kanban', mdiViewGridOutline),
      switchTab('planner', 'Planner', mdiViewDashboardOutline),
      switchTab('modules', 'Modules', mdiViewModuleOutline),
      {
        id: 'sidebar:toggle',
        title: sidebarVisible ? 'Hide Left Sidebar' : 'Show Left Sidebar',
        iconPath: mdiMenu,
        category: 'View',
        run: () => closeAndRun(() => setSidebarVisible(!sidebarVisible))
      },
      openSettings('storage', 'Storage', mdiCogOutline),
      openSettings('appearance', 'Appearance', mdiBrightness4),
      openSettings('ai', 'AI', mdiCogOutline),
      openSettings('modules', 'Modules', mdiCogOutline),
      openSettings('toolsets', 'Toolsets', mdiCogOutline),
      openSettings('skills', 'Skills', mdiCogOutline),
      openSettings('bots', 'Bots', mdiCogOutline),
      openSettings('about', 'About', mdiCogOutline),
      ...themeActions
    ]
  }, [
    activeProject,
    createNote,
    createProject,
    newChat,
    refreshNotes,
    refreshProjects,
    setSettingsCategory,
    setSettingsOpen,
    setSidebarVisible,
    setTab,
    setTheme,
    sidebarVisible,
    tab,
    theme,
    setCommandPaletteOpen
  ])
}

export function CommandPalette(): React.JSX.Element | null {
  const open = useAppStore((s) => s.commandPaletteOpen)
  const setOpen = useAppStore((s) => s.setCommandPaletteOpen)
  const query = useAppStore((s) => s.commandPaletteQuery)
  const setQuery = useAppStore((s) => s.setCommandPaletteQuery)
  const activeIndex = useAppStore((s) => s.commandPaletteActiveIndex)
  const setActiveIndex = useAppStore((s) => s.setCommandPaletteActiveIndex)
  const actions = useActions()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      const t = window.setTimeout(() => inputRef.current?.focus(), 0)
      return () => window.clearTimeout(t)
    }
    return undefined
  }, [open])

  const filtered = useMemo<Array<{ action: CommandPaletteAction; score: number }>>(() => {
    const out: Array<{ action: CommandPaletteAction; score: number }> = []
    for (const action of actions) {
      const hay = `${action.title} ${action.subtitle ?? ''} ${action.category}`
      const s = fuzzyMatch(hay, query)
      if (s !== null) out.push({ action, score: s })
    }
    out.sort((a, b) => b.score - a.score)
    return out
  }, [actions, query])

  const grouped = useMemo<
    Array<{ category: string; entries: Array<{ item: (typeof filtered)[number]; index: number }> }>
  >(() => {
    const order: string[] = []
    const byCat = new Map<string, Array<{ item: (typeof filtered)[number]; index: number }>>()
    filtered.forEach((item, index) => {
      const cat = item.action.category
      if (!byCat.has(cat)) {
        order.push(cat)
        byCat.set(cat, [])
      }
      byCat.get(cat)!.push({ item, index })
    })
    return order.map((category) => ({ category, entries: byCat.get(category)! }))
  }, [filtered])

  useEffect(() => {
    const clamped = Math.min(activeIndex, Math.max(0, filtered.length - 1))
    if (clamped !== activeIndex) setActiveIndex(clamped)
  }, [filtered, activeIndex, setActiveIndex])

  function select(i: number): void {
    const item = filtered[i]
    if (item) item.action.run()
  }

  if (!open) return null

  return createPortal(
    <div
      className="command-palette-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false)
      }}
    >
      <div
        className="command-palette"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            setOpen(false)
          } else if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActiveIndex(Math.min(filtered.length - 1, activeIndex + 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActiveIndex(Math.max(0, activeIndex - 1))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            select(activeIndex)
          }
        }}
      >
        <div className="command-palette-input">
          <span style={{ display: 'inline-flex', color: 'var(--text-dim)' }}>
            <MdiIcon path={mdiCogOutline} size={20} />
          </span>
          <input
            ref={inputRef}
            type="text"
            placeholder="Type a command…  (press ⌘K to reopen)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd className="kbd">Esc</kbd>
        </div>
        <div className="command-palette-list">
          {filtered.length === 0 ? (
            <div className="command-palette-empty">No commands match “{query}”.</div>
          ) : (
            grouped.map((group) => (
              <div key={group.category} className="command-palette-group">
                <div className="command-palette-group-header">{group.category}</div>
                {group.entries.map(({ item, index: i }) => (
                  <button
                    key={item.action.id}
                    className={`command-palette-item${i === activeIndex ? ' active' : ''}`}
                    onClick={() => select(i)}
                    onMouseEnter={() => setActiveIndex(i)}
                  >
                    <span className="command-palette-icon">
                      <MdiIcon path={item.action.iconPath} size={18} />
                    </span>
                    <span className="command-palette-text">
                      <span className="command-palette-title">{item.action.title}</span>
                      {item.action.subtitle && (
                        <span className="command-palette-subtitle">{item.action.subtitle}</span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
