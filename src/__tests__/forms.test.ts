import { describe, expect, it } from 'vitest'
import { leftBehind, type FormEntry } from '../forms.js'

const lag = { scheme: 'topic', version: 1, latest: 2 }
const form = (name: string, version: number, behind = [lag]): FormEntry => ({ name, version, label: name, behind })

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
