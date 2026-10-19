import { initialOf } from './masking.js'
import type { FieldView } from './shell.js'

/**
 * A report of one case for supervision or a case conference: what its records hold, kind by kind, with the person's
 * name covered and nothing else that names them. The person's written fields (an address, a phone number)
 * never appear; of their other fields, only the ones the counsellor picks. A record's fields copied from the person
 * (a year or a group they belong to) are left out with them. Written content appears only when the counsellor asks for it, and the
 * names it holds are not covered — the report says so. Scores are shown as written; the report judges nothing.
 */

/** How the person's name appears: its first letter with the rest covered, or as it is. */
export type ReportNameMask = 'initial' | 'none'

/** A kind of record as the packs declare it: its label, its role in a case and its place among the kinds. */
export interface ReportKind {
  type: string
  label: string
  role: 'opens' | 'closes' | null
  order: number
  /** The date field that says when a record of the kind happened — told as the line's day, not among its values. */
  dated: string
}

/** A record of the case, in the order the case runs: its day, whether it came after the case ended or in a group. */
export interface ReportRecord {
  id: string
  type: string
  day: string
  after: boolean
  group: boolean
  fields: Record<string, unknown>
}

export interface CaseReportInput {
  name: string
  mask: ReportNameMask
  /** The mark that covers the rest of the name (see `initialOf`); a hollow circle when not given. */
  cover?: string
  /** The person's fields and their values in words, and the ones the counsellor picked for the report. */
  subject: { field: FieldView; text: string }[]
  chosen: ReadonlySet<string>
  withContent: boolean
  records: ReportRecord[]
  kinds: ReportKind[]
  fieldsOf: (type: string) => FieldView[]
  /** A value in words, as the record lists show it. */
  text: (field: FieldView, value: unknown) => string
  /** The kind scale scores are kept in: its records are told by the scale lines, not as a section. */
  scaleType: string | null
}

/** A field's label and its value in words. */
export interface ReportValue {
  label: string
  text: string
}

export interface ReportLine {
  day: string
  after: boolean
  group: boolean
  values: ReportValue[]
  /** The record's written content — empty unless the counsellor asked for it. */
  content: ReportValue[]
}

/** The records of one kind: the one that opened the case first, the one that closed it last, the others in the packs' order. */
export interface ReportSection {
  type: string
  title: string
  role: 'opens' | 'closes' | null
  lines: ReportLine[]
}

export interface CaseReport {
  person: string
  personFields: ReportValue[]
  sections: ReportSection[]
}

/** The person's fields a report may carry beside the covered name: shown, structured, and a code or a number — never written text. */
export function choosableSubjectFields(fields: readonly FieldView[]): FieldView[] {
  return fields.filter((f) => !f.hidden && f.tier === 'structured' && (f.kind === 'coded' || f.kind === 'number'))
}

export function caseReport(input: CaseReportInput): CaseReport {
  const choosable = new Set(choosableSubjectFields(input.subject.map((s) => s.field)).map((f) => f.name))
  const personFields = input.subject
    .filter((s) => choosable.has(s.field.name) && input.chosen.has(s.field.name) && s.text !== '')
    .map((s) => ({ label: s.field.label, text: s.text }))
  const rank = (k: ReportKind) => (k.role === 'opens' ? -1 : k.role === 'closes' ? 1 : 0)
  const kinds = [...input.kinds].filter((k) => k.type !== input.scaleType).sort((a, b) => rank(a) - rank(b) || a.order - b.order)
  const sections = kinds
    .map((k) => ({
      type: k.type,
      title: k.label,
      role: k.role,
      lines: input.records.filter((r) => r.type === k.type).map((r) => line(r, k.dated, input)),
    }))
    .filter((s) => s.lines.length > 0)
  return { person: input.mask === 'initial' ? initialOf(input.name, input.cover) : input.name, personFields, sections }
}

/**
 * A record in words: its structured values — not its day, told beside it, nor what it took from the person — and its
 * written content when asked for. A reference to a person names a practitioner: the counsellor's own report keeps it.
 */
function line(record: ReportRecord, dated: string, input: CaseReportInput): ReportLine {
  const values: ReportValue[] = []
  const content: ReportValue[] = []
  for (const f of input.fieldsOf(record.type)) {
    if (f.hidden || f.defaultFromSubject !== null || f.name === dated) continue
    const text = input.text(f, record.fields[f.name])
    if (text === '') continue
    if (f.tier === 'narrative') {
      if (input.withContent) content.push({ label: f.label, text })
    } else values.push({ label: f.label, text })
  }
  return { day: record.day, after: record.after, group: record.group, values, content }
}
