import { app, shell, BrowserWindow, Menu, ipcMain, protocol } from 'electron'
import { join, extname } from 'path'
import { promises as fs } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import splashUrl from '../../resources/splash.html?asset'
import { PTNotesService } from './service/PTNotesService'
import { registerProjectIpc, registerNoteIpc, registerChatIpc } from './ipc'
import { registerKanbanIpc } from './ipc/kanban'
import { registerPlannerIpc } from './ipc/planner'
import { registerAiIpc, createSessionRegistry } from './ipc/ai'
import { registerFilesIpc } from './ipc/files'
import { registerSettingsIpc } from './ipc/settings'
import { registerSkillsIpc } from './ipc/skills'
import { registerModulesIpc } from './ipc/modules'
import { registerToolsetsIpc } from './ipc/toolsets'
import { registerBotsIpc } from './ipc/bots'
import { BotsStore } from './bots/db'
import { GroupChatManager } from './bots/orchestrator'
import { createBotTaskModule } from './bots/botTask'
import { ModuleRegistry } from './modules/registry'
import { ModuleRunManager } from './modules/runs'
import { buildStartModuleTool, buildWaitModulesTool } from './modules/tool'
import { shutdownChartRenderer } from './modules/shared/chartRenderer'
import { shutdownDiagramRenderer } from './modules/shared/diagramRenderer'
import { shutdownInfographicRenderer } from './modules/shared/infographicRenderer'
import { close as closeBrowser } from './mcp/browser'
import type { PTTool } from './ai/tools'
import { createPptxModule } from './modules/pptx'
import { createInfographicModule } from './modules/infographic'
import { createDocxModule } from './modules/docx'
import { createXlsxModule } from './modules/xlsx'
import { createSubagentModule } from './modules/subagent'
import { SettingsStore } from './settings'
import { AIConfigStore } from './ai/config'
import { WindowStateStore } from './windowState'
import type { WindowState } from '@shared/types'

app.setName('PTNotes')

// Custom protocol for serving local images in chat (must be before app.ready)
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'ptfile',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

let mainWindow: BrowserWindow | null = null
let splashWindow: BrowserWindow | null = null
let plannerEditActive = false
let windowStateStore: WindowStateStore
let moduleManager: ModuleRunManager | undefined
/** Lets the module broadcast (created before the bots system) forward bot-task events. */
const groupChatForwarder: { current: GroupChatManager | undefined } = { current: undefined }
let botsStoreRef: BotsStore | undefined

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

function createSplashWindow(): void {
  splashWindow = new BrowserWindow({
    width: 420,
    height: 260,
    center: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    show: false,
    skipTaskbar: true,
    title: 'PTNotes',
    webPreferences: {
      sandbox: true
    }
  })

  splashWindow.once('ready-to-show', () => {
    splashWindow?.show()
  })
  splashWindow.on('closed', () => {
    splashWindow = null
  })

  void splashWindow.loadFile(splashUrl, { query: { icon } })
}

function closeSplashWindow(): void {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.destroy()
  }
  splashWindow = null
}

function createWindow(windowState: WindowState): void {
  const state = windowState.isMaximized
    ? { width: windowState.width, height: windowState.height }
    : {
        x: windowState.x,
        y: windowState.y,
        width: windowState.width,
        height: windowState.height
      }

  mainWindow = new BrowserWindow({
    ...state,
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

  if (windowState.isMaximized) {
    mainWindow.maximize()
  }

  const saveWindowState = (): void => {
    if (!mainWindow) return
    if (mainWindow.isDestroyed()) return
    const bounds = mainWindow.getNormalBounds()
    void windowStateStore.save({
      ...bounds,
      isMaximized: mainWindow.isMaximized()
    })
  }

  mainWindow.on('close', saveWindowState)

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    closeSplashWindow()
  })

  mainWindow.webContents.on('did-fail-load', () => {
    closeSplashWindow()
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

  createSplashWindow()

  // Handle ptfile:// protocol — serves local files for chat images
  const IMAGE_MIME: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.ico': 'image/x-icon'
  }
  protocol.handle('ptfile', async (request) => {
    const rawPath = new URL(request.url).pathname
    let filePath = rawPath
    if (/^\/[a-zA-Z]:\//.test(filePath))
      filePath = filePath.replace(/^\//g, '').replace(/%20/g, ' ')
    else filePath = filePath.replace(/%20/g, ' ')
    try {
      const data = await fs.readFile(filePath)
      const mime = IMAGE_MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
      return new Response(data, { headers: { 'Content-Type': mime } })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })

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

  const { setDefaultHeadless, setDefaultMaximize, setDefaultIgnoreHttpsErrors } =
    await import('./mcp/browser')
  setDefaultHeadless(!!settings.browserHeadless)
  setDefaultMaximize(!!settings.browserMaximize)
  setDefaultIgnoreHttpsErrors(!!settings.browserIgnoreHttpsErrors)

  const moduleRegistry = new ModuleRegistry()
  moduleRegistry.register(createSubagentModule())
  moduleRegistry.register(createPptxModule())
  moduleRegistry.register(createInfographicModule())
  moduleRegistry.register(createDocxModule())
  moduleRegistry.register(createXlsxModule())
  moduleManager = new ModuleRunManager(
    service,
    configStore,
    moduleRegistry,
    (evt) => {
      groupChatForwarder.current?.handleModuleEvent(evt)
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('modules:event', evt)
      }
    },
    undefined,
    settingsStore
  )
  const toolsProvider = async (): Promise<PTTool[]> => {
    const current = await settingsStore.load()
    const { buildChatTools } = await import('./mcp/toolsets')
    return [
      buildStartModuleTool(moduleManager!, moduleRegistry, current.disabledModules ?? []),
      buildWaitModulesTool(moduleManager!),
      ...(await buildChatTools(current.disabledToolsets ?? [], service, settingsStore))
    ]
  }

  // Bots group chat: global bot library (userData/bots.db) + per-project group chats
  const botsStore = new BotsStore(() => service.root, app.getPath('userData'))
  botsStoreRef = botsStore
  moduleRegistry.register(
    createBotTaskModule(moduleManager!, moduleRegistry, settings.disabledModules ?? [])
  )
  const groupChatManager = new GroupChatManager({
    store: botsStore,
    configStore,
    moduleManager: moduleManager!,
    broadcast: (evt) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('bots:event', evt)
      }
    }
  })
  groupChatForwarder.current = groupChatManager

  const registry = createSessionRegistry(service, configStore, toolsProvider, async () => {
    const { buildPromptSection } = await import('./mcp/toolsets')
    const current = await settingsStore.load()
    return buildPromptSection(current.disabledToolsets ?? [])
  })
  registerProjectIpc(service)
  registerNoteIpc(service)
  registerKanbanIpc(service)
  registerChatIpc(service)
  registerPlannerIpc(service)
  registerAiIpc(registry, configStore, service)
  registerFilesIpc(service, registry, configStore)
  registerSettingsIpc(service, settingsStore, (newRoot) => {
    botsStoreRef?.setRootDir(newRoot)
    groupChatForwarder.current?.closeAll()
  })
  registerSkillsIpc(service)
  registerModulesIpc(moduleManager!, settingsStore, moduleRegistry)
  registerToolsetsIpc(settingsStore)
  registerBotsIpc(botsStore, groupChatManager, moduleManager!)

  windowStateStore = new WindowStateStore()
  const windowState = await windowStateStore.load()
  createWindow(windowState)

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow({ width: 1280, height: 820 })
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  // Mark any in-flight module runs as cancelled before the process exits.
  void moduleManager?.cancelActive()
  groupChatForwarder.current?.closeAll()
  botsStoreRef?.closeAll()
  void closeBrowser()
  shutdownChartRenderer()
  shutdownDiagramRenderer()
  shutdownInfographicRenderer()
})
