import { describe, expect, it } from 'vitest'
import { leftBehind, notLaidOut, type FormEntry, type ReportEntry } from '../forms.js'

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

describe('notLaidOut', () => {
  const report = (name: string, version: number, rowsAndColumn: boolean): ReportEntry => ({
    name, version, label: name, behind: [], offered: rowsAndColumn, counts: 'session', periodField: 'date', unit: 'month',
    dimensions: [{ field: 'topic', scheme: 'topic', version: 1, ofSubject: false, all: false }], measures: ['records'], rowsAndColumn,
  })

  it('names a form whose newest version the screen cannot lay out', () => {
    expect(notLaidOut([report('by-level', 1, false), report('monthly', 1, true)]).map((f) => f.name)).toEqual(['by-level'])
  })

  it('goes by the newest version of each form', () => {
    expect(notLaidOut([report('monthly', 1, true), report('monthly', 2, false)]).map((f) => f.version)).toEqual([2])
    expect(notLaidOut([report('monthly', 1, false), report('monthly', 2, true)])).toEqual([])
  })
})
