import { describe, expect, it } from 'vitest'
import { daysBetween, matches, narrowSubjects, shortDay, type SubjectRow } from '../subject-list.js'

const names = new Intl.Collator('en')
const row = (id: string, name: string, words: string, last: string | null, state: SubjectRow['state'], followUp: SubjectRow['followUp'] = null): SubjectRow => ({
  id,
  name,
  words,
  last,
  state,
  followUp,
})
const rows = [
  row('a', 'Ana', 'Ana North School 3 2', '2026-05-21', 'open'),
  row('b', 'Ben', 'Ben South School 1 4', '2026-04-02', 'closed', { followUp: 'overdue', followUpDue: '2026-04-30' }),
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
    expect(narrowSubjects(rows, { query: '', cases: 'overdue', order: 'name' }, names).map((r) => r.id)).toEqual(['b'])
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

describe('the open cases that ask for a session', () => {
  const open = (id: string, name: string, start: string, lastSession: string | null): SubjectRow => ({
    ...row(id, name, name, lastSession ?? start, 'open'),
    openCase: { start, lastSession },
  })
  const given = [
    open('d', 'Dee', '2026-10-01', null),
    open('e', 'Eve', '2026-09-01', '2026-09-17'),
    open('f', 'Fay', '2026-09-20', '2026-09-21'),
    row('g', 'Gus', 'Gus', '2026-09-05', 'closed'),
    row('h', 'Hal', 'Hal', null, null),
  ]

  it('keeps the open cases with no session yet', () => {
    expect(narrowSubjects(given, { query: '', cases: 'unseen', order: 'name' }, names).map((r) => r.id)).toEqual(['d'])
  })

  it('puts the open case whose latest session — or, with none, whose start — lies furthest back first, the rest by name', () => {
    expect(narrowSubjects(given, { query: '', cases: 'all', order: 'quiet' }, names).map((r) => r.id)).toEqual(['e', 'f', 'd', 'g', 'h'])
  })

  it('counts whole days between two dates', () => {
    expect(daysBetween('2026-09-17', '2026-10-09')).toBe(22)
    expect(daysBetween('2026-10-09', '2026-10-09')).toBe(0)
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1)
  })
})
