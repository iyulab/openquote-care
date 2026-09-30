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
})
