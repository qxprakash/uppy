type Listener = ((...args: any[]) => void) & { event?: string }

/**
 * Event emitter with the semantics of namespace-emitter 2.0.1 (MIT), which
 * Uppy's `on`/`once`/`off`/`emit` have always had:
 * - listeners for `'ns'` also fire for `'ns:event'`;
 * - listeners for `'*'` fire for every event;
 * - listeners are called with `this` set to themselves, `listener.event` set
 *   to the name of the event being emitted, and exactly six arguments;
 * - `off(event)` without a listener removes all listeners for that event.
 */
export default function createEmitter() {
  const fns: Record<string, Listener[]> = {}

  const emitter = {
    on(event: string, fn: Listener): void {
      fns[event] ??= []
      fns[event].push(fn)
    },

    once(event: string, fn: Listener): void {
      function one(this: unknown, ...args: unknown[]) {
        fn.apply(this, args)
        emitter.off(event, one)
      }
      emitter.on(event, one)
    },

    off(event: string, fn?: Listener): void {
      const keep = event && fn ? (fns[event] ?? []).filter((f) => f !== fn) : []
      if (keep.length) fns[event] = keep
      else delete fns[event]
    },

    emit(event: string, ...args: unknown[]): void {
      let listeners = fns[event] ?? []
      const idx = event.indexOf(':')
      const namespace = idx === -1 ? undefined : event.slice(0, idx)
      for (const key of Object.keys(fns)) {
        if (key === '*') listeners = listeners.concat(fns[key])
        if (key === namespace) {
          listeners = listeners.concat(fns[key])
          break
        }
      }
      // Listeners always get exactly six arguments, as with namespace-emitter.
      args.length = 6
      // Iterate over a snapshot: a listener added during this emit must not
      // run until the next one.
      for (const fn of listeners.slice()) {
        if (!fn) break
        fn.event = event
        fn.apply(fn, args)
      }
    },
  }

  return emitter
}
