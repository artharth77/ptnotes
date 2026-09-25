import { app, shell, BrowserWindow, Menu, protocol, type WebContents } from 'electron'
import { join, extname, resolve } from 'path'
import { homedir } from 'os'
import { randomBytes } from 'crypto'
import { promises as fs } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import icon512 from '../../resources/icon512.png?asset'
import splashUrl from '../../resources/splash.html?asset'
import { PTNotesService } from './service/PTNotesService'
import { registerProjectIpc, registerNoteIpc, registerChatIpc } from './ipc'
import { registerKanbanIpc } from './ipc/kanban'
import { registerPlannerIpc } from './ipc/planner'
import { registerSnapshotsIpc } from './ipc/snapshots'
import { registerDashboardIpc } from './ipc/dashboard'
import { registerAiIpc, createSessionRegistry } from './ipc/ai'
import { registerFilesIpc } from './ipc/files'
import { registerGalleryIpc } from './ipc/gallery'
import { registerSettingsIpc } from './ipc/settings'
import { registerSkillsIpc } from './ipc/skills'
import { registerModulesIpc } from './ipc/modules'
import { registerDiagramsIpc } from './ipc/diagrams'
import { registerInfographicIpc } from './ipc/infographic'
import { registerToolsetsIpc } from './ipc/toolsets'
import { registerMcpIpc } from './ipc/mcp'
import { registerMcpServerIpc } from './ipc/mcpServer'
import { getMcpServerStore } from './mcp/servers'
import { getMcpClientManager } from './mcp/external'
import { getMcpServerHost } from './mcp/server'
import { registerBotsIpc } from './ipc/bots'
import { registerJobsIpc } from './ipc/jobs'
import { BotsStore } from './bots/db'
import { JobsStore } from './jobs/db'
import { JobScheduler } from './jobs/scheduler'
import { ScheduleJobRunner } from './jobs/runner'
import { GlobalJobRunner } from './jobs/globalRunner'
import { GLOBAL_PROJECT_KEY } from '@shared/scheduleJobs'
import { GroupChatManager } from './bots/orchestrator'
import { createBotTaskModule } from './bots/botTask'
import { ModuleRegistry } from './modules/registry'
import { ModuleRunManager } from './modules/runs'
import { buildStartModuleTool, buildWaitModulesTool } from './modules/tool'
import { shutdownChartRenderer } from './modules/shared/chartRenderer'
import { shutdownDiagramRenderer } from './modules/shared/diagramRenderer'
import { shutdownInfographicRenderer } from './modules/shared/infographicRenderer'
import { shutdownPdfRenderer } from './pdf/pdfRenderer'
import { close as closeBrowser } from './mcp/browser'
import type { PTTool } from './ai/tools'
import { isLocalEndpoint } from './ai/chatSession'
import { createPptxModule } from './modules/pptx'
import { createInfographicModule } from './modules/infographic'
import { createDocxModule } from './modules/docx'
import { createXlsxModule } from './modules/xlsx'
import { createSubagentModule } from './modules/subagent'
import { SettingsStore } from './settings'
import { AIConfigStore } from './ai/config'
import { WindowStateStore } from './windowState'
import type { WindowState } from '@shared/types'
import { parseCliArgs, cliUsage, type CliOptions, type WebCliOptions } from '@shared/cliArgs'
import { rpc } from './rpc/registry'
import { bindRegistryToIpc } from './rpc/ipcAdapter'
import { broadcast, setBroadcastSink } from './rpc/bus'
import { setPlatform, webPlatform } from './platform'
import { desktopPlatform } from './platformDesktop'
import { startWebServer, type WebServer } from './rpc/httpServer'

app.setName('PTNotes')

let cli: CliOptions
try {
  cli = parseCliArgs(process.argv)
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  console.error('')
  console.error(cliUsage())
  process.exit(1)
}
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(cliUsage())
  process.exit(0)
}

/** Hosts that need no "reachable beyond loopback" warning. */
const LOOPBACK_ONLY_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

/** `ptnotes web …` → headless HTTP mode; everything else → the desktop UI, unchanged. */
const webMode = cli.mode === 'web'
const webCli: WebCliOptions | null = cli.mode === 'web' ? cli : null

if (cli.dataPath) app.setPath('userData', expandHome(cli.dataPath))

setPlatform(webMode ? webPlatform : desktopPlatform)

let webServer: WebServer | null = null

/** CLI paths may be written with a leading `~`. */
function expandHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  return resolve(path)
}

/** Fan events out to every window (web mode binds its own SSE sink instead). */
function desktopBroadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
    if (channel === 'jobs:event') {
      const evt = payload as { type?: string }
      if (evt.type === 'notify' && !win.isFocused()) win.flashFrame(true)
    }
  }
}

// Custom protocol for serving local images in chat (must be before app.ready)
if (!webMode) {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'ptfile',
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

let mainWindow: BrowserWindow | null = null
let splashWindow: BrowserWindow | null = null
let plannerEditActive = false
let pdfViewerOpen = false

// Send-only channels: renderer → main (no reply). They live on the shared
// registry so the web transport can drive the same flags client-side.
rpc.on('planner:set-edit-active', (_ctx, active: boolean) => {
  plannerEditActive = !!active
})

rpc.on('pdf-viewer:set-open', (_ctx, open: boolean) => {
  pdfViewerOpen = !!open
})
let windowStateStore: WindowStateStore
let moduleManager: ModuleRunManager | undefined
/** Lets the module broadcast (created before the bots system) forward bot-task events. */
const groupChatForwarder: { current: GroupChatManager | undefined } = { current: undefined }
let botsStoreRef: BotsStore | undefined
let jobsStoreRef: JobsStore | undefined
let jobSchedulerRef: JobScheduler | undefined
let jobAbortControllerRef: AbortController | undefined

/**
 * Chromium's PDF plugin runs in an out-of-process iframe that consumes
 * keyboard input, so the renderer's window keydown listener never sees Escape
 * once the preview iframe has focus. The renderer flags the viewer as open via
 * `pdf-viewer:set-open`; Escape intercepted here (main frame + OOPIF guests)
 * is forwarded to the page, which closes the viewer.
 */
function interceptPdfViewerEscape(webContents: WebContents): void {
  webContents.on('before-input-event', (event, input) => {
    if (!pdfViewerOpen || input.type !== 'keyDown' || input.key !== 'Escape') return
    if (input.control || input.meta || input.alt) return
    event.preventDefault()
    mainWindow?.webContents.send('pdf-viewer:escape')
  })
}

if (!webMode) {
  app.on('web-contents-created', (_event, webContents) => {
    // OOPIF guests (the PDF preview iframe) need their own interception;
    // 'iframe' is a runtime type Electron's typings don't declare yet
    const type = webContents.getType() as string
    if (type === 'iframe') interceptPdfViewerEscape(webContents)
  })
}

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
              { role: 'delete' }
            ] as Electron.MenuItemConstructorOptions[])
          : ([{ role: 'delete' }, { type: 'separator' }] as Electron.MenuItemConstructorOptions[])),
        {
          label: 'Select All',
          accelerator: 'CmdOrCtrl+A',
          click: (_item, win) => {
            const target = win as Electron.BrowserWindow | undefined
            target?.webContents.send('global:select-all')
          }
        }
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
    backgroundColor: '#131418',
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
    backgroundColor: '#131418',
    autoHideMenuBar: true,
    title: 'PTNotes',
    ...(process.platform === 'linux' || process.platform === 'win32' ? { icon: icon512 } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      plugins: true
    }
  })

  const saveWindowState = (): void => {
    if (!mainWindow) return
    if (mainWindow.isDestroyed()) return
    const bounds = mainWindow.getNormalBounds()
    void windowStateStore.save({
      ...bounds,
      isMaximized: mainWindow.isMaximized()
    })
  }

  mainWindow.once('ready-to-show', () => {
    if (windowState.isMaximized) mainWindow?.maximize()
    mainWindow?.show()
    closeSplashWindow()
  })
  mainWindow.webContents.once('did-finish-load', () => {
    /* noop */
  })
  mainWindow.webContents.on('did-fail-load', () => {
    closeSplashWindow()
  })
  ;(mainWindow.webContents as unknown as { on: (ev: string, cb: () => void) => void }).on(
    'render-process-gone',
    () => {
      closeSplashWindow()
    }
  )

  mainWindow.on('close', saveWindowState)
  mainWindow.on('focus', () => {
    mainWindow?.flashFrame(false)
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
    const key = input.key.toLowerCase()
    const mod = input.meta || input.control
    const shift = !!input.shift && !input.alt
    const isGlobalFind = mod && shift && key === 'f'
    if (isGlobalFind) {
      event.preventDefault()
      mainWindow?.webContents.send('global:open-find')
      return
    }
    if (!plannerEditActive) return
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

  interceptPdfViewerEscape(mainWindow.webContents)

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/**
 * Everything both modes share: stores, services, bots/jobs/modules and the RPC
 * registrations. No windows, menus or native dialogs — those stay desktop-only.
 */
async function initCore(): Promise<PTNotesService> {
  const settingsStore = new SettingsStore()
  let settings = await settingsStore.load()
  // `--doc-path` pins the project root (same setting as Settings ▸ Storage).
  const docPath = cli.docPath?.trim()
  if (docPath) {
    const target = expandHome(docPath)
    await fs.mkdir(target, { recursive: true })
    if (target !== settings.rootDir) {
      settings = await settingsStore.save({ ...settings, rootDir: target })
      console.log(`  Project root:  ${target}`)
    }
  }
  const service = new PTNotesService(settings.rootDir, undefined, settingsStore)
  await service.migrateLegacyFolders()
  const configStore = new AIConfigStore()
  await getMcpServerStore().load()
  await getMcpServerHost().reconfigure(settings.mcpServer!, service)

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
      broadcast('modules:event', evt)
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
    broadcast: (evt) => broadcast('bots:event', evt)
  })
  groupChatForwarder.current = groupChatManager

  // Scheduled jobs: per-project SQLite (`<project>/.data/jobs/jobs.db`) + a minute-tick
  // scheduler that fires tool-capable background AI runs per project. Global-scope
  // jobs live in the root-level `<root>/.data/jobs/` and fan out to every project.
  const jobsStore = new JobsStore(() => service.root)
  jobsStoreRef = jobsStore
  const jobAbortController = new AbortController()
  jobAbortControllerRef = jobAbortController
  const listProjectNames = async (): Promise<string[]> => {
    await service.ensureRoot()
    const entries = await fs.readdir(service.root, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name)
  }
  const jobScheduler = new JobScheduler({
    listProjects: listProjectNames,
    store: jobsStore,
    runnerFor: (project) => {
      if (project === GLOBAL_PROJECT_KEY) {
        return {
          run: async (job, run) => {
            const runner = new GlobalJobRunner({
              listProjects: listProjectNames,
              service,
              configStore,
              moduleManager: moduleManager!,
              moduleRegistry: moduleRegistry,
              disabledModules: (await settingsStore.load()).disabledModules ?? [],
              db: jobsStore,
              signal: jobAbortController.signal
            })
            return runner.run(job, run)
          }
        }
      }
      return {
        run: async (job, run) => {
          const runner = new ScheduleJobRunner({
            project,
            service,
            configStore,
            moduleManager: moduleManager!,
            moduleRegistry: moduleRegistry,
            disabledModules: (await settingsStore.load()).disabledModules ?? [],
            db: jobsStore,
            signal: jobAbortController.signal
          })
          return runner.run(job, run)
        }
      }
    },
    broadcast: (evt) => broadcast('jobs:event', evt),
    aiConfigured: async () => {
      const cfg = await configStore.load()
      return !!cfg.model && (!!cfg.apiKey || isLocalEndpoint(cfg.baseUrl))
    }
  })
  jobScheduler.start()
  jobSchedulerRef = jobScheduler

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
  registerSnapshotsIpc(service)
  registerDashboardIpc(service)
  registerAiIpc(registry, configStore, service)
  registerFilesIpc(service, registry, configStore)
  registerGalleryIpc(service)
  registerSettingsIpc(service, settingsStore, (newRoot) => {
    botsStoreRef?.setRootDir(newRoot)
    jobsStoreRef?.setRootDir(newRoot)
    groupChatForwarder.current?.closeAll()
  })
  registerSkillsIpc(service)
  registerModulesIpc(moduleManager!, settingsStore, moduleRegistry)
  registerToolsetsIpc(settingsStore)
  registerMcpIpc()
  registerMcpServerIpc(service, settingsStore)
  registerBotsIpc(botsStore, groupChatManager, moduleManager!)
  registerJobsIpc(jobsStore, jobSchedulerRef!)

  registerDiagramsIpc()
  registerInfographicIpc()

  return service
}

app.whenReady().then(async () => {
  if (webMode) {
    if (process.platform === 'darwin' && app.dock) app.dock.hide()
  } else {
    electronApp.setAppUserModelId('com.ptnotes.app')

    createSplashWindow()

    // Handle ptfile:// protocol — serves local files for chat images and PDF preview
    const IMAGE_MIME: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.ico': 'image/x-icon',
      '.pdf': 'application/pdf'
    }
    protocol.handle('ptfile', async (request) => {
      const rawPath = new URL(request.url).pathname
      let filePath: string
      try {
        filePath = decodeURIComponent(rawPath)
      } catch {
        filePath = rawPath
      }
      if (/^\/[a-zA-Z]:\//.test(filePath)) filePath = filePath.replace(/^\//g, '')
      try {
        const data = await fs.readFile(filePath)
        const mime = IMAGE_MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
        return new Response(data, { headers: { 'Content-Type': mime } })
      } catch {
        return new Response('Not found', { status: 404 })
      }
    })

    Menu.setApplicationMenu(buildAppMenu())

    if (process.platform === 'darwin' && !app.isPackaged && app.dock) {
      app.dock.setIcon(icon)
    }

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    setBroadcastSink(desktopBroadcast)
  }

  const service = await initCore()

  if (webCli) {
    webServer = await startWebServer({
      host: webCli.host,
      port: webCli.port,
      token: webCli.noAuth ? null : (webCli.token ?? randomBytes(16).toString('hex')),
      getRootDir: () => service.root,
      rendererDir: join(__dirname, '../renderer'),
      devUrl: process.env['ELECTRON_RENDERER_URL']
    })
    const [primary, ...rest] = webServer.urls
    console.log('')
    console.log(`  PTNotes web UI: ${primary}/`)
    for (const url of rest) console.log(`                  ${url}/`)
    if (webServer.token) console.log(`  Access link:    ${primary}/?t=${webServer.token}`)
    if (!LOOPBACK_ONLY_HOSTS.has(webCli.host)) {
      console.log(
        webServer.token
          ? '  WARNING: reachable beyond loopback — anyone with the access code can use the app.'
          : '  WARNING: reachable beyond loopback with --no-auth — anyone can use the app.'
      )
    }
    console.log('')
    return
  }

  bindRegistryToIpc()

  windowStateStore = new WindowStateStore()
  const windowState = await windowStateStore.load()
  createWindow(windowState)

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow({ width: 1280, height: 820 })
  })
})

app.on('window-all-closed', () => {
  if (webMode) return
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

if (webMode) {
  // Headless: keep running until the operator stops the process.
  const shutdown = (): void => app.quit()
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  process.on('SIGHUP', shutdown)
}

app.on('will-quit', () => {
  void webServer?.close()
  // Mark any in-flight module runs as cancelled before the process exits.
  void moduleManager?.cancelActive()
  groupChatForwarder.current?.closeAll()
  botsStoreRef?.closeAll()
  jobAbortControllerRef?.abort()
  jobSchedulerRef?.stop()
  jobsStoreRef?.closeAll()

  void closeBrowser()
  void getMcpClientManager().closeAll()
  void getMcpServerHost().stop()
  shutdownChartRenderer()
  shutdownDiagramRenderer()
  shutdownInfographicRenderer()
  shutdownPdfRenderer()
})
