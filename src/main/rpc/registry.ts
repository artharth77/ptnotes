import { getPlatform, type PlatformServices } from '../platform'

/**
 * Per-call context handed to every RPC handler. Replaces the parts of
 * `IpcMainInvokeEvent` handlers actually used: pushing an event back to the
 * calling client and the mode's dialogs/file-manager.
 */
export interface InvokeCtx {
  /** Push an event to the client that made this call. */
  send(channel: string, payload: unknown): void
  platform: PlatformServices
}

// `any[]` mirrors Electron's own `ipcMain.handle` typing, so every existing
// handler keeps its narrow parameter list at this untyped IPC boundary.
/* eslint-disable @typescript-eslint/no-explicit-any */
type InvokeHandler = (ctx: InvokeCtx, ...args: any[]) => any
type PushHandler = (ctx: InvokeCtx, ...args: any[]) => void
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Transport-agnostic registry of main-process handlers, keyed by the IPC
 * channel names that already exist. The desktop transport binds it to
 * `ipcMain`; the web transport dispatches `POST /api/invoke` into it.
 */
export class RpcRegistry {
  private readonly handlers = new Map<string, InvokeHandler>()
  private readonly pushHandlers = new Map<string, PushHandler>()

  handle(channel: string, handler: InvokeHandler): void {
    if (this.handlers.has(channel)) throw new Error(`Duplicate RPC channel: ${channel}`)
    this.handlers.set(channel, handler)
  }

  on(channel: string, handler: PushHandler): void {
    if (this.pushHandlers.has(channel)) throw new Error(`Duplicate push channel: ${channel}`)
    this.pushHandlers.set(channel, handler)
  }

  handlerCount(): number {
    return this.handlers.size
  }

  channels(): string[] {
    return [...this.handlers.keys()]
  }

  pushChannels(): string[] {
    return [...this.pushHandlers.keys()]
  }

  async invoke(ctx: InvokeCtx, channel: string, args: unknown[]): Promise<unknown> {
    const handler = this.handlers.get(channel)
    if (!handler) throw new Error(`Unknown RPC channel: ${channel}`)
    return await handler(ctx, ...args)
  }

  emit(ctx: InvokeCtx, channel: string, args: unknown[]): void {
    const handler = this.pushHandlers.get(channel)
    if (!handler) throw new Error(`Unknown push channel: ${channel}`)
    handler(ctx, ...args)
  }
}

export const rpc = new RpcRegistry()

/** Build the context for one call (used by both transports). */
export function createInvokeCtx(send: (channel: string, payload: unknown) => void): InvokeCtx {
  return { send, platform: getPlatform() }
}
