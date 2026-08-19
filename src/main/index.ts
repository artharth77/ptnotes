import { app, shell, BrowserWindow, Menu, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { PTNotesService } from './service/PTNotesService'
import { registerProjectIpc, registerNoteIpc, registerTodoIpc, registerChatIpc } from './ipc'
import { registerPlannerIpc } from './ipc/planner'
import { registerAiIpc, createSessionRegistry } from './ipc/ai'
import { registerFilesIpc } from './ipc/files'
import { registerSettingsIpc } from './ipc/settings'
import { registerSkillsIpc } from './ipc/skills'
import { registerModulesIpc } from './ipc/modules'
import { ModuleRegistry } from './modules/registry'
import { ModuleRunManager } from './modules/runs'
import { buildStartModuleTool, buildWaitModulesTool } from './modules/tool'
import { shutdownChartRenderer } from './modules/shared/chartRenderer'
import { shutdownDiagramRenderer } from './modules/shared/diagramRenderer'
import { shutdownInfographicRenderer } from './modules/shared/infographicRenderer'
import type { PTTool } from './ai/tools'
import { createPptxModule } from './modules/pptx'
import { createInfographicModule } from './modules/infographic'
import { createDocxModule } from './modules/docx'
import { createSubagentModule } from './modules/subagent'
import { SettingsStore } from './settings'
import { AIConfigStore } from './ai/config'

app.setName('PTNotes')

let mainWindow: BrowserWindow | null = null
let plannerEditActive = false

function buildAppMenu(): Menu {
  const isMac = process.platform === 'darwin'
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' } as Electron.MenuItemConstructorOptions] : []),
    {
      label: 'File',
      submenu: [
        isMac
          ? { role: 'close' }
          : ({ role: 'quit', label: 'Quit PTNotes' } as Electron.MenuItemConstructorOptions)
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac
          ? ([
              { role: 'pasteAndMatchStyle' },
              { role: 'delete' },
              { role: 'selectAll' }
            ] as Electron.MenuItemConstructorOptions[])
          : ([
              { role: 'delete' },
              { type: 'separator' },
              { role: 'selectAll' }
            ] as Electron.MenuItemConstructorOptions[]))
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' },
    { role: 'help' }
  ]
  return Menu.buildFromTemplate(template)
}

function openExternalSafely(url: string): void {
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) return
    shell.openExternal(url).catch((err) => console.error('openExternal failed:', err))
  } catch {
    // Invalid URL or missing protocol, ignore
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'PTNotes',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    openExternalSafely(details.url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    const allowed = devUrl ? url.startsWith(devUrl) : url.startsWith('file://')
    if (!allowed) {
      event.preventDefault()
      openExternalSafely(url)
    }
  })

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (!plannerEditActive) return
    const key = input.key.toLowerCase()
    const mod = input.meta || input.control
    const isUndo = mod && !input.alt && !input.shift && key === 'z'
    const isRedo =
      (mod && !input.alt && input.shift && key === 'z') ||
      (key === 'y' && input.control && !input.meta && !input.alt && !input.shift)
    if (isUndo) {
      event.preventDefault()
      mainWindow?.webContents.send('planner:undo-redo', { redo: false })
    } else if (isRedo) {
      event.preventDefault()
      mainWindow?.webContents.send('planner:undo-redo', { redo: true })
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.ptnotes.app')

  Menu.setApplicationMenu(buildAppMenu())

  ipcMain.on('planner:set-edit-active', (_e, active: boolean) => {
    plannerEditActive = !!active
  })

  if (process.platform === 'darwin' && !app.isPackaged && app.dock) {
    app.dock.setIcon(icon)
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const settingsStore = new SettingsStore()
  const settings = await settingsStore.load()
  const service = new PTNotesService(settings.rootDir, undefined, settingsStore)
  await service.migrateLegacyFolders()
  const configStore = new AIConfigStore()

  const moduleRegistry = new ModuleRegistry()
  moduleRegistry.register(createSubagentModule())
  moduleRegistry.register(createPptxModule())
  moduleRegistry.register(createInfographicModule())
  moduleRegistry.register(createDocxModule())
  const moduleManager = new ModuleRunManager(
    service,
    configStore,
    moduleRegistry,
    (evt) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('modules:event', evt)
      }
    },
    undefined,
    settingsStore
  )
  const toolsProvider = async (): Promise<PTTool[]> => {
    const current = await settingsStore.load()
    return [
      buildStartModuleTool(moduleManager, moduleRegistry, current.disabledModules ?? []),
      buildWaitModulesTool(moduleManager)
    ]
  }

  const registry = createSessionRegistry(service, configStore, toolsProvider)
  registerProjectIpc(service)
  registerNoteIpc(service)
  registerTodoIpc(service)
  registerChatIpc(service)
  registerPlannerIpc(service)
  registerAiIpc(registry, configStore, service)
  registerFilesIpc(service, registry, configStore)
  registerSettingsIpc(service, settingsStore)
  registerSkillsIpc(service)
  registerModulesIpc(moduleManager, settingsStore, moduleRegistry)

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  shutdownChartRenderer()
  shutdownDiagramRenderer()
  shutdownInfographicRenderer()
})
