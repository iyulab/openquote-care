import { describe, expect, it } from 'vitest'
import { storeBackup, storedBackup } from '../backup.js'

function memory() {
  const items = new Map<string, string>()
  return {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    removeItem: (k: string) => void items.delete(k),
  }
}

describe('the backup folder this computer keeps', () => {
  it('is kept per vault, and forgotten when the backup stops', () => {
    const storage = memory()
    storeBackup('D:/records', 'E:/copy', storage)
    expect(storedBackup('D:/records', storage)).toBe('E:/copy')
    expect(storedBackup('D:/other', storage)).toBeNull()
    storeBackup('D:/records', null, storage)
    expect(storedBackup('D:/records', storage)).toBeNull()
  })

  it('is none when storage refuses', () => {
    const refusing = { getItem: () => { throw new Error('denied') } }
    expect(storedBackup('D:/records', refusing)).toBeNull()
    expect(() => storeBackup('D:/records', 'E:/copy', { setItem: () => { throw new Error('denied') }, removeItem: () => {} })).not.toThrow()
  })
})
