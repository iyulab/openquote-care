/** A scheme a form classifies by, at a version older than the latest one the vault holds. */
export interface SchemeLag {
  scheme: string
  version: number
  latest: number
}

/** A report or export form as the vault summary lists it. */
export interface FormEntry {
  name: string
  version: number
  label: string
  behind: SchemeLag[]
  /** False when the form reads a field the vault's packs hide: hiding a field hides what is built on it. */
  offered: boolean
}

/** One way a report form places what it counts: a classified field in a scheme version, or a field's own value. */
export interface Dimension {
  field: string
  /** Set for a classified dimension. */
  scheme: string | null
  /** The scheme version counted in; null for the version in force. */
  version: number | null
  /** True when it reads the field of the subjects a record is about. */
  ofSubject: boolean
  /** True when a field holding several values is counted by every one of them. */
  all: boolean
}

/** A report form: which records it counts, the field that places them in a period, and its dimensions. */
export interface ReportEntry extends FormEntry {
  counts: string
  periodField: string
  /** The period the form is run over: day, month, year or range. */
  unit: 'day' | 'month' | 'year' | 'range'
  dimensions: Dimension[]
  /** The numbers the form shows. */
  measures: ('records' | 'people' | 'visits')[]
  /** True when the form is a classified row and at most one column of the record, by month, unfiltered — the table the report screen lays out. */
  rowsAndColumn: boolean
}

/** The field a rows-and-column form's rows are classified by. */
export function rowFieldOf(form: ReportEntry): string {
  return form.dimensions[0]?.field ?? ''
}

/** The field that splits a rows-and-column form's columns; null for a form with one column. */
export function columnFieldOf(form: ReportEntry): string | null {
  return form.dimensions[1]?.field ?? null
}

/**
 * The forms whose newest version still classifies by an older scheme version — after a revision,
 * the pack that brought the new scheme did not bring a matching form. Older versions of a form lag
 * by design (they serve the months before the revision), so only a form's newest version counts.
 */
export function leftBehind(forms: FormEntry[]): FormEntry[] {
  const newest = new Map<string, FormEntry>()
  for (const f of forms) {
    const seen = newest.get(f.name)
    if (!seen || seen.version < f.version) newest.set(f.name, f)
  }
  return [...newest.values()].filter((f) => f.behind.length > 0)
}
