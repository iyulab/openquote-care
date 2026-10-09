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

const COLUMN_ORDER: Partial<Record<FieldView['kind'], number>> = { date: 0, text: 1, coded: 2, number: 3, reference: 4 }

/**
 * The columns of a list of records: the record's date, then short texts (a title, say — what tells records
 * apart at a glance), classifications, other dates (the next session's, say) with numbers, and references,
 * each in declaration order. Written content is never a column; it opens under its row instead. A value
 * copied from the subject is not one either: the subject's own record holds it.
 */
export function listColumns(defs: readonly FieldView[]): FieldView[] {
  const columns = defs.filter((f) => shown(f) && f.tier !== 'narrative' && !f.defaultFromSubject && COLUMN_ORDER[f.kind] !== undefined)
  const own = columns.find((f) => f.kind === 'date')
  const rank = (f: FieldView) => (f.kind === 'date' && f !== own ? COLUMN_ORDER.number! : COLUMN_ORDER[f.kind]!)
  return columns
    .map((f, i) => ({ f, i }))
    .sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i)
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

/**
 * What a subject's or a practitioner's record shows besides its name — its title — in declaration
 * order: every field the packs declare for its type that is not hidden.
 */
export function recordFields(defs: readonly FieldView[]): FieldView[] {
  return defs.filter((f) => shown(f) && f.name !== 'name')
}

/** The first field a person must fill in that is still empty. */
export function firstMissingRequired(defs: readonly FieldView[], values: Readonly<Record<string, string>>): FieldView | undefined {
  return inputFields(defs).find((f) => f.required && !(values[f.name] ?? '').trim())
}

/**
 * The fixed values the fields a person fills in start from, as the vault's packs give them. A code
 * the version in force that day does not hold is offered all the same, and left out when the record
 * is written, as any such code is.
 */
export function fixedDefaults(defs: readonly FieldView[]): Record<string, string> {
  return Object.fromEntries(inputFields(defs).flatMap((f) => (f.defaultValue ? [[f.name, f.defaultValue]] : [])))
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

/**
 * What a person calls a scheme: the label of the coded field that takes its values, or the scheme's
 * own name when no field the vault declares is bound to it.
 */
export function schemeLabel(defs: readonly FieldView[], scheme: string): string {
  return defs.find((f) => f.kind === 'coded' && f.scheme === scheme)?.label ?? scheme
}

/** The part of a record's form a field sits in: what and when, how it is classified, what was written. */
export type FormSection = 'basic' | 'categories' | 'content'

/**
 * A form's fields in its three parts, each in the order given, leaving out a part with no field: written content
 * last, the fields a scheme classifies in the middle, everything else — dates, people, numbers, short text — first.
 */
export function formSections(fields: readonly FieldView[]): { section: FormSection; fields: FieldView[] }[] {
  const of = (f: FieldView): FormSection => (f.tier === 'narrative' ? 'content' : f.kind === 'coded' ? 'categories' : 'basic')
  return (['basic', 'categories', 'content'] as const)
    .map((section) => ({ section, fields: fields.filter((f) => of(f) === section) }))
    .filter((s) => s.fields.length > 0)
}
