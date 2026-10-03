import { describe, expect, it } from 'vitest'
import { leftBehind, yearStart, type FormEntry, type ReportEntry } from '../forms.js'

const lag = { scheme: 'topic', version: 1, latest: 2 }
const form = (name: string, version: number, behind = [lag]): FormEntry => ({ name, version, label: name, behind, offered: true })

describe('leftBehind', () => {
  it('names a form whose newest version still uses an older scheme version', () => {
    expect(leftBehind([form('list', 1)]).map((f) => f.name)).toEqual(['list'])
  })

  it('does not count older versions of a form that has caught up', () => {
    expect(leftBehind([form('monthly', 1), form('monthly', 2, [])])).toEqual([])
  })

  it('is empty when no form lags', () => {
    expect(leftBehind([form('monthly', 2, [])])).toEqual([])
  })
})

describe('yearStart', () => {
  const report = (unit: ReportEntry['unit'], startMonth: number): ReportEntry => ({
    ...form('r', 1, []),
    counts: 'session',
    periodField: 'date',
    unit,
    startMonth,
    dimensions: [],
    measures: ['records'],
    filters: [],
  })

  it('is the start month the year forms use', () => expect(yearStart([report('year', 3), report('month', 1)])).toBe(3))
  it('lets a calendar-year form stand beside one from another month', () => expect(yearStart([report('year', 1), report('year', 3)])).toBe(3))
  it('is January when year forms disagree', () => expect(yearStart([report('year', 3), report('year', 9)])).toBe(1))
  it('is January without a year form', () => expect(yearStart([report('month', 1)])).toBe(1))
})
