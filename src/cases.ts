import type { CaseScale, CaseView, FollowUp, SubjectCases } from './shell.js'
import { strings } from './strings.js'

/**
 * Whether a subject's cases are worth showing: some case was opened or closed by a record. A subject whose
 * records only ever were sessions — every vault before intakes and closings, or a practice that keeps none —
 * has one case that nothing opened or closed, and saying so would only be noise.
 */
export function showsCases(cases: SubjectCases | undefined): cases is SubjectCases {
  return !!cases?.cases.some((c) => c.opening !== null || c.closing !== null)
}

/** The state of a case in words: open, ended on a day, or followed by another opening before anything ended it. */
export function caseState(c: CaseView, opening: string): string {
  if (c.open) return strings.caseOpen
  if (c.closing !== null && c.end !== null) return strings.caseEnded(c.end)
  return strings.caseUnended(opening)
}

/**
 * Where a closed case's follow-up stands, in words — by when it is due, that the day passed, or that it came — or
 * null when the closing expects none. `day` shortens the due day as the place it is shown does.
 */
export function followUpWords(c: Pick<CaseView, 'followUp' | 'followUpDue'>, day: (d: string) => string = (d) => d): string | null {
  const due = c.followUpDue
  if (due === null) return null
  switch (c.followUp) {
    case 'waiting':
      return strings.followUpWaiting(day(due))
    case 'overdue':
      return strings.followUpOverdue(day(due))
    case 'done':
      return strings.followUpDone
    case 'late':
      return strings.followUpLate
    default:
      return null
  }
}

/** The follow-up of a subject's latest case, when its cases are worth showing and that case expects one. */
export function latestFollowUp(cases: SubjectCases | undefined): { followUp: FollowUp; followUpDue: string } | null {
  if (!showsCases(cases)) return null
  const last = cases.cases.at(-1)!
  return last.followUpDue === null || last.followUp === 'notExpected' ? null : { followUp: last.followUp, followUpDue: last.followUpDue }
}

/** Whether a subject's latest case is open or ended, when its cases are worth showing; null when they are not. */
export function latestCaseState(cases: SubjectCases | undefined): 'open' | 'closed' | null {
  if (!showsCases(cases)) return null
  return cases.cases.at(-1)!.open ? 'open' : 'closed'
}

/**
 * A case's records counted by kind, in the order of the kinds — "Intake: 1 · Session: 4 · Closing: 1" in an
 * English vault.
 */
export function caseCounts(c: CaseView, kinds: { type: string; label: string }[], typeOf: (id: string) => string | undefined): string {
  const counts = new Map<string, number>()
  for (const id of c.records) {
    const type = typeOf(id)
    if (type !== undefined) counts.set(type, (counts.get(type) ?? 0) + 1)
  }
  return kinds
    .filter((k) => counts.has(k.type))
    .map((k) => strings.recordCountOf(k.label, counts.get(k.type)!))
    .join(' · ')
}

/** A case's days: from its first day on while open, the one day when it began and ended on it, else both. */
export function caseDays(c: CaseView): string {
  return c.end === null ? `${c.start} ~` : c.end === c.start ? c.start : `${c.start} ~ ${c.end}`
}

/** A case's state beside its days, which already hold the day it ended: open, ended, or followed by another opening. */
export function caseStateBesideDays(c: CaseView, opening: string): string {
  return c.closing !== null && c.end !== null ? strings.caseClosed : caseState(c, opening)
}

/** A case's heading over its records in a list: its number, its days and its state. */
export function caseHead(c: CaseView, n: number, opening: string): string {
  return [strings.caseTitle(n), caseDays(c), caseStateBesideDays(c, opening), followUpWords(c)]
    .filter((part) => part !== null)
    .join(' · ')
}

/** Records of one case in a list, under its heading; `n` is null for the records no case holds. */
export interface CaseGroup<T> {
  n: number | null
  head: string
  records: T[]
}

/**
 * A subject's records split by the case each belongs to — its own records and those after its closing — the newest
 * case first, each keeping the records' order. A case with none of these records is left out; records no case holds
 * (those with no date) come last, under a heading of their own.
 */
export function byCase<T extends { id: string }>(records: readonly T[], subjectCases: SubjectCases, opening: string): CaseGroup<T>[] {
  const caseOf = new Map<string, number>()
  subjectCases.cases.forEach((c, i) => {
    for (const id of [...c.records, ...c.afterClosing]) caseOf.set(id, i)
  })
  const groups = subjectCases.cases.map((c, i): CaseGroup<T> => ({ n: i + 1, head: caseHead(c, i + 1, opening), records: [] }))
  const loose: T[] = []
  for (const r of records) {
    const i = caseOf.get(r.id)
    if (i === undefined) loose.push(r)
    else groups[i].records.push(r)
  }
  const held = groups.filter((g) => g.records.length > 0).reverse()
  return loose.length > 0 ? [...held, { n: null, head: strings.caseLoose, records: loose }] : held
}

/** A change in words, its sign only arithmetic: +3, −9, 0. */
export function signed(change: number): string {
  return change > 0 ? `+${change}` : change < 0 ? `−${-change}` : '0'
}

/**
 * One scale over a case in words: the first score and the last, with their days and the change between them — or the
 * one day's score when there is no other. Nothing says whether the change is better or worse.
 */
/**
 * How the paired cases' last scores stand against their first: the same, higher or lower — the sign of
 * the difference and nothing more. Which way is better is the scale's own fact, not said here.
 */
export function changeSigns(cases: readonly Pick<CaseScale, 'paired' | 'change'>[]): { same: number; higher: number; lower: number } {
  const signs = { same: 0, higher: 0, lower: 0 }
  for (const c of cases) {
    if (!c.paired || c.change === null) continue
    if (c.change > 0) signs.higher += 1
    else if (c.change < 0) signs.lower += 1
    else signs.same += 1
  }
  return signs
}

export function scaleLine(s: Pick<CaseScale, 'baseline' | 'last' | 'paired' | 'change'>, label: string): string {
  return s.paired && s.change !== null
    ? strings.caseScale(label, s.baseline.score, s.baseline.day, s.last.score, s.last.day, signed(s.change))
    : strings.caseScaleOnce(label, s.last.score, s.last.day)
}
