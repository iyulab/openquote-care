import { describe, expect, it } from 'vitest'
import { nameCollator } from '../collation.js'

describe('nameCollator', () => {
  it('orders names as Korean when the vault names no locale', () => {
    const names = ['하늘', '가람', 'Zoe', '나래']
    expect([...names].sort(nameCollator().compare)).toEqual([...names].sort((a, b) => a.localeCompare(b, 'ko')))
    expect(nameCollator([]).resolvedOptions().locale).toMatch(/^ko/)
  })

  it('follows the most specific locale the vault names', () => {
    expect(nameCollator(['sv', 'en']).resolvedOptions().locale).toMatch(/^sv/)
    // Swedish puts ä after z; English puts it with a.
    expect(['ä', 'z', 'a'].sort(nameCollator(['sv']).compare)).toEqual(['a', 'z', 'ä'])
    expect(['ä', 'z', 'a'].sort(nameCollator(['en']).compare)).toEqual(['a', 'ä', 'z'])
  })
})
