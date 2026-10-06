// The list of subjects as a person narrows it: found by words, kept to open or ended cases, in an order.

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
}

/** Which cases a person keeps in view. */
export type CaseFilter = 'all' | 'open' | 'closed'

/** How the list is ordered: by name, or the latest record first. */
export type SubjectOrder = 'name' | 'recent'

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
 * are), in the order chosen. By the latest record, the newest first and those with none last, each tie by name.
 */
export function narrowSubjects(
  rows: readonly SubjectRow[],
  o: { query: string; cases: CaseFilter; order: SubjectOrder },
  names: Pick<Intl.Collator, 'compare'>,
): SubjectRow[] {
  const byName = (a: SubjectRow, b: SubjectRow) => names.compare(a.name, b.name)
  const byRecent = (a: SubjectRow, b: SubjectRow) => (b.last ?? '').localeCompare(a.last ?? '') || byName(a, b)
  const typed = fold(o.query)
  const named = typed === '' ? [] : rows.filter((r) => fold(r.name).includes(typed))
  const found = named.length > 0 ? named : rows.filter((r) => matches(r, o.query))
  return found
    .filter((r) => o.cases === 'all' || r.state === o.cases)
    .sort(o.order === 'recent' ? byRecent : byName)
}

/** A record's day as the list says it: month and day within `year`, the whole date otherwise. */
export function shortDay(day: string, year: string): string {
  return day.startsWith(`${year}-`) ? day.slice(5) : day
}
