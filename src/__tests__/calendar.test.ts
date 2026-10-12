import { describe, expect, it } from 'vitest'
import { marksByDay, monthDays, monthOf, shiftMonth } from '../calendar.js'

describe('monthDays', () => {
  it('lays a month out in whole weeks from the Sunday on or before its first day', () => {
    // October 2026 starts on a Thursday and ends on a Saturday: five weeks, from 27 September.
    const days = monthDays({ year: 2026, month: 10 })
    expect(days).toHaveLength(35)
    expect(days[0]).toBe('2026-09-27')
    expect(days[4]).toBe('2026-10-01')
    expect(days.at(-1)).toBe('2026-10-31')
  })

  it('takes six weeks when the month needs them, and four when it fits', () => {
    // August 2026 starts on a Saturday and has 31 days; February 2026 starts on a Sunday and has 28.
    expect(monthDays({ year: 2026, month: 8 })).toHaveLength(42)
    expect(monthDays({ year: 2026, month: 2 })).toHaveLength(28)
    expect(monthDays({ year: 2026, month: 2 })[0]).toBe('2026-02-01')
  })
})

describe('months', () => {
  it('steps across years', () => {
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 })
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 })
    expect(monthOf('2026-03-09')).toEqual({ year: 2026, month: 3 })
  })
})

describe('marksByDay', () => {
  it('puts each planned meeting, follow-up still to come and record on its day', () => {
    const days = marksByDay({
      planned: [{ subject: 'a', day: '2026-10-13' }],
      followUps: [
        { subject: 'b', due: '2026-10-13', state: 'waiting' },
        { subject: 'c', due: '2026-10-02', state: 'overdue' },
        { subject: 'd', due: '2026-10-05', state: 'done' },
        { subject: 'e', due: '2026-10-06', state: 'late' },
      ],
      records: [
        { id: 'r1', day: '2026-10-02' },
        { id: 'r2', day: '2026-10-02' },
        { id: 'r3', day: '' },
      ],
    })
    expect(days.get('2026-10-13')).toEqual({ meetings: ['a'], followUps: [{ subject: 'b', overdue: false }], records: [] })
    expect(days.get('2026-10-02')).toEqual({ meetings: [], followUps: [{ subject: 'c', overdue: true }], records: ['r1', 'r2'] })
    // A follow-up that came asks for nothing; a record with no day falls on none.
    expect(days.has('2026-10-05')).toBe(false)
    expect(days.has('2026-10-06')).toBe(false)
    expect(days.has('')).toBe(false)
  })
})
