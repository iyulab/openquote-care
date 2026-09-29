import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_IDLE_MINUTES, IdleWatch, idleMinutes, setIdleMinutes } from '../idle.js'

describe('IdleWatch', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('locks once the minutes pass with nobody using the window, and only once', () => {
    const onIdle = vi.fn()
    new IdleWatch(5, onIdle, () => Date.now(), 1000)
    vi.advanceTimersByTime(4 * 60_000)
    expect(onIdle).not.toHaveBeenCalled()
    vi.advanceTimersByTime(60_000)
    expect(onIdle).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(10 * 60_000)
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it('starts counting again whenever the window is used', () => {
    const onIdle = vi.fn()
    const watch = new IdleWatch(5, onIdle, () => Date.now(), 1000)
    vi.advanceTimersByTime(4 * 60_000)
    watch.touch()
    vi.advanceTimersByTime(4 * 60_000)
    expect(onIdle).not.toHaveBeenCalled()
    vi.advanceTimersByTime(60_000)
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it('never locks when turned off or stopped', () => {
    const onIdle = vi.fn()
    new IdleWatch(0, onIdle, () => Date.now(), 1000)
    const stopped = new IdleWatch(1, onIdle, () => Date.now(), 1000)
    stopped.stop()
    vi.advanceTimersByTime(120 * 60_000)
    expect(onIdle).not.toHaveBeenCalled()
  })
})

describe('idle lock setting', () => {
  it('remembers a choice on this computer and falls back to the default', () => {
    const store = new Map<string, string>()
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) }
    expect(idleMinutes(storage)).toBe(DEFAULT_IDLE_MINUTES)
    setIdleMinutes(0, storage)
    expect(idleMinutes(storage)).toBe(0)
    store.set('openquote-care.idle-lock-minutes', '7')
    expect(idleMinutes(storage)).toBe(DEFAULT_IDLE_MINUTES)
    const refusing = { getItem: () => { throw new Error('blocked') } }
    expect(idleMinutes(refusing)).toBe(DEFAULT_IDLE_MINUTES)
  })
})
