// Locking an open vault when nobody has used the window for a while.

import { safeStorage } from './device-storage.js'

const KEY = 'openquote-care.idle-lock-minutes'

/** The choices offered for the idle lock, in minutes; 0 turns it off. */
export const IDLE_CHOICES = [0, 5, 10, 15, 30, 60]

/** Used when this computer has no choice stored. */
export const DEFAULT_IDLE_MINUTES = 10

/**
 * The idle lock chosen on this computer. It is a setting of the device, not of the vault — a
 * counselling-room PC and a home laptop sharing one vault may want different ones.
 */
export function idleMinutes(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): number {
  try {
    const n = Number(storage?.getItem(KEY))
    return storage?.getItem(KEY) != null && IDLE_CHOICES.includes(n) ? n : DEFAULT_IDLE_MINUTES
  } catch {
    return DEFAULT_IDLE_MINUTES
  }
}

export function setIdleMinutes(minutes: number, storage: Pick<Storage, 'setItem'> | undefined = safeStorage()): void {
  try {
    storage?.setItem(KEY, String(minutes))
  } catch {
    // Storage refused: the choice lasts until the window closes.
  }
}

/**
 * Calls `onIdle` once `minutes` pass with no `touch()`. Checks on a coarse tick rather than
 * re-arming a timer on every key or mouse move.
 */
export class IdleWatch {
  private last: number
  private timer?: ReturnType<typeof setInterval>

  constructor(
    private readonly minutes: number,
    private readonly onIdle: () => void,
    private readonly now: () => number = Date.now,
    tickMs = 15_000,
  ) {
    this.last = now()
    if (minutes > 0) this.timer = setInterval(() => this.check(), tickMs)
  }

  /** Someone used the window. */
  touch(): void {
    this.last = this.now()
  }

  check(): void {
    if (this.timer !== undefined && this.now() - this.last >= this.minutes * 60_000) {
      this.stop()
      this.onIdle()
    }
  }

  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer)
    this.timer = undefined
  }
}
