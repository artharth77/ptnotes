import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { PTNotesService } from './service/PTNotesService'
import { registerProjectIpc, registerNoteIpc, registerTodoIpc, registerChatIpc } from './ipc'
import { registerAiIpc, createSessionRegistry } from './ipc/ai'
import { registerFilesIpc } from './ipc/files'
import { registerSettingsIpc } from './ipc/settings'
import { registerSkillsIpc } from './ipc/skills'
import { registerModulesIpc } from './ipc/modules'
import { ModuleRegistry } from './modules/registry'
import { ModuleRunManager } from './modules/runs'
import { buildStartModuleTool } from './modules/tool'
import { shutdownChartRenderer } from './modules/shared/chartRenderer'
import { shutdownDiagramRenderer } from './modules/shared/diagramRenderer'
import { shutdownInfographicRenderer } from './modules/shared/infographicRenderer'
import type { PTTool } from './ai/tools'
import { createPptxModule } from './modules/pptx'
import { createInfographicModule } from './modules/infographic'
import { createDocxModule } from './modules/docx'
import { SettingsStore } from './settings'
import { AIConfigStore } from './ai/config'

app.setName('PTNotes')

let mainWindow: BrowserWindow | null = null

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
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.ptnotes.app')

  if (process.platform === 'darwin' && !app.isPackaged && app.dock) {
    app.dock.setIcon(icon)
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const settingsStore = new SettingsStore()
  const settings = await settingsStore.load()
  const service = new PTNotesService(settings.rootDir)
  await service.migrateLegacyFolders()
  const configStore = new AIConfigStore()

  const moduleRegistry = new ModuleRegistry()
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
    return [buildStartModuleTool(moduleManager, moduleRegistry, current.disabledModules ?? [])]
  }

  const registry = createSessionRegistry(service, configStore, toolsProvider)
  registerProjectIpc(service)
  registerNoteIpc(service)
  registerTodoIpc(service)
  registerChatIpc(service)
  registerAiIpc(registry, configStore)
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
