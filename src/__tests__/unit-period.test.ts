import { describe, expect, it } from 'vitest'
import { unitPeriodDays } from '../vault/parts.js'
import type { VaultStore } from '../vault/store.js'

const picked = (p: Partial<Pick<VaultStore, 'year' | 'month' | 'day' | 'rangeFrom' | 'rangeTo'>>) =>
  ({ year: 2026, month: 2, day: '', rangeFrom: '', rangeTo: '', ...p }) as VaultStore

describe('the days a form is run over, by its unit', () => {
  it('takes a month to its last day, February included', () => {
    expect(unitPeriodDays(picked({}), 'month', 1)).toEqual({ from: '2026-02-01', to: '2026-02-28' })
  })

  it('takes a year from its start month to the month before it a year on', () => {
    expect(unitPeriodDays(picked({ year: 2026 }), 'year', 3)).toEqual({ from: '2026-03-01', to: '2027-02-28' })
    expect(unitPeriodDays(picked({ year: 2026 }), 'year', 1)).toEqual({ from: '2026-01-01', to: '2026-12-31' })
  })

  it('takes a day or a range only once picked, and a range only in order', () => {
    expect(unitPeriodDays(picked({}), 'day', 1)).toBeUndefined()
    expect(unitPeriodDays(picked({ day: '2026-04-10' }), 'day', 1)).toEqual({ from: '2026-04-10', to: '2026-04-10' })
    expect(unitPeriodDays(picked({ rangeFrom: '2026-05-01', rangeTo: '2026-04-01' }), 'range', 1)).toBeUndefined()
    expect(unitPeriodDays(picked({ rangeFrom: '2026-04-01', rangeTo: '2026-05-01' }), 'range', 1)).toEqual({ from: '2026-04-01', to: '2026-05-01' })
  })
})
