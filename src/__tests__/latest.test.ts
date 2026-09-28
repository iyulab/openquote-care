import { describe, expect, it } from 'vitest'
import { Latest } from '../latest.js'

describe('Latest', () => {
  it('keeps a read current until another begins', () => {
    const latest = new Latest()
    const first = latest.begin()
    expect(first()).toBe(true)
    const second = latest.begin()
    expect(first()).toBe(false)
    expect(second()).toBe(true)
  })

  it('drops an older read that finishes last', async () => {
    const latest = new Latest()
    const applied: string[] = []
    const read = async (name: string, ms: number) => {
      const current = latest.begin()
      await new Promise((r) => setTimeout(r, ms))
      if (current()) applied.push(name)
    }
    await Promise.all([read('older, slow', 30), read('newer, fast', 5)])
    expect(applied).toEqual(['newer, fast'])
  })
})
