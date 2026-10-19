// The list of subjects as a person narrows it: found by words, kept to open or ended cases, in an order.

import type { FollowUp } from './shell.js'

/** A subject as the list shows it and finds it. */
export interface SubjectRow {
  id: string
  name: string
  /** Everything the words a person types are looked for in: the name and the record's short values. */
  words: string
  /** `YYYY-MM-DD` of its latest dated record, or null when it has none. */
  last: string | null
  /** Its latest case: open, ended, or null when its cases are not worth showing. */
  state: 'open' | 'closed' | null
  /** The follow-up its latest case expects after the closing, or null when it expects none. */
  followUp: { followUp: FollowUp; followUpDue: string } | null
  /** Its latest case while it is open: the day it began, and the day of its latest session — null when it has had none. */
  openCase?: { start: string; lastSession: string | null } | null
  /** The day of its oldest record still waiting for an answer (null when that record has none), or undefined when none waits. */
  awaiting?: string | null
  /** The day of its next meeting, as its latest record of a kind that sets one names; undefined when none does. */
  planned?: string
}

/**
 * Which cases a person keeps in view; `overdue`, those whose latest case's follow-up is past its day; `unseen`, those
 * whose latest case is open and has had no session yet; `awaiting`, those with a record still waiting for an answer;
 * `today`, those whose next meeting is today.
 */
export type CaseFilter = 'all' | 'open' | 'closed' | 'overdue' | 'unseen' | 'awaiting' | 'today'

/**
 * How the list is ordered: by name; the latest record first; or `quiet` — the open cases first, the one whose latest
 * session (or, with none, whose start) lies furthest back at the top, then the rest by name.
 */
export type SubjectOrder = 'name' | 'recent' | 'quiet'

/** Lower-cased and with runs of space as one: how words are compared. */
const fold = (s: string) => s.toLocaleLowerCase().replace(/\s+/g, ' ').trim()

/** Whether a row holds every word typed, each anywhere in its name or values. */
export function matches(row: Pick<SubjectRow, 'words'>, query: string): boolean {
  const words = fold(row.words)
  return fold(query)
    .split(' ')
    .filter(Boolean)
    .every((w) => words.includes(w))
}

/**
 * The rows a person sees: those whose name holds what was typed, as typed — or, when no name does, those holding
 * every word typed anywhere in their name and values — and whose latest case is in the state kept (any, when all
 * are; past the day its follow-up was due, for `overdue`; meeting on `o.today`, for `today`), in the order chosen. By the latest record, the newest first and those with none last, each tie by name.
 */
export function narrowSubjects(
  rows: readonly SubjectRow[],
  o: { query: string; cases: CaseFilter; order: SubjectOrder; today?: string },
  names: Pick<Intl.Collator, 'compare'>,
): SubjectRow[] {
  const byName = (a: SubjectRow, b: SubjectRow) => names.compare(a.name, b.name)
  const byRecent = (a: SubjectRow, b: SubjectRow) => (b.last ?? '').localeCompare(a.last ?? '') || byName(a, b)
  const since = (r: SubjectRow) => (r.openCase ? (r.openCase.lastSession ?? r.openCase.start) : null)
  const byQuiet = (a: SubjectRow, b: SubjectRow) => {
    const [x, y] = [since(a), since(b)]
    if (x !== null && y !== null) return x.localeCompare(y) || byName(a, b)
    return x !== null ? -1 : y !== null ? 1 : byName(a, b)
  }
  const typed = fold(o.query)
  const named = typed === '' ? [] : rows.filter((r) => fold(r.name).includes(typed))
  const found = named.length > 0 ? named : rows.filter((r) => matches(r, o.query))
  return found
    .filter((r) => o.cases === 'all' || keeps(r, o.cases, o.today))
    .sort(o.order === 'recent' ? byRecent : o.order === 'quiet' ? byQuiet : byName)
}

/** Whether a row is among the cases `filter` keeps in view (anything but `all`); `today` keeps none without the day. */
function keeps(r: SubjectRow, filter: Exclude<CaseFilter, 'all'>, today: string | undefined): boolean {
  switch (filter) {
    case 'overdue':
      return r.followUp?.followUp === 'overdue'
    case 'unseen':
      return !!r.openCase && r.openCase.lastSession === null
    case 'awaiting':
      return r.awaiting !== undefined
    case 'today':
      return today !== undefined && r.planned === today
    default:
      return r.state === filter
  }
}

/** A record's day as the list says it: month and day within `year`, the whole date otherwise. */
export function shortDay(day: string, year: string): string {
  return day.startsWith(`${year}-`) ? day.slice(5) : day
}

/** Whole days from `from` to `to`, both `YYYY-MM-DD` — what a list says as «n days ago». */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/** A name as two are compared to find the same person: letters only, spaces left out, any case. */
const bare = (s: string) => s.toLocaleLowerCase().replace(/\s+/g, '')

/** What `alreadyHere` found: the people to show, and how many more it matched beyond them. */
export interface AlreadyHere {
  found: { row: SubjectRow; same: boolean }[]
  more: number
}

/**
 * While a new person's name is typed, the people already here who may be the one: the same name, spaces and case
 * aside, first — then names that hold what was typed or are held in it — at most five, with how many more matched,
 * so a sixth person of one name is never silently left out. Among one name, the person with the latest record comes
 * first; otherwise by name. Nothing until two letters are typed. It only shows; whether it is the same person is the
 * practitioner's to say.
 */
export function alreadyHere(rows: readonly SubjectRow[], typed: string, names: Pick<Intl.Collator, 'compare'>): AlreadyHere {
  const t = bare(typed)
  if (t.length < 2) return { found: [], more: 0 }
  const matched = rows
    .map((row) => ({ row, name: bare(row.name) }))
    .filter(({ name }) => name.length >= 2 && (name.includes(t) || t.includes(name)))
    .map(({ row, name }) => ({ row, same: name === t }))
    .sort((a, b) => Number(b.same) - Number(a.same) || names.compare(a.row.name, b.row.name) || (b.row.last ?? '').localeCompare(a.row.last ?? ''))
  return { found: matched.slice(0, 5), more: Math.max(0, matched.length - 5) }
}
