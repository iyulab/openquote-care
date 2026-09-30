import { afterEach, describe, expect, it } from 'vitest'
import { nameCollator } from '../collation.js'
import { useLocale } from '../strings.js'

describe('nameCollator', () => {
  afterEach(() => useLocale('en'))

  it("orders names in the app's language when the vault names no locale", () => {
    useLocale('ko-KR')
    const names = ['하늘', '가람', 'Zoe', '나래']
    expect([...names].sort(nameCollator().compare)).toEqual([...names].sort(new Intl.Collator('ko').compare))
    expect(nameCollator([]).resolvedOptions().locale).toMatch(/^ko/)
    useLocale('en-US')
    expect(nameCollator([]).resolvedOptions().locale).toMatch(/^en/)
  })

  it('follows the most specific locale the vault names', () => {
    expect(nameCollator(['sv', 'en']).resolvedOptions().locale).toMatch(/^sv/)
    // Swedish puts ä after z; English puts it with a.
    expect(['ä', 'z', 'a'].sort(nameCollator(['sv']).compare)).toEqual(['a', 'z', 'ä'])
    expect(['ä', 'z', 'a'].sort(nameCollator(['en']).compare)).toEqual(['a', 'ä', 'z'])
  })
})
