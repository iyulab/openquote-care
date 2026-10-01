import { describe, expect, it } from 'vitest'
import { setSidebarRail, sidebarRail } from '../sidebar-rail.js'

const memory = () => {
  const items = new Map<string, string>()
  return { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v) }
}

describe('sidebar rail', () => {
  it('starts unfolded, and keeps what was last chosen on this computer', () => {
    const storage = memory()
    expect(sidebarRail(storage)).toBe(false)
    setSidebarRail(true, storage)
    expect(sidebarRail(storage)).toBe(true)
    setSidebarRail(false, storage)
    expect(sidebarRail(storage)).toBe(false)
  })

  it('stays unfolded when storage refuses, and a refused write is no error', () => {
    const refusing = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    }
    expect(sidebarRail(refusing)).toBe(false)
    expect(() => setSidebarRail(true, refusing)).not.toThrow()
  })
})
