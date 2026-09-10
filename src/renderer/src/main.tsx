import './assets/main.css'

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-function-return-type */
;(function ensurePtnotesStub(): void {
  if (typeof window === 'undefined') return
  const noop = (): void => {}
  const noopAsync = async (): Promise<any> => undefined as any
  const noopUnsub = (): (() => void) => () => undefined
  if (!window.electron) {
    Object.defineProperty(window, 'electron', {
      value: {
        process: {
          platform:
            typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac')
              ? 'darwin'
              : 'linux'
        }
      },
      writable: false,
      configurable: true
    })
  }
  if (!window.ptnotes) {
    const emptyList: any[] = []
    const noopAI = {
      clear: noopAsync,
      send: noopAsync,
      stop: noopAsync,
      getConfig: async () => ({
        model: '',
        apiKey: '',
        baseUrl: '',
        temperature: 0.2,
        systemPrompt: '',
        activeProfileId: 'default',
        profiles: []
      }),
      getProfiles: async () => ({ activeProfileId: 'default', profiles: [] }),
      saveProfiles: noopAsync,
      generateTitle: async () => 'Untitled',
      confirmResponse: noopAsync,
      onStreamEvent: noopUnsub
    }
    const noopProjects = {
      list: async () => emptyList,
      create: async () => ({ name: '' }) as any,
      recreate: async () => ({ name: '' }) as any,
      rename: noopAsync,
      delete: noopAsync
    }
    const noopSettings = {
      changeRoot: noopAsync,
      getAppearance: async () => ({
        theme: 'system',
        fontSize: 'default',
        uiDensity: 'cozy',
        editorFontFamily: 'sans',
        quickSwitcher: true
      }),
      setAppearance: noopAsync,
      get: async () => ({}),
      set: noopAsync
    }
    const noopNotes = {
      list: async () => emptyList,
      read: async () => '',
      save: noopAsync,
      create: async () => ({ id: '', title: '' }) as any,
      rename: async () => ({ id: '', title: '' }) as any,
      delete: noopAsync,
      setStarred: async () => emptyList,
      search: async () => emptyList
    }
    const noopKanban = {
      load: async () => ({ columns: [], cards: [] }) as any,
      loadArchive: async () => ({ columns: [], cards: [] }) as any,
      createCard: async () => ({ columns: [], cards: [] }) as any,
      updateCard: async () => ({ columns: [], cards: [] }) as any,
      moveCard: async () => ({ columns: [], cards: [] }) as any,
      deleteCard: async () => ({ columns: [], cards: [] }) as any,
      addComment: async () => ({ columns: [], cards: [] }) as any,
      updateComment: async () => ({ columns: [], cards: [] }) as any,
      deleteComment: async () => ({ columns: [], cards: [] }) as any,
      addColumn: async () => ({ columns: [], cards: [] }) as any,
      updateColumn: async () => ({ columns: [], cards: [] }) as any,
      moveColumn: async () => ({ columns: [], cards: [] }) as any,
      deleteColumn: async () => ({ columns: [], cards: [] }) as any,
      archiveCard: async () =>
        ({ board: { columns: [], cards: [] }, archive: { columns: [], cards: [] } }) as any,
      restoreCard: async () =>
        ({ board: { columns: [], cards: [] }, archive: { columns: [], cards: [] } }) as any,
      deleteArchivedCard: async () => ({ columns: [], cards: [] }) as any
    }
    const noopPlanner = {
      list: async () => emptyList,
      read: async () => ({ id: '', title: '', tasks: [], milestones: [] }) as any,
      save: noopAsync,
      create: async () => ({ id: '', title: '' }) as any,
      rename: async () => ({ id: '', title: '' }) as any,
      duplicate: async () => ({ id: '', title: '' }) as any,
      delete: noopAsync,
      getCalendar: async () => ({ workingDays: [1, 2, 3, 4, 5], holidays: [] }) as any,
      saveCalendar: noopAsync
    }
    const noopFiles = {
      listEntries: async () => emptyList,
      getPathForFile: () => '',
      copyToProject: async () => '',
      reveal: noop,
      revealByName: noop
    }
    const noopSnapshots = {
      list: async () => emptyList,
      restore: async () => ({}) as any,
      setTag: noopAsync,
      delete: noopAsync
    }
    const noopChat = {
      list: async () => emptyList,
      read: async () => ({ id: '', messages: [] }) as any,
      write: noopAsync,
      delete: noopAsync
    }
    const noopBots = {
      listBots: async () => emptyList,
      saveBot: async () => ({ id: '', name: '' }) as any,
      deleteBot: async () => true,
      listGroups: async () => emptyList,
      readGroup: async () => ({ id: '', messages: [] }) as any,
      createGroup: async () => ({ id: '', name: '' }) as any,
      updateGroup: noopAsync,
      deleteGroup: noopAsync,
      clearGroupMessages: noopAsync,
      send: noopAsync,
      stop: noopAsync,
      askResponse: noopAsync,
      onEvent: noopUnsub,
      listTasks: async () => emptyList,
      clearTaskHistory: noopAsync
    }
    const noopModules = {
      list: async () => emptyList,
      onEvent: noopUnsub
    }
    const noopSkills = {
      list: async () => emptyList,
      get: async () => null,
      save: noopAsync,
      delete: noopAsync
    }
    const stub = {
      ai: noopAI,
      projects: noopProjects,
      settings: noopSettings,
      notes: noopNotes,
      kanban: noopKanban,
      planner: noopPlanner,
      files: noopFiles,
      snapshots: noopSnapshots,
      chat: noopChat,
      bots: noopBots,
      modules: noopModules,
      skills: noopSkills,
      onOpenFind: (cb: () => void) => {
        const handler = (e: KeyboardEvent) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') cb()
        }
        if (typeof window !== 'undefined') window.addEventListener('keydown', handler)
        return () => {
          if (typeof window !== 'undefined') window.removeEventListener('keydown', handler)
        }
      }
    }
    Object.defineProperty(window, 'ptnotes', {
      value: stub,
      writable: false,
      configurable: true
    })
  }
})()

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
