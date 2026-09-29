import { describe, expect, it } from 'vitest'
import type { Entity } from '../records.js'
import { atSession, fieldOfHeading } from '../subject-fields.js'
import { planImport, tally } from '../subject-import.js'

const subject = (id: string, fields: Record<string, unknown>): Entity => ({ type: 'subject', id, subject: id, group: null, people: [id], fields, conflicts: {} })

describe('planImport', () => {
  const existing = [
    subject('a', { name: '가', mgmt_no: '2026-001', grade: '1' }),
    subject('b', { name: '나' }),
    subject('c', { name: '다' }),
    subject('d', { name: '다' }),
  ]

  it('creates new subjects, updates changed ones, and leaves the same ones alone', () => {
    const plan = planImport(
      [
        ['이름', '관리번호', '학년', '반'],
        ['가', '2026-001', '2', '3'],
        ['나', '', '', ''],
        ['라', '', '1', '1'],
      ],
      existing,
    )
    expect(plan.rows).toEqual([
      { line: 2, kind: 'update', subject: 'a', fields: { grade: '2', class: '3' } },
      { line: 3, kind: 'same', subject: 'b' },
      { line: 4, kind: 'create', fields: { name: '라', grade: '1', class: '1' } },
    ])
    expect(plan.ready).toBe(true)
    expect(tally(plan)).toEqual({ create: 1, update: 1, same: 1, problem: 0 })
  })

  it('never clears a value with an empty cell', () => {
    const plan = planImport([['이름', '학년'], ['가', '']], existing)
    expect(plan.rows[0].kind).toBe('same')
  })

  it('stops on a row it cannot place, and says where', () => {
    const plan = planImport(
      [
        ['성명', '학년'],
        ['', '1'],
        ['다', '2'],
        ['마', '1'],
        ['마', '2'],
      ],
      existing,
    )
    expect(plan.rows.map((r) => (r.kind === 'problem' ? [r.line, r.problem] : [r.line, r.kind]))).toEqual([
      [2, { kind: 'no-name' }],
      [3, { kind: 'ambiguous', name: '다' }],
      [4, 'create'],
      [5, { kind: 'repeated', line: 4 }],
    ])
    expect(plan.ready).toBe(false)
  })

  it('reads only the headings it knows, and needs a name column', () => {
    const plan = planImport([['주민등록번호', '학년'], ['000000-0000000', '1']], [])
    expect(plan.unknownHeadings).toEqual(['주민등록번호'])
    expect(plan.missingName).toBe(true)
    expect(plan.ready).toBe(false)
  })
})

describe('subject fields', () => {
  it('knows a heading by its usual names, spaces aside', () => {
    expect(fieldOfHeading(' 보호자  연락처 ')?.key).toBe('guardian_phone')
    expect(fieldOfHeading('비고')).toBeUndefined()
  })
  it('gives a new session the grade and class of the day', () => {
    expect(atSession({ fields: { name: '가', grade: '2', class: '', gender: 'F' } })).toEqual({ grade: '2' })
  })
})
