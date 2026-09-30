import { describe, expect, it } from 'vitest'
import { comparable, headCount, lastMonth, layOut, placesOf, referenceAxis, type KeptRun, type RunRecord } from '../report.js'
import type { Entity, Scheme } from '../records.js'

const topic: Scheme = {
  scheme: 'topic',
  version: 2,
  items: [
    { code: 'family', label: '가정', parent: null, suggest: true },
    { code: 'relation', label: '관계', parent: null, suggest: true },
    { code: 'relation-peer', label: '또래', parent: 'relation', suggest: true },
    { code: 'learning', label: '학습', parent: null, suggest: true },
  ],
}
const person = (id: string, name: string): Entity => ({ type: 'practitioner', id, subject: null, group: null, people: [], fields: { name }, conflicts: {} })
const run: RunRecord = {
  id: '5',
  at: '2026-05-02T09:00:00+09:00',
  report: { report: 'monthly-topic', version: 2 },
  schemes: { topic: { version: 2, crosswalks: ['1-2'] } },
  period: { from: '2026-04-01', to: '2026-04-30' },
  cells: [
    { row: 'family', column: 'p2', count: 2, records: ['a', 'b'] },
    { row: 'relation-peer', column: 'p1', count: 1, records: ['c'] },
    { row: 'family', column: null, count: 1, records: ['d'] },
  ],
  pending: { count: 1, records: ['e'] },
  unmapped: { count: 1, records: ['f'] },
  total: { count: 6, records: ['a', 'b', 'c', 'd', 'e', 'f'] },
}

describe('layOut', () => {
  const table = layOut(run, [topic], referenceAxis([person('p2', '나'), person('p1', '가')], '(없음)'))

  it('lists every leaf of the report version, in scheme order', () => {
    expect(table.rows.map((r) => r.label)).toEqual(['가정', '관계 › 또래', '학습'])
  })
  it('puts what the column field refers to in name order and the column of records without it last', () => {
    expect(table.columns).toEqual([
      { id: 'p1', label: '가' },
      { id: 'p2', label: '나' },
      { id: null, label: '(없음)' },
    ])
  })
  it('keeps each cell\'s records and adds up rows and columns', () => {
    const family = table.rows[0]
    expect(family.cells.map((c) => c.count)).toEqual([0, 2, 1])
    expect(family.cells[1].records).toEqual(['a', 'b'])
    expect(family.total).toBe(3)
    expect(table.columnTotals).toEqual([1, 2, 1])
  })
  it('balances: placed + pending + unmapped = total', () => {
    expect(table.placed + table.pending.count + table.unmapped.count).toBe(table.total.count)
  })
  it('has no blank records for a run kept without them', () => {
    expect(table.blank).toEqual({ count: 0, records: [] })
  })
  it('keeps records with no value in the row field apart, in the total and in no row', () => {
    // A run lists its blank records inside unmapped too.
    const unmapped = { count: run.unmapped.count + 1, records: [...run.unmapped.records, 'g'] }
    const withBlank: RunRecord = { ...run, unmapped, blank: { count: 1, records: ['g'] }, total: { count: 7, records: [...run.total.records, 'g'] } }
    const t = layOut(withBlank, [topic], referenceAxis([], '(없음)'))
    expect(t.blank.records).toEqual(['g'])
    expect(t.unmapped).toEqual(run.unmapped)
    expect(t.rows.flatMap((r) => r.records)).not.toContain('g')
    expect(t.placed + t.pending.count + t.unmapped.count + t.blank.count).toBe(t.total.count)
    expect(placesOf(withBlank).get('g')).toEqual({ kind: 'blank' })
  })
})

describe('headCount', () => {
  it('counts each person once and every attendee of a group session', () => {
    const withPeople: RunRecord = { ...run, people: { a: ['s1'], b: ['s1', 's2', 's3'], c: ['s2'], d: ['s4'], e: [], f: ['s5'] } }
    expect(headCount(withPeople, ['a', 'b'])).toBe(3)
    expect(headCount(withPeople, withPeople.total.records)).toBe(5)
    expect(headCount(withPeople, ['e'])).toBe(0)
  })
  it('is unknown for a run kept before people were counted', () => {
    expect(headCount(run, ['a'])).toBeNull()
  })
  it('gives the table every record behind its row and column totals', () => {
    const table = layOut(run, [topic], referenceAxis([person('p2', '나'), person('p1', '가')], '(없음)'))
    expect(table.rows[0].records).toEqual(['a', 'b', 'd'])
    expect(table.columnRecords).toEqual([['c'], ['a', 'b'], ['d']])
    expect(table.placedRecords.sort()).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('referenceAxis', () => {
  it('names a column the vault no longer holds by its value', () => {
    const table = layOut(run, [topic], referenceAxis([person('p1', '가')], '(없음)'))
    expect(table.columns.map((c) => c.label)).toEqual(['가', 'p2', '(없음)'])
  })
  it('shows only the column of records without a value when nothing is referred to', () => {
    const lone: RunRecord = { ...run, cells: run.cells.map((c) => ({ ...c, column: null })) }
    expect(layOut(lone, [topic], referenceAxis([], '건수')).columns).toEqual([{ id: null, label: '건수' }])
  })
})

describe('placesOf', () => {
  it('says where the run put each record', () => {
    const places = placesOf(run)
    expect(places.get('a')).toEqual({ kind: 'cell', row: 'family', column: 'p2' })
    expect(places.get('d')).toEqual({ kind: 'cell', row: 'family', column: null })
    expect(places.get('e')).toEqual({ kind: 'pending' })
    expect(places.get('f')).toEqual({ kind: 'unmapped' })
  })
})

describe('comparable', () => {
  const kept = (id: string, name: string, from: string): KeptRun => ({
    id, device: 'pc', at: '', report: { name, version: 1 }, period: { from, to: from.replace('01', '30') }, total: 0,
  })
  it('offers earlier runs of the same form and period, newest first, in any version', () => {
    const runs = [kept('1', 'monthly-topic', '2026-04-01'), kept('3', 'monthly-topic', '2026-04-01'), kept('2', 'other', '2026-04-01'),
      kept('4', 'monthly-topic', '2026-03-01'), kept('5', 'monthly-topic', '2026-04-01'), kept('6', 'monthly-topic', '2026-04-01')]
    expect(comparable(runs, run).map((k) => k.id)).toEqual(['3', '1'])
  })
})

describe('lastMonth', () => {
  it('steps back a month, across a year', () => {
    expect(lastMonth(new Date(2026, 4, 3))).toEqual({ year: 2026, month: 4 })
    expect(lastMonth(new Date(2026, 0, 15))).toEqual({ year: 2025, month: 12 })
  })
})
