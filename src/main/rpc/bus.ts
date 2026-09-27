/** Fan-out of main→renderer events, bound once per mode. */
type BroadcastSink = (channel: string, payload: unknown) => void

let sink: BroadcastSink = () => {}

export function setBroadcastSink(fn: BroadcastSink): void {
  sink = fn
}

/** Send an event to every connected client (all windows / all web sessions). */
export function broadcast(channel: string, payload: unknown): void {
  sink(channel, payload)
}
