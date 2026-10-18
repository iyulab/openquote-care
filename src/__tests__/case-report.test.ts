import { describe, expect, it } from 'vitest'
import { caseReport, choosableSubjectFields, type CaseReportInput, type ReportRecord } from '../case-report.js'
import type { FieldView } from '../shell.js'

function field(name: string, kind: FieldView['kind'], more: Partial<FieldView> = {}): FieldView {
  return { name, kind, scheme: null, refType: null, required: false, hidden: false, tier: 'structured', defaultFromSubject: null, label: name.toUpperCase(), aliases: [], ...more }
}

const subjectFields = [
  field('name', 'text'),
  field('school', 'text'),
  field('phone', 'text'),
  field('gender', 'coded', { scheme: 'gender' }),
  field('grade', 'number'),
  field('secret', 'coded', { hidden: true }),
]

const fields: Record<string, FieldView[]> = {
  intake: [field('date', 'date'), field('source', 'coded'), field('presenting', 'text', { tier: 'narrative' })],
  session: [field('date', 'date'), field('topic', 'coded'), field('grade', 'number', { defaultFromSubject: 'grade' }), field('practitioner', 'reference', { refType: 'practitioner' }), field('next', 'date'), field('note', 'text', { tier: 'narrative' })],
  goal: [field('set', 'date'), field('goal', 'text')],
  'scale-score': [field('date', 'date'), field('scale', 'coded'), field('score', 'number')],
  closing: [field('date', 'date'), field('reason', 'coded'), field('summary', 'text', { tier: 'narrative' })],
}

function record(id: string, type: string, day: string, values: Record<string, unknown>, more: Partial<ReportRecord> = {}): ReportRecord {
  return { id, type, day, after: false, group: false, fields: values, ...more }
}

function input(more: Partial<CaseReportInput> = {}): CaseReportInput {
  return {
    name: '김하늘',
    mask: 'initial',
    subject: [
      { field: subjectFields[0], text: '김하늘' },
      { field: subjectFields[1], text: '하늘중학교' },
      { field: subjectFields[2], text: '010-0000-0000' },
      { field: subjectFields[3], text: '여' },
      { field: subjectFields[4], text: '2' },
      { field: subjectFields[5], text: 'x' },
    ],
    chosen: new Set(),
    withContent: false,
    records: [
      record('i', 'intake', '2026-03-02', { date: '2026-03-02', source: 'self', presenting: '친구 관계가 힘듦' }),
      record('g', 'goal', '2026-03-03', { set: '2026-03-03', goal: '친구에게 먼저 말 걸기' }),
      record('s1', 'session', '2026-03-09', { date: '2026-03-09', topic: 'peer', grade: 2, practitioner: 'p', next: '2026-03-16', note: '김하늘은 이야기를 많이 함' }),
      record('m', 'scale-score', '2026-03-09', { date: '2026-03-09', scale: 'x', score: 7 }),
      record('s2', 'session', '2026-03-16', { date: '2026-03-16', topic: 'peer', practitioner: 'p' }, { group: true }),
      record('c', 'closing', '2026-04-20', { date: '2026-04-20', reason: 'done', summary: '목표를 이룸' }),
      record('f', 'session', '2026-05-20', { date: '2026-05-20', topic: 'follow' }, { after: true }),
    ],
    // Given out of order: the report puts the opening kind first and the closing kind last.
    kinds: [
      { type: 'closing', label: '종결', role: 'closes', order: 40, dated: 'date' },
      { type: 'session', label: '회기', role: null, order: 20, dated: 'date' },
      { type: 'scale-score', label: '척도', role: null, order: 25, dated: 'date' },
      { type: 'goal', label: '상담 목표', role: null, order: 15, dated: 'set' },
      { type: 'intake', label: '접수', role: 'opens', order: 10, dated: 'date' },
      { type: 'referral', label: '연계', role: null, order: 30, dated: 'date' },
    ],
    fieldsOf: (type) => fields[type] ?? [],
    text: (f, v) => (v === undefined ? '' : f.kind === 'reference' ? '박상담' : String(v)),
    scaleType: 'scale-score',
    ...more,
  }
}

describe('case report', () => {
  it('covers the name and carries none of the written fields that name the person', () => {
    const report = caseReport(input({ chosen: new Set(['school', 'phone', 'gender', 'grade', 'secret']) }))
    expect(report.person).toBe('김○○')
    expect(report.personFields).toEqual([
      { label: 'GENDER', text: '여' },
      { label: 'GRADE', text: '2' },
    ])
    expect(JSON.stringify(report)).not.toContain('하늘중학교')
    expect(JSON.stringify(report)).not.toContain('010-')
  })

  it('carries only the fields picked, and the name as it is when asked', () => {
    const report = caseReport(input({ mask: 'none', chosen: new Set(['gender']) }))
    expect(report.person).toBe('김하늘')
    expect(report.personFields).toEqual([{ label: 'GENDER', text: '여' }])
  })

  it('offers only shown codes and numbers of the person to pick', () => {
    expect(choosableSubjectFields(subjectFields).map((f) => f.name)).toEqual(['gender', 'grade'])
  })

  it('opens with the kind that opened the case, ends with the one that closed it, the rest in the packs order', () => {
    const report = caseReport(input())
    expect(report.sections.map((s) => s.title)).toEqual(['접수', '상담 목표', '회기', '종결'])
  })

  it('tells scale scores by their own lines, not as a section, and leaves out kinds the case has none of', () => {
    const titles = caseReport(input()).sections.map((s) => s.type)
    expect(titles).not.toContain('scale-score')
    expect(titles).not.toContain('referral')
  })

  it('leaves out the day field, what a record took from the person, and written content unless asked', () => {
    const session = caseReport(input()).sections.find((s) => s.type === 'session')!
    expect(session.lines[0]).toEqual({
      day: '2026-03-09',
      after: false,
      group: false,
      values: [
        { label: 'TOPIC', text: 'peer' },
        { label: 'PRACTITIONER', text: '박상담' },
        { label: 'NEXT', text: '2026-03-16' },
      ],
      content: [],
    })
    expect(JSON.stringify(caseReport(input()))).not.toContain('친구 관계가 힘듦')
  })

  it('carries written content when asked — the names in it as written', () => {
    const report = caseReport(input({ withContent: true }))
    expect(report.sections[0].lines[0].content).toEqual([{ label: 'PRESENTING', text: '친구 관계가 힘듦' }])
    expect(report.sections.find((s) => s.type === 'session')!.lines[0].content).toEqual([{ label: 'NOTE', text: '김하늘은 이야기를 많이 함' }])
  })

  it('says which records came in a group and which after the case ended', () => {
    const lines = caseReport(input()).sections.find((s) => s.type === 'session')!.lines
    expect(lines.map((l) => [l.day, l.group, l.after])).toEqual([
      ['2026-03-09', false, false],
      ['2026-03-16', true, false],
      ['2026-05-20', false, true],
    ])
  })

  it('takes the day of a kind dated by another field out of its values', () => {
    const goal = caseReport(input()).sections.find((s) => s.type === 'goal')!
    expect(goal.lines[0].values).toEqual([{ label: 'GOAL', text: '친구에게 먼저 말 걸기' }])
  })
})
