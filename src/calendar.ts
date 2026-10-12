// The calendar's arithmetic: a month laid out in weeks, and the days the vault's records already name — the next
// session a session plans, the day a closing's follow-up is due, the day a record was made. Nothing is entered here.

/** A month by its year and its number (1–12). */
export interface Month {
  year: number
  month: number
}

const pad = (n: number) => String(n).padStart(2, '0')

/** A day as `YYYY-MM-DD`. */
export function dayOf(year: number, month: number, date: number): string {
  return `${year}-${pad(month)}-${pad(date)}`
}

/** The month holding `day` (`YYYY-MM-DD`). */
export function monthOf(day: string): Month {
  const [year, month] = day.split('-').map(Number)
  return { year, month }
}

/** The month `by` months after `m` (before it when negative). */
export function shiftMonth(m: Month, by: number): Month {
  const n = m.year * 12 + (m.month - 1) + by
  return { year: Math.floor(n / 12), month: (n % 12) + 1 }
}

/**
 * The days a calendar shows for a month: whole weeks from the Sunday on or before its first day to the Saturday on or
 * after its last — four to six weeks, as the month needs.
 */
export function monthDays(m: Month): string[] {
  const first = new Date(m.year, m.month - 1, 1)
  const start = new Date(m.year, m.month - 1, 1 - first.getDay())
  const last = new Date(m.year, m.month, 0)
  const weeks = Math.ceil((first.getDay() + last.getDate()) / 7)
  return Array.from({ length: weeks * 7 }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    return dayOf(d.getFullYear(), d.getMonth() + 1, d.getDate())
  })
}

/** What falls on one day: the people meeting then, the follow-ups due then, the records made then. */
export interface DayMarks {
  /** Subjects whose latest session names this day as the next. */
  meetings: string[]
  /** Subjects whose closed case's follow-up is due this day and has not come; `overdue` once the day has passed. */
  followUps: { subject: string; overdue: boolean }[]
  /** Records made this day, by id. */
  records: string[]
}

/** What each day holds, from the days the records name; a day with nothing is not in the map. */
export function marksByDay(input: {
  planned: readonly { subject: string; day: string }[]
  followUps: readonly { subject: string; due: string; state: string }[]
  records: readonly { id: string; day: string }[]
}): Map<string, DayMarks> {
  const days = new Map<string, DayMarks>()
  const at = (day: string) => {
    let marks = days.get(day)
    if (!marks) days.set(day, (marks = { meetings: [], followUps: [], records: [] }))
    return marks
  }
  for (const p of input.planned) at(p.day).meetings.push(p.subject)
  // Only a follow-up still to come: one that came — on time or late — asks for nothing on its day.
  for (const f of input.followUps)
    if (f.state === 'waiting' || f.state === 'overdue') at(f.due).followUps.push({ subject: f.subject, overdue: f.state === 'overdue' })
  for (const r of input.records) if (r.day) at(r.day).records.push(r.id)
  return days
}
