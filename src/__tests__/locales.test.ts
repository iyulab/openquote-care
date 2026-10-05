import { describe, expect, it } from 'vitest'
import { en } from '../locales/en.js'
import { ko } from '../locales/ko.js'
import { pickLocale } from '../locales/index.js'
import { strings, useLocale } from '../strings.js'

// Every key of a table, with the arity of the functions: a table that drops a key or takes different
// arguments would show a blank or a wrong sentence only in that language.
function shape(value: unknown, path = ''): string[] {
  if (typeof value === 'function') return [`${path}()${value.length}`]
  if (Array.isArray(value)) return [`${path}[${value.length}]`]
  if (value && typeof value === 'object')
    return Object.keys(value)
      .sort()
      .flatMap((k) => shape((value as Record<string, unknown>)[k], path ? `${path}.${k}` : k))
  return [path]
}

describe('locale tables', () => {
  it('every locale table has every key, with functions of the same arity', () => {
    expect(shape(en)).toEqual(shape(ko))
  })

  it('the English table holds no Korean', () => {
    const text = JSON.stringify(en, (_k, v: unknown) => (typeof v === 'function' ? String(v) : v))
    expect(text).not.toMatch(/[ㄱ-ㆎ가-힣]/)
  })

  // The people who use the app are not IT specialists: the folder of records is a record folder, the
  // secret that opens it is a password, and the key on the kit has one name wherever it appears. A
  // data pack is classification material, a field definition a record item, a crosswalk a
  // correspondence table, and the engine is not named at all; a classification has editions (판).
  it('the Korean table calls things by everyday words', () => {
    const text = JSON.stringify(ko, (_k, v: unknown) => (typeof v === 'function' ? String(v) : v))
    for (const word of ['볼트', '패스프레이즈', '사이드바', '데이터 팩', '칸 정의', '연계표', '엔진']) expect(text).not.toContain(word)
    expect(text).not.toMatch(/\bv\$\{/)
  })

  it('names the key on the recovery kit the way the recovery field does', () => {
    for (const table of [ko, en]) expect(table.kitKey).toBe(table.recoveryKey)
  })

  it('picks the table for the first language it has and falls back to English', () => {
    expect(pickLocale(['ko-KR'])).toBe('ko')
    expect(pickLocale(['KO'])).toBe('ko')
    expect(pickLocale(['fr-FR', 'ko-KR'])).toBe('ko')
    expect(pickLocale(['en-US', 'ko'])).toBe('en')
    expect(pickLocale(['fr-FR'])).toBe('en')
    expect(pickLocale([])).toBe('en')
  })

  it('switches the strings every module reads', () => {
    try {
      expect(useLocale('en-GB')).toBe('en')
      expect(strings.createVault).toBe(en.createVault)
      expect(useLocale('ko-KR')).toBe('ko')
      expect(strings.createVault).toBe(ko.createVault)
    } finally {
      useLocale('ko')
    }
  })

  it('names a kind of record in English with the article its first letter takes', () => {
    expect(en.openRecordForm('Intake')).toBe('Add an intake')
    expect(en.openRecordForm('Referral')).toBe('Add a referral')
  })
})
