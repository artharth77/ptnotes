import { ElectronAPI } from '@electron-toolkit/preload'
import type { PTNotesApi } from './index'

declare global {
  interface Window {
    electron: ElectronAPI
    ptnotes: PTNotesApi
  }
}

export {}
