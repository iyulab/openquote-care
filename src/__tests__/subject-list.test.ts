import { describe, expect, it } from 'vitest'
import { matches, narrowSubjects, shortDay, type SubjectRow } from '../subject-list.js'

const names = new Intl.Collator('en')
const row = (id: string, name: string, words: string, last: string | null, state: SubjectRow['state']): SubjectRow => ({ id, name, words, last, state })
const rows = [
  row('a', 'Ana', 'Ana North School 3 2', '2026-05-21', 'open'),
  row('b', 'Ben', 'Ben South School 1 4', '2026-04-02', 'closed'),
  row('c', 'Cal', 'Cal North School 3 1', null, null),
]

describe('finding a subject by words', () => {
  it('needs every word typed, each anywhere, whatever the case and spacing', () => {
    expect(matches(rows[0], 'north 3')).toBe(true)
    expect(matches(rows[0], '  ANA   north ')).toBe(true)
    expect(matches(rows[0], 'north 4')).toBe(false)
  })

  it('takes nothing typed as every row', () => {
    expect(matches(rows[1], '')).toBe(true)
    expect(matches(rows[1], '   ')).toBe(true)
  })
})

describe('the list a person narrows', () => {
  it('keeps the rows holding the words, by name', () => {
    expect(narrowSubjects(rows, { query: 'north', cases: 'all', order: 'name' }, names).map((r) => r.id)).toEqual(['a', 'c'])
  })

  it('keeps open or ended cases only when asked, leaving out subjects whose cases are not shown', () => {
    expect(narrowSubjects(rows, { query: '', cases: 'open', order: 'name' }, names).map((r) => r.id)).toEqual(['a'])
    expect(narrowSubjects(rows, { query: '', cases: 'closed', order: 'name' }, names).map((r) => r.id)).toEqual(['b'])
    expect(narrowSubjects(rows, { query: '', cases: 'all', order: 'name' }, names)).toHaveLength(3)
  })

  it('orders by the latest record, newest first, those with none last', () => {
    expect(narrowSubjects(rows, { query: '', cases: 'all', order: 'recent' }, names).map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('leaves the rows it was given as they were', () => {
    const given = [...rows].reverse()
    narrowSubjects(given, { query: '', cases: 'all', order: 'name' }, names)
    expect(given.map((r) => r.id)).toEqual(['c', 'b', 'a'])
  })
})

describe('a record day in the list', () => {
  it('is month and day within the year, the whole date otherwise', () => {
    expect(shortDay('2026-05-21', '2026')).toBe('05-21')
    expect(shortDay('2025-12-30', '2026')).toBe('2025-12-30')
  })
})

describe('a name typed as it is written', () => {
  const two = [row('a', 'Kim Ana 1', 'Kim Ana 1 North 3', null, null), row('b', 'Kim Ana 3', 'Kim Ana 3 South 1', null, null)]

  it('finds that name alone, though the words of another row hold its parts', () => {
    expect(narrowSubjects(two, { query: 'ana 3', cases: 'all', order: 'name' }, names).map((r) => r.id)).toEqual(['b'])
  })

  it('falls back to the words anywhere when no name holds what was typed', () => {
    expect(narrowSubjects(two, { query: 'north ana', cases: 'all', order: 'name' }, names).map((r) => r.id)).toEqual(['a'])
  })
})
