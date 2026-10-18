/**
 * What a person does with the suggestions a record's form shows, kept apart from the form so the form's
 * own flow is unchanged. It sees only fields' names, the first suggested code and the time — never a
 * record's content beyond that, and it reports counts, not values (see docs/privacy.md).
 *
 * For each coded field of a new record it learns, as the form is filled in:
 * - that suggestions were shown for the field, which code came first and when;
 * - when the field first got a value, so the wait between the two is known.
 * When the record is saved, each coded field then counts as: `accepted` (suggestions were shown and the
 * field holds the first), `corrected` (they were shown and it holds another value), `entered` (none were
 * shown and it holds a value) or `none` (it holds nothing).
 */

export type Decision = 'accepted' | 'corrected' | 'entered' | 'none'

/** One coded field of a saved record, as the shell counts it. */
export interface FieldUse {
  /** `<kind of record>.<field>`. */
  field: string
  shown: boolean
  decision: Decision
  /** The first suggestion was one the suggester stood behind; not known to the window yet, so never set. */
  trusted: boolean
  /** From the suggestions first showing to the field getting a value; null when not known. */
  waitMs: number | null
}

interface Seen {
  top: string
  at: number
  decidedAt?: number
}

export class SuggestionWatch {
  private readonly seen = new Map<string, Seen>()

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * The fields that show suggestions now (a field with a value shows none), each with its first code.
   * A field already seen keeps the time and the code it was first seen with: what the person first read is
   * what the decision is counted against.
   */
  show(offered: { field: string; top: string }[]) {
    for (const { field, top } of offered) {
      if (!this.seen.has(field)) this.seen.set(field, { top, at: this.now() })
    }
  }

  /** A field got a value, typed, picked or taken from a suggestion. The first value is when it was decided. */
  valued(field: string, value: string) {
    const seen = this.seen.get(field)
    if (seen && seen.decidedAt === undefined && value !== '') seen.decidedAt = this.now()
  }

  /** The record was saved with `filled`: each of `codedFields` counted as what the person did with it. */
  finish(kind: string, codedFields: string[], filled: Record<string, unknown>): FieldUse[] {
    return codedFields.map((name) => {
      const seen = this.seen.get(name)
      const value = primary(filled[name])
      const decision: Decision = value === '' ? 'none' : seen ? (value === seen.top ? 'accepted' : 'corrected') : 'entered'
      const waitMs = seen?.decidedAt === undefined ? null : Math.max(0, seen.decidedAt - seen.at)
      return { field: `${kind}.${name}`, shown: seen !== undefined, decision, trusted: false, waitMs }
    })
  }

  /** The form starts over. */
  reset() {
    this.seen.clear()
  }
}

/** The value a field holds as one code: the first of several, empty for nothing. */
function primary(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : ''
  return ''
}
