// Many subjects at once, from rows pasted out of a spreadsheet: what each row would do, before
// anything is written.

import type { FieldView } from './fields.js'
import type { Entity } from './records.js'

export type RowProblem =
  | { kind: 'no-name' }
  | { kind: 'repeated'; line: number }
  | { kind: 'ambiguous'; name: string }

/** What one pasted row would do. `line` counts the heading row as 1, as a spreadsheet does. */
export type PlannedRow =
  | { line: number; kind: 'create'; fields: Record<string, string> }
  | { line: number; kind: 'update'; subject: string; fields: Record<string, string> }
  | { line: number; kind: 'same'; subject: string }
  | { line: number; kind: 'problem'; problem: RowProblem }

export interface ImportPlan {
  /** The field of each column, by name; null for a heading the vault declares no field for. */
  columns: (string | null)[]
  /** Headings the vault declares no field for: their columns are not read. */
  unknownHeadings: string[]
  rows: PlannedRow[]
  /** Nothing is written while any row has a problem, or the sheet has no name column. */
  ready: boolean
  missingName: boolean
}

/**
 * Plans the import of `rows` (the first one is the headings) against the subjects the vault has;
 * `fieldOf` says which field a heading names (see `headingIndex`).
 * A row finds its subject by management number when the sheet has that column and the row fills
 * it, otherwise by name; a name several subjects share cannot say which one it means. An empty
 * cell never clears a value the subject has.
 */
export function planImport(rows: string[][], existing: Entity[], fieldOf: (heading: string) => FieldView | undefined): ImportPlan {
  const [headings = [], ...body] = rows
  const columns = headings.map((h) => fieldOf(h)?.name ?? null)
  const unknownHeadings = headings.filter((h, i) => columns[i] === null && h.trim() !== '')
  const missingName = !columns.includes('name')

  const text = (e: Entity, key: string) => (typeof e.fields[key] === 'string' ? (e.fields[key] as string) : '')
  const seen = new Map<string, number>()
  const planned = body.map((cells, i): PlannedRow => {
    const line = i + 2
    const fields: Record<string, string> = {}
    columns.forEach((key, c) => {
      const value = (cells[c] ?? '').trim()
      if (key && value !== '') fields[key] = value
    })
    if (!fields.name) return { line, kind: 'problem', problem: { kind: 'no-name' } }

    const key = fields.mgmt_no ? `no:${fields.mgmt_no}` : `name:${fields.name}`
    const earlier = seen.get(key)
    if (earlier !== undefined) return { line, kind: 'problem', problem: { kind: 'repeated', line: earlier } }
    seen.set(key, line)

    const matches = fields.mgmt_no
      ? existing.filter((s) => text(s, 'mgmt_no') === fields.mgmt_no)
      : existing.filter((s) => text(s, 'name') === fields.name)
    if (matches.length > 1) return { line, kind: 'problem', problem: { kind: 'ambiguous', name: fields.name } }
    if (matches.length === 0) return { line, kind: 'create', fields }

    const subject = matches[0]
    const changed = Object.fromEntries(Object.entries(fields).filter(([k, v]) => text(subject, k) !== v))
    return Object.keys(changed).length === 0
      ? { line, kind: 'same', subject: subject.id }
      : { line, kind: 'update', subject: subject.id, fields: changed }
  })

  return {
    columns,
    unknownHeadings,
    rows: planned,
    missingName,
    ready: !missingName && planned.length > 0 && planned.every((r) => r.kind !== 'problem'),
  }
}

/** How many rows would create, update, stay the same, or stop the import. */
export function tally(plan: ImportPlan): Record<PlannedRow['kind'], number> {
  const counts = { create: 0, update: 0, same: 0, problem: 0 }
  for (const r of plan.rows) counts[r.kind]++
  return counts
}
