import { describe, expect, it } from 'vitest'
import { choices, definitionOf, labelOf, latest, newestFirst, today, type Entity, type Scheme } from '../records.js'

const method: Scheme = {
  scheme: 'method',
  version: 1,
  items: [
    { code: 'interview', label: '면담', parent: null, suggest: true },
    { code: 'special', label: '특별', parent: null, suggest: true },
    { code: 'special/school-violence', label: '학교폭력', parent: 'special', suggest: true },
  ],
}
const topic = (version: number, code: string, label: string): Scheme => ({
  scheme: 'topic',
  version,
  items: [{ code, label, parent: null, suggest: true }],
})

describe('latest', () => {
  it('picks the highest version of the named scheme', () => {
    expect(latest([topic(1, 'a', 'A'), topic(2, 'b', 'B'), method], 'topic')?.version).toBe(2)
    expect(latest([method], 'topic')).toBeUndefined()
  })
})

describe('choices', () => {
  it('offers leaves, labels a child with its parent, and makes a parent a heading', () => {
    expect(choices(method)).toEqual([
      { value: 'interview', label: '면담' },
      { value: 'special', label: '특별', disabled: true },
      { value: 'special/school-violence', label: '특별 › 학교폭력' },
    ])
  })
})

describe('labelOf', () => {
  const schemes = [topic(1, 'family', '가정'), topic(2, 'family', '가족')]
  it('reads the label in the version the value was recorded in', () => {
    expect(labelOf(schemes, { scheme: 'topic', version: 1, code: 'family' })).toBe('가정')
    expect(labelOf(schemes, { scheme: 'topic', version: 2, code: 'family' })).toBe('가족')
  })
  it('falls back to the code, and to nothing for an empty value', () => {
    expect(labelOf(schemes, { scheme: 'topic', version: 9, code: 'gone' })).toBe('gone')
    expect(labelOf(schemes, null)).toBe('')
  })
})

describe('newestFirst', () => {
  const session = (id: string, date: string): Entity => ({ type: 'session', id, subject: 's', fields: { date }, conflicts: {} })
  it('orders by the written date, then by id', () => {
    const sorted = newestFirst([session('1', '2026-04-01'), session('3', '2026-04-02'), session('2', '2026-04-02')])
    expect(sorted.map((s) => s.id)).toEqual(['3', '2', '1'])
  })
})

describe('definitionOf', () => {
  it('reads schemes, crosswalks and report forms from their paths', () => {
    expect(definitionOf('schemes/topic/v2.json')).toEqual({ kind: 'scheme', name: 'topic', version: 2 })
    expect(definitionOf('schemes/topic/v1-v2.json')).toEqual({ kind: 'crosswalk', name: 'topic', from: 1, to: 2 })
    expect(definitionOf('reports/monthly-topic/v2.json')).toEqual({ kind: 'report', name: 'monthly-topic', version: 2 })
    expect(definitionOf('subjects/x/y.json')).toBeUndefined()
  })
})

describe('today', () => {
  it('is the local calendar date', () => {
    expect(today(new Date(2026, 3, 2, 23, 59))).toBe('2026-04-02')
  })
})
