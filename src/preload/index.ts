import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { createApi, type Transport } from '../shared/api'

/**
 * The desktop transport: the same `window.ptnotes` API the web bridge serves,
 * backed by Electron IPC instead of HTTP. `createApi` owns every method so the
 * two transports cannot drift.
 */
const ipcTransport: Transport = {
  mode: 'desktop',
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  on: (channel, listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown): void => listener(payload)
    ipcRenderer.on(channel, handler)
    return () => {
      ipcRenderer.removeListener(channel, handler)
    }
  },
  getPathForFile: (file) => webUtils.getPathForFile(file)
}

const api = createApi(ipcTransport)

export type { PTNotesApi } from '../shared/api'

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('ptnotes', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.ptnotes = api
}
