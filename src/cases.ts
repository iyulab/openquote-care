import type { CaseView, SubjectCases } from './shell.js'
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

/** What the subject list says of a subject's latest case, when its cases are worth showing. */
export function latestCase(cases: SubjectCases | undefined): string | undefined {
  if (!showsCases(cases)) return undefined
  const latest = cases.cases.at(-1)!
  return latest.open ? strings.caseOpen : strings.caseClosed
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
