import { describe, it, expect } from 'vitest'
import { SAVED_FOR, writeStatus } from '../writes.js'

/** Timers the test runs by hand. */
function clock() {
  const due = new Map<number, () => void>()
  let next = 0
  return {
    timers: { set: (f: () => void) => (due.set(++next, f), next), clear: (id: unknown) => void due.delete(id as number) },
    run: () => [...due.entries()].forEach(([id, f]) => (due.delete(id), f())),
    waiting: () => due.size,
  }
}

describe('write status', () => {
  it('says saving while writes run and saved for a moment after the last one ends well', async () => {
    const time = clock()
    const status = writeStatus(time.timers)
    const heard: string[] = []
    status.listen((s) => heard.push(s))
    let finish!: () => void
    const one = status.track(new Promise<void>((r) => (finish = r)))
    const two = status.track(Promise.resolve('path'))
    expect(await two).toBe('path')
    expect(status.state).toBe('saving')
    finish()
    await one
    expect(status.state).toBe('saved')
    expect(time.waiting()).toBe(1)
    time.run()
    expect(heard).toEqual(['saving', 'saved', 'idle'])
    expect(SAVED_FOR).toBeGreaterThan(1000)
  })

  it('shows nothing for a write that failed, and passes the failure on', async () => {
    const status = writeStatus(clock().timers)
    await expect(status.track(Promise.reject(new Error('no')))).rejects.toThrow('no')
    expect(status.state).toBe('idle')
  })

  it('a new write while saved shows saving again and keeps saved from fading early', async () => {
    const time = clock()
    const status = writeStatus(time.timers)
    await status.track(Promise.resolve())
    expect(status.state).toBe('saved')
    const again = status.track(Promise.resolve())
    expect(status.state).toBe('saving')
    expect(time.waiting()).toBe(0)
    await again
    expect(status.state).toBe('saved')
  })
})
