// The fields a vault's packs declare, and the rules the screens draw them by. Nothing here names a
// field: which fields a session or a subject has comes from the vault.

import type { Entity } from './records.js'
import type { FieldView } from './shell.js'

export type { FieldView }

const shown = (f: FieldView) => !f.hidden

/**
 * The fields a person fills in when recording: not hidden, not taken from the subject (those are
 * copied as they stand that day), and not a list of references (a group session's attendees have
 * their own picker). Written content comes last, in declaration order otherwise.
 */
export function inputFields(defs: readonly FieldView[]): FieldView[] {
  const inputs = defs.filter((f) => shown(f) && !f.defaultFromSubject && f.kind !== 'references')
  return [...inputs.filter((f) => f.tier !== 'narrative'), ...inputs.filter((f) => f.tier === 'narrative')]
}

const COLUMN_ORDER: Partial<Record<FieldView['kind'], number>> = { date: 0, coded: 1, reference: 2 }

/**
 * The columns of a list of records: dates, then classifications, then references, each in
 * declaration order. Written content is never a column; it opens under its row instead.
 */
export function listColumns(defs: readonly FieldView[]): FieldView[] {
  return defs
    .filter((f) => shown(f) && f.tier !== 'narrative' && COLUMN_ORDER[f.kind] !== undefined)
    .map((f, i) => ({ f, i }))
    .sort((a, b) => COLUMN_ORDER[a.f.kind]! - COLUMN_ORDER[b.f.kind]! || a.i - b.i)
    .map(({ f }) => f)
}

/** Where a group's list puts its participants: before the first reference, or last. */
export function attendeesAt(columns: readonly FieldView[]): number {
  const at = columns.findIndex((f) => f.kind === 'reference')
  return at === -1 ? columns.length : at
}

/** The fields that hold written content, shown under a record rather than in its row. */
export function narrativeFields(defs: readonly FieldView[]): FieldView[] {
  return defs.filter((f) => shown(f) && f.tier === 'narrative')
}

/** The first field a person must fill in that is still empty. */
export function firstMissingRequired(defs: readonly FieldView[], values: Readonly<Record<string, string>>): FieldView | undefined {
  return inputFields(defs).find((f) => f.required && !(values[f.name] ?? '').trim())
}

/** The values a record takes from its subject when it is written, as they stand then; empty ones are skipped. */
export function copiedFromSubject(defs: readonly FieldView[], subject: Entity): Record<string, string> {
  const values: Record<string, string> = {}
  for (const f of defs) {
    const from = f.defaultFromSubject
    const v = from ? subject.fields[from] : undefined
    if (from && typeof v === 'string' && v !== '') values[f.name] = v
  }
  return values
}

const squeeze = (s: string) => s.replace(/\s+/g, '').toLowerCase()

/**
 * What a heading in a pasted table means: the field it names by its name, its label or one of its
 * aliases, whatever the spacing and case.
 */
export function headingIndex(defs: readonly FieldView[]): (heading: string) => FieldView | undefined {
  const byName = new Map<string, FieldView>()
  for (const f of defs.filter(shown)) {
    for (const n of [f.name, f.label, ...f.aliases]) {
      const key = squeeze(n)
      if (key && !byName.has(key)) byName.set(key, f)
    }
  }
  return (heading) => byName.get(squeeze(heading))
}

/** What people call a field, by its name: its label when the vault declares it. */
export function labelOfField(defs: readonly FieldView[], name: string): string {
  return defs.find((f) => f.name === name)?.label ?? name
}
