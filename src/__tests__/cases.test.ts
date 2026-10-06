import { describe, expect, it } from 'vitest'
import { caseCounts, caseState, latestCase, showsCases } from '../cases.js'
import type { CaseView, SubjectCases } from '../shell.js'
import { strings } from '../strings.js'

const aCase = (patch: Partial<CaseView>): CaseView => ({
  opening: 'i1', closing: null, start: '2026-03-02', end: null, records: ['i1'], afterClosing: [], followedByOpening: false, open: true, ...patch,
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
    expect(latestCase(of(aCase({ open: false, closing: 'c1', end: '2026-04-20' }), aCase({ opening: 'i2' })))).toBe(strings.caseOpen)
    expect(latestCase(of(aCase({ open: false, closing: 'c1', end: '2026-04-20' })))).toBe(strings.caseClosed)
    expect(latestCase(of(aCase({ opening: null })))).toBeUndefined()
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
})
