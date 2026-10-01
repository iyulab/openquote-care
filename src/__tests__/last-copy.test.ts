import { describe, expect, it } from 'vitest'
import { storeCopy, storedCopy } from '../last-copy.js'

function memory(): Storage {
  const items = new Map<string, string>()
  return {
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => void items.set(k, v),
    removeItem: (k) => void items.delete(k),
    clear: () => items.clear(),
    key: () => null,
    get length() {
      return items.size
    },
  }
}

describe('the last copy this computer made of a vault', () => {
  it('is remembered per vault', () => {
    const storage = memory()
    const copy = { at: 1_790_000_000_000, folder: 'D:/copies/one', withNarrative: true, changes: 42 }
    storeCopy('vault-a', copy, storage)
    expect(storedCopy('vault-a', storage)).toEqual(copy)
    expect(storedCopy('vault-b', storage)).toBeNull()
  })

  it('reads nothing from a value it did not write, or storage that refuses', () => {
    const storage = memory()
    storage.setItem('openquote-care.plain-copy:vault-a', '{"at":"yesterday"}')
    expect(storedCopy('vault-a', storage)).toBeNull()
    storage.setItem('openquote-care.plain-copy:vault-a', 'not json')
    expect(storedCopy('vault-a', storage)).toBeNull()
    const refusing = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
    expect(storedCopy('vault-a', refusing)).toBeNull()
    expect(() => storeCopy('vault-a', { at: 1, folder: 'x', withNarrative: false, changes: 0 }, refusing)).not.toThrow()
  })
})
