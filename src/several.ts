// A classified field that takes several values: one of them primary — the one a count places the
// record by — and the others alongside it. A form holds the primary value as the field's own input
// and the others under a key of their own, so the draft stays one string per input.

/** A coded value as it is recorded: a code in a version of a scheme, marked when it is the primary one of several. */
export interface Coded {
  scheme: string
  version: number
  code: string
  primary?: boolean
}

export function isCoded(value: unknown): value is Coded {
  const v = value as Coded | null
  return typeof v === 'object' && v !== null && typeof v.scheme === 'string' && typeof v.version === 'number' && typeof v.code === 'string'
}

/** The draft key holding the other values of a field that takes several: codes, one per line. */
export function alsoKey(field: string): string {
  return `${field}\u0001also`
}

/**
 * The primary value of what a classified field holds, and the others: a single value is its own
 * primary; of several, the one marked primary — none when no value is marked, which a person then picks.
 */
export function primaryAndOthers(value: unknown): { primary: Coded | undefined; others: Coded[] } {
  if (isCoded(value)) return { primary: value, others: [] }
  if (!Array.isArray(value)) return { primary: undefined, others: [] }
  const values = value.filter(isCoded)
  const marked = values.find((v) => v.primary === true) ?? (values.length === 1 ? values[0] : undefined)
  return { primary: marked, others: values.filter((v) => v !== marked) }
}

/** The codes a draft holds besides the primary one, in the order they were added, without repeats or the primary. */
export function othersOf(draft: Record<string, string>, field: string): string[] {
  const primary = (draft[field] ?? '').trim()
  return [...new Set((draft[alsoKey(field)] ?? '').split('\n').map((c) => c.trim()))].filter((c) => c && c !== primary)
}

/**
 * The value a field taking several records: the primary value alone, or — with others — every value,
 * the primary one first and marked. Each value keeps its own scheme: a field offers the items of the
 * lists kept beside its scheme too.
 */
export function recordedValues(primary: Coded, others: Coded[]): Coded | Coded[] {
  if (others.length === 0) return primary
  return [{ ...primary, primary: true }, ...others]
}
