import { describe, expect, it } from 'vitest'
import { comparable, headCount, lastMonth, layOut, measureOf, placesOf, referenceAxis, schemeAxis, valueAxis, visitCount, type KeptRun, type RunRecord } from '../report.js'
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

const people = referenceAxis([person('p2', '나'), person('p1', '가')], '(없음)')
const topicAxis = schemeAxis(topic, '(주제 없음)')

describe('layOut', () => {
  const layout = layOut(run, [topicAxis, people])
  const table = layout.sections[0].table

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
  it("keeps each cell's records and adds up rows and columns", () => {
    const family = table.rows[0]
    expect(family.cells.map((c) => c.count)).toEqual([0, 2, 1])
    expect(family.cells[1].records).toEqual(['a', 'b'])
    expect(family.total).toBe(3)
    expect(table.columnTotals).toEqual([1, 2, 1])
  })
  it('balances: placed + pending + unmapped = total', () => {
    expect(table.placed + layout.pending.count + layout.unmapped.count).toBe(layout.total.count)
  })
  it('has one section for a form of two dimensions, and no blank records for a run kept without them', () => {
    expect(layout.sections).toHaveLength(1)
    expect(layout.blank).toEqual({ count: 0, records: [] })
  })
  it('keeps records with no value in the row field apart, in the total and in no row', () => {
    // A run lists its blank records inside unmapped too.
    const unmapped = { count: run.unmapped.count + 1, records: [...run.unmapped.records, 'g'] }
    const withBlank: RunRecord = { ...run, unmapped, blank: { count: 1, records: ['g'] }, total: { count: 7, records: [...run.total.records, 'g'] } }
    const l = layOut(withBlank, [topicAxis, referenceAxis([], '(없음)')])
    const t = l.sections[0].table
    expect(l.blank.records).toEqual(['g'])
    expect(l.unmapped).toEqual(run.unmapped)
    expect(t.rows.flatMap((r) => r.records)).not.toContain('g')
    expect(t.placed + l.pending.count + l.unmapped.count + l.blank.count).toBe(l.total.count)
    expect(placesOf(withBlank).get('g')).toEqual({ kind: 'blank' })
  })
  it('reads a format 1 run: cells by key, blank and conflicted records apart from unmapped and every row', () => {
    const v1: RunRecord = {
      ...run,
      format: 'openquote.run/1',
      cells: run.cells.map((c) => ({ key: [c.row ?? '', c.column ?? null], count: c.count, records: c.records })),
      blank: { count: 1, records: ['g'] },
      conflicted: { count: 1, records: ['h'] },
      total: { count: 8, records: [...run.total.records, 'g', 'h'] },
    }
    const l = layOut(v1, [topicAxis, people])
    const t = l.sections[0].table
    expect(t.rows.map((r) => r.total)).toEqual(table.rows.map((r) => r.total))
    expect(t.columns).toEqual(table.columns)
    expect(l.unmapped).toEqual(run.unmapped)
    expect(l.conflicted.records).toEqual(['h'])
    expect(t.placed + l.pending.count + l.unmapped.count + l.blank.count + l.conflicted.count).toBe(l.total.count)
    expect(placesOf(v1).get('h')).toEqual({ kind: 'conflicted' })
    expect(placesOf(v1).get('c')).toEqual({ kind: 'cell', key: ['relation-peer', 'p1'] })
  })
})

describe('layOut — three dimensions', () => {
  // Grade and class read from the subject, then the topic: a school year by grade, class and topic.
  // The group session x is about students of different grades and classes: no single value there.
  const year: RunRecord = {
    id: '7',
    at: '2027-03-02T09:00:00+09:00',
    format: 'openquote.run/1',
    report: { report: 'year-grade-class', version: 1 },
    schemes: { topic: { version: 2, crosswalks: [] }, 'school-level': { version: 1, crosswalks: [] } },
    period: { from: '2026-03-01', to: '2027-02-28' },
    cells: [
      { key: ['10', '1', 'family'], count: 1, records: ['a'] },
      { key: ['2', '1', 'family'], count: 2, records: ['b', 'c'] },
      { key: ['2', '3', 'learning'], count: 1, records: ['d'] },
      { key: [null, null, 'learning'], count: 1, records: ['x'] },
    ],
    pending: { count: 0, records: [] },
    unmapped: { count: 0, records: [] },
    blank: { count: 0, records: [] },
    conflicted: { count: 0, records: [] },
    total: { count: 5, records: ['a', 'b', 'c', 'd', 'x'] },
    people: { a: ['s1'], b: ['s2'], c: ['s2'], d: ['s3'], x: ['s1', 's2', 's4'] },
  }
  const layout = layOut(year, [valueAxis('(학년 없음)'), valueAxis('(반 없음)'), topicAxis], '전체')

  it('puts all places of the third dimension together first, then each place records fell into, in order', () => {
    expect(layout.sections.map((s) => [s.id, s.label])).toEqual([
      [undefined, '전체'],
      ['family', '가정'],
      ['learning', '학습'],
    ])
  })
  it('orders string values as numbers read, and puts the records with no single value last', () => {
    const all = layout.sections[0].table
    expect(all.rows.map((r) => r.label)).toEqual(['2', '10', '(학년 없음)'])
    expect(all.columns.map((c) => c.label)).toEqual(['1', '3', '(반 없음)'])
  })
  it('counts each section from its own records, and all of them together from every record once', () => {
    const [all, family, learning] = layout.sections.map((s) => s.table)
    expect(all.placed).toBe(5)
    expect(all.rows[0].cells.map((c) => c.count)).toEqual([2, 1, 0])
    expect(family.placed).toBe(3)
    expect(family.rows.map((r) => r.label)).toEqual(['2', '10'])
    expect(learning.rows.map((r) => r.total)).toEqual([1, 1])
  })
  it('measures records, the people behind them and the visits they add up to', () => {
    const records = layout.sections[0].table.placedRecords
    expect([measureOf(year, records, 'records'), measureOf(year, records, 'people'), measureOf(year, records, 'visits')]).toEqual([5, 4, 7])
    expect(visitCount(year, ['x'])).toBe(3)
    expect(visitCount(run, ['a'])).toBeNull()
  })
  it('says where the run put a record along every dimension', () => {
    expect(placesOf(year).get('x')).toEqual({ kind: 'cell', key: [null, null, 'learning'] })
  })
  it('counts a record in several cells of a field holding several values once in every total', () => {
    const several: RunRecord = {
      ...year,
      cells: [
        { key: ['2', '1', 'family'], count: 1, records: ['b'] },
        { key: ['2', '1', 'learning'], count: 1, records: ['b'] },
        { key: ['2', '3', 'family'], count: 1, records: ['d'] },
      ],
      total: { count: 2, records: ['b', 'd'] },
    }
    const all = layOut(several, [valueAxis('-'), valueAxis('-'), topicAxis], '전체').sections[0].table
    expect(all.rows[0].cells.map((c) => c.count)).toEqual([1, 1])
    expect([all.rows[0].total, all.placed]).toEqual([2, 2])
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
    const table = layOut(run, [topicAxis, people]).sections[0].table
    expect(table.rows[0].records).toEqual(['a', 'b', 'd'])
    expect(table.columnRecords).toEqual([['c'], ['a', 'b'], ['d']])
    expect(table.placedRecords.sort()).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('referenceAxis', () => {
  it('names a column the vault no longer holds by its value', () => {
    const table = layOut(run, [topicAxis, referenceAxis([person('p1', '가')], '(없음)')]).sections[0].table
    expect(table.columns.map((c) => c.label)).toEqual(['가', 'p2', '(없음)'])
  })
  it('shows only the column of records without a value when nothing is referred to', () => {
    const lone: RunRecord = { ...run, cells: run.cells.map((c) => ({ ...c, column: null })) }
    expect(layOut(lone, [topicAxis, referenceAxis([], '건수')]).sections[0].table.columns).toEqual([{ id: null, label: '건수' }])
  })
})

describe('placesOf', () => {
  it('says where the run put each record', () => {
    const places = placesOf(run)
    expect(places.get('a')).toEqual({ kind: 'cell', key: ['family', 'p2'] })
    expect(places.get('d')).toEqual({ kind: 'cell', key: ['family', null] })
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
