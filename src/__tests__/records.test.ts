import { describe, expect, it } from 'vitest'
import { choices, conflictsOf, definitionOf, entityOf, labelOf, latest, namesOf, newestFirst, today, type Entity, type Scheme } from '../records.js'

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
  const session = (id: string, date: string): Entity => ({ type: 'session', id, subject: 's', group: null, people: ['s'], fields: { date }, conflicts: {} })
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

  it('reads every definition path a pack can add', () => {
    expect(definitionOf('exports/session-list/v1.json')).toEqual({ kind: 'export', name: 'session-list', version: 1 })
    expect(definitionOf('packs/care.school/v2.json')).toEqual({ kind: 'pack', name: 'care.school', version: 2 })
    expect(definitionOf('labels/kr/v1.ko.json')).toEqual({ kind: 'labels', name: 'kr', version: 1, locale: 'ko' })
    expect(definitionOf('fields/care/session/v1.json')).toEqual({ kind: 'fields', name: 'care', type: 'session', version: 1 })
  })
})

describe('conflictsOf', () => {
  it('lists each concurrently changed field with its values by device', () => {
    const topic = (code: string) => ({ scheme: 'topic', version: 1, code })
    const e: Entity = {
      type: 'session', id: '1', subject: 's', group: null, people: ['s'], fields: { topic: topic('learning') },
      conflicts: { topic: [{ changeId: 'b', device: 'pc02', value: topic('learning') }, { changeId: 'a', device: 'pc01', value: topic('anxiety') }] },
    }
    expect(conflictsOf(e)).toEqual([
      { field: 'topic', heads: [{ changeId: 'a', device: 'pc01', value: topic('anxiety') }, { changeId: 'b', device: 'pc02', value: topic('learning') }] },
    ])
    expect(conflictsOf({ ...e, conflicts: {} })).toEqual([])
  })
})

describe('today', () => {
  it('is the local calendar date', () => {
    expect(today(new Date(2026, 3, 2, 23, 59))).toBe('2026-04-02')
  })
})

describe('namesOf', () => {
  it('names a session\'s subject, or every attendee of a group session', () => {
    const names = new Map([['s1', '가'], ['s2', '나']])
    const one: Entity = { type: 'session', id: '1', subject: 's1', group: null, people: ['s1'], fields: {}, conflicts: {} }
    const group: Entity = { type: 'session', id: '2', subject: null, group: 'g', people: ['s1', 's2', 'gone'], fields: {}, conflicts: {} }
    expect(namesOf(one, names)).toBe('가')
    expect(namesOf(group, names)).toBe('가, 나')
  })
})

describe('entityOf', () => {
  it('names the entity a new change file starts, in a folder of its own or in a flat list', () => {
    expect(entityOf('subjects/0199a1b0-1a02-7c44-8e21-3d9f0a1b2c03/0199a1b0-1a02-7c44-8e21-3d9f0a1b2c03.pc01.json')).toBe('0199a1b0-1a02-7c44-8e21-3d9f0a1b2c03')
    expect(entityOf('groups/0199a1b0-1a02-7c44-8e21-3d9f0a1b2c04/0199a1b0-1a02-7c44-8e21-3d9f0a1b2c04.pc01.json')).toBe('0199a1b0-1a02-7c44-8e21-3d9f0a1b2c04')
    expect(entityOf('practitioners/0199a1b0-1a02-7c44-8e21-3d9f0a1b2c05.pc01.json')).toBe('0199a1b0-1a02-7c44-8e21-3d9f0a1b2c05')
  })
})
