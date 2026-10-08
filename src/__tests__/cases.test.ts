import { describe, expect, it } from 'vitest'
import { byCase, caseCounts, caseHead, caseState, changeSigns, followUpWords, latestCaseState, latestFollowUp, scaleLine, showsCases, signed } from '../cases.js'
import type { CaseScale, CaseView, SubjectCases } from '../shell.js'
import { strings } from '../strings.js'

const aCase = (patch: Partial<CaseView>): CaseView => ({
  opening: 'i1', closing: null, start: '2026-03-02', end: null, records: ['i1'], afterClosing: [], followedByOpening: false, open: true,
  followUpDue: null, followUp: 'notExpected', ...patch,
})
const of = (...cases: CaseView[]): SubjectCases => ({ subject: 's1', cases, undated: [] })

describe('cases', () => {
  it('are shown only once a record opened or closed one', () => {
    expect(showsCases(undefined)).toBe(false)
    expect(showsCases(of(aCase({ opening: null })))).toBe(false) // sessions only: nothing to tell
    expect(showsCases(of(aCase({})))).toBe(true)
    expect(showsCases(of(aCase({ opening: null, closing: 'c1', end: '2026-04-01', open: false })))).toBe(true)
  })

  it('say a subject’s latest case in the list', () => {
    expect(latestCaseState(of(aCase({ open: false, closing: 'c1', end: '2026-04-20' }), aCase({ opening: 'i2' })))).toBe('open')
    expect(latestCaseState(of(aCase({ open: false, closing: 'c1', end: '2026-04-20' })))).toBe('closed')
    expect(latestCaseState(of(aCase({ opening: null })))).toBeNull()
  })

  it('tell an ended case from one the next opening followed', () => {
    expect(caseState(aCase({}), '접수')).toBe(strings.caseOpen)
    expect(caseState(aCase({ open: false, closing: 'c1', end: '2026-04-20' }), '접수')).toBe(strings.caseEnded('2026-04-20'))
    expect(caseState(aCase({ open: false, followedByOpening: true }), '접수')).toBe(strings.caseUnended('접수'))
  })

  it('count a case’s records by kind, in the order of the kinds', () => {
    const types: Record<string, string> = { i1: 'intake', s1: 'session', s2: 'session', c1: 'closing' }
    const kinds = [{ type: 'intake', label: '접수' }, { type: 'session', label: '회기' }, { type: 'referral', label: '연계' }, { type: 'closing', label: '종결' }]

    const counted = caseCounts(aCase({ records: ['s2', 'c1', 'i1', 's1'] }), kinds, (id) => types[id])

    expect(counted).toBe([strings.recordCountOf('접수', 1), strings.recordCountOf('회기', 2), strings.recordCountOf('종결', 1)].join(' · '))
  })

  it('head a case with its number, its days and its state', () => {
    expect(caseHead(aCase({}), 2, '접수')).toBe(`${strings.caseTitle(2)} · 2026-03-02 ~ · ${strings.caseOpen}`)
    expect(caseHead(aCase({ open: false, closing: 'c1', end: '2026-04-20' }), 1, '접수')).toBe(
      `${strings.caseTitle(1)} · 2026-03-02 ~ 2026-04-20 · ${strings.caseClosed}`,
    )
    // A closing with nothing before it began and ended on one day: the day once.
    expect(caseHead(aCase({ opening: null, start: '2026-04-20', open: false, closing: 'c1', end: '2026-04-20' }), 1, '접수')).toBe(
      `${strings.caseTitle(1)} · 2026-04-20 · ${strings.caseClosed}`,
    )
  })

  it('split a list by case, newest case first, keeping its order — records after a closing with their case, undated last', () => {
    const first = aCase({ records: ['i1', 's1', 'c1'], afterClosing: ['f1'], closing: 'c1', end: '2026-04-20', open: false })
    const second = aCase({ opening: 'i2', start: '2026-05-04', records: ['i2', 's3'] })
    const rows = ['s3', 'i2', 'f1', 'c1', 's1', 'i1', 'x1'].map((id) => ({ id }))

    const groups = byCase(rows, of(first, second), '접수')

    expect(groups.map((g) => [g.n, g.records.map((r) => r.id)])).toEqual([
      [2, ['s3', 'i2']],
      [1, ['f1', 'c1', 's1', 'i1']],
      [null, ['x1']],
    ])
    expect(groups[0].head).toBe(caseHead(second, 2, '접수'))
    expect(groups[2].head).toBe(strings.caseLoose)
  })

  it('leave out a case none of the listed records are in', () => {
    const groups = byCase([{ id: 's1' }], of(aCase({ records: ['i1', 's1'] }), aCase({ opening: 'i2', records: ['i2'] })), '접수')

    expect(groups.map((g) => g.n)).toEqual([1])
  })

  it('say where the follow-up after a closing stands, and only when the closing expects one', () => {
    const ended = { open: false, closing: 'c1', end: '2026-04-20', followUpDue: '2026-05-18' } as const
    expect(followUpWords(aCase({ ...ended, followUp: 'waiting' }))).toBe(strings.followUpWaiting('2026-05-18'))
    expect(followUpWords(aCase({ ...ended, followUp: 'overdue' }), (d) => d.slice(5))).toBe(strings.followUpOverdue('05-18'))
    expect(followUpWords(aCase({ ...ended, followUp: 'done' }))).toBe(strings.followUpDone)
    expect(followUpWords(aCase({ ...ended, followUp: 'late' }))).toBe(strings.followUpLate)
    expect(followUpWords(aCase({ open: false, closing: 'c1', end: '2026-04-20' }))).toBeNull()
    expect(caseHead(aCase({ ...ended, followUp: 'overdue' }), 1, '접수')).toContain(strings.followUpOverdue('2026-05-18'))
    expect(caseHead(aCase({}), 1, '접수')).not.toContain(' ·  · ')
  })

  it('give the follow-up of a subject’s latest case only', () => {
    const overdue = aCase({ open: false, closing: 'c1', end: '2026-04-20', followUpDue: '2026-05-18', followUp: 'overdue' })
    expect(latestFollowUp(of(overdue))).toEqual({ followUp: 'overdue', followUpDue: '2026-05-18' })
    expect(latestFollowUp(of(overdue, aCase({ opening: 'i2' })))).toBeNull() // a new case opened since
    expect(latestFollowUp(of(aCase({ opening: null })))).toBeNull()
  })

  it('say a scale over a case by its first and last scores and the change, its sign only arithmetic', () => {
    const scale = (patch: Partial<CaseScale>): CaseScale => ({
      scale: 'phq9', baseline: { record: 'r1', day: '2026-03-02', score: 18 }, last: { record: 'r3', day: '2026-04-06', score: 9 },
      responses: 3, paired: true, change: -9, ...patch,
    })

    expect(scaleLine(scale({}), 'PHQ-9')).toBe(strings.caseScale('PHQ-9', 18, '2026-03-02', 9, '2026-04-06', '−9'))
    expect(scaleLine(scale({ paired: false, change: null, last: { record: 'r1', day: '2026-03-02', score: 18 } }), 'PHQ-9')).toBe(
      strings.caseScaleOnce('PHQ-9', 18, '2026-03-02'),
    )
    expect([signed(3), signed(-9), signed(0)]).toEqual(['+3', '−9', '0'])
  })

  it('count the paired cases whose last score is the same as, above or below the first — and leave the unpaired out', () => {
    const c = (paired: boolean, change: number | null) => ({ paired, change })
    expect(changeSigns([c(true, -2), c(true, 0), c(true, 1), c(true, -1), c(false, null), c(true, null)])).toEqual({ same: 1, higher: 1, lower: 2 })
    expect(changeSigns([])).toEqual({ same: 0, higher: 0, lower: 0 })
  })
})

