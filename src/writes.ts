/** What the window says about writing records: nothing, saving, or saved a moment ago. */
export type WriteState = 'idle' | 'saving' | 'saved'

/** How long "saved" stays after the last write ended well. */
export const SAVED_FOR = 1600

// The window's timers are called as plain functions: `setTimeout` taken off `window` and called on
// another object throws "Illegal invocation" in the browser.
const windowTimers = { set: (f: () => void, ms: number): unknown => setTimeout(f, ms), clear: (id: unknown) => clearTimeout(id as number) }

/**
 * Follows the writes in flight: saving while any runs, saved for a moment after the last one ends
 * well (a failure is said where it happened, so it shows nothing here). Listeners hear each change.
 */
export function writeStatus(timers: { set: (f: () => void, ms: number) => unknown; clear: (id: unknown) => void } = windowTimers) {
  let pending = 0
  let state: WriteState = 'idle'
  let fading: unknown
  const listeners = new Set<(state: WriteState) => void>()
  const become = (next: WriteState) => {
    if (next === state) return
    state = next
    for (const listener of listeners) listener(state)
  }
  return {
    get state() {
      return state
    },
    /** Follows one write; resolves and rejects as it does. */
    async track<T>(write: Promise<T>): Promise<T> {
      pending += 1
      if (fading !== undefined) timers.clear(fading)
      fading = undefined
      become('saving')
      try {
        const result = await write
        pending -= 1
        if (pending === 0) {
          become('saved')
          fading = timers.set(() => {
            fading = undefined
            become('idle')
          }, SAVED_FOR)
        }
        return result
      } catch (e) {
        pending -= 1
        if (pending === 0) become('idle')
        throw e
      }
    },
    /** Hears each change of state; returns how to stop. */
    listen(listener: (state: WriteState) => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/** The writes of this window. */
export const writes = writeStatus()
