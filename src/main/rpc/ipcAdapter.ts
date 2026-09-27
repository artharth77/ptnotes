import { ipcMain } from 'electron'
import { createInvokeCtx, rpc } from './registry'

/**
 * Bind the shared registry to Electron's IPC. One `handle` per channel, exactly
 * as the per-file registrations used to do — the web server dispatches into the
 * same registry instead.
 */
export function bindRegistryToIpc(): void {
  for (const channel of rpc.channels()) {
    ipcMain.handle(channel, (event, ...args) =>
      rpc.invoke(
        createInvokeCtx((name, payload) => event.sender.send(name, payload)),
        channel,
        args
      )
    )
  }
  for (const channel of rpc.pushChannels()) {
    ipcMain.on(channel, (event, ...args) =>
      rpc.emit(
        createInvokeCtx((name, payload) => event.sender.send(name, payload)),
        channel,
        args
      )
    )
  }
}
