// A monthly report's run record, laid out as the table a counsellor reads and hands in.

import { nameCollator } from './collation.js'
import { choices, text, type Entity, type Scheme } from './records.js'

/**
 * One cell of a run record: a format 0 record names its `row` and `column`; a format 1 record its
 * `key`, one place per dimension of the form — for a rows-and-column form, the row and the column.
 */
export interface RunCell {
  row?: string
  column?: string | null
  key?: (string | null)[]
  count: number
  records: string[]
}

/** The run record the engine keeps in the vault for every report it produces. */
export interface RunRecord {
  id: string
  at: string
  format?: string
  report: { report: string; version: number }
  schemes: Record<string, { version: number; crosswalks: string[] }>
  period: { from: string; to: string }
  cells: RunCell[]
  pending: Group
  unmapped: Group
  /**
   * Records with no value in the row field. A format 0 record lists them inside `unmapped` too
   * (absent when it had none); a format 1 record lists them apart from it, always.
   */
  blank?: Group
  /** Records a field the form places by holds values for that two devices set without seeing each other. Format 1 only. */
  conflicted?: Group
  total: Group
  /** For every record in the total, the subjects it is about. Absent from runs kept before people were counted. */
  people?: Record<string, string[]>
}

export interface Group {
  count: number
  records: string[]
}

export interface Column {
  /** The value of the report's column field (the id of what it refers to), or null for records with none. */
  id: string | null
  label: string
}

/** What splits a report's columns: the values its column field can take, in the order to show them. */
export interface ColumnAxis {
  /** Columns shown even when nothing fell into them, in order. */
  known: Column[]
  /** A value outside `known` in words: a column the run found that the vault no longer names. */
  label(id: string): string
  /** The heading of the column of records with no value. */
  none: string
}

/**
 * The column axis of a report whose column field refers to `entities` (every entity it may point
 * at, named and in name order); a value that names none of them reads as written.
 */
export function referenceAxis(entities: Entity[], none: string, collator: Intl.Collator = nameCollator()): ColumnAxis {
  const names = new Map(entities.map((e) => [e.id, text(e, 'name')]))
  return {
    known: [...entities].sort((a, b) => collator.compare(text(a, 'name'), text(b, 'name'))).map((e) => ({ id: e.id, label: text(e, 'name') })),
    label: (id) => names.get(id) ?? id,
    none,
  }
}

export interface Row {
  code: string
  label: string
  /** One per column, in the columns' order. */
  cells: Group[]
  total: number
  /** Every record in the row, for its head count. */
  records: string[]
}

export interface Table {
  columns: Column[]
  rows: Row[]
  columnTotals: number[]
  /** Every record in each column, in the columns' order, for their head counts. */
  columnRecords: string[][]
  /** What the cells add up to: records placed in a row. */
  placed: number
  placedRecords: string[]
  pending: Group
  /** Records whose value the crosswalks do not carry to the report's version — not the blank ones. */
  unmapped: Group
  /** Records with no value in the row field. */
  blank: Group
  /** Records a field the form places by holds values for that two devices set without seeing each other: in no row until a person picks one. */
  conflicted: Group
  total: Group
}

const EMPTY: Group = { count: 0, records: [] }

/** A cell's row and column, whichever format the run record is in. */
export function rowAndColumn(cell: RunCell): { row: string; column: string | null } {
  if (cell.key) return { row: cell.key[0] ?? '', column: cell.key[1] ?? null }
  return { row: cell.row ?? '', column: cell.column ?? null }
}

/**
 * Lays out a run: every row the report's scheme version offers, in the scheme's order (a row
 * nothing fell into still shows, as a form does), by every column of `axis`, with totals.
 */
export function layOut(run: RunRecord, schemes: Scheme[], axis: ColumnAxis): Table {
  const [rowScheme, { version }] = Object.entries(run.schemes)[0] ?? ['', { version: 0 }]
  const scheme = schemes.find((s) => s.scheme === rowScheme && s.version === version)
  const rowChoices = scheme ? choices(scheme).filter((c) => !c.disabled) : []
  const known = new Set(rowChoices.map((c) => c.value))
  const cells = run.cells.map((c) => ({ ...rowAndColumn(c), count: c.count, records: c.records }))
  const extraRows = [...new Set(cells.map((c) => c.row).filter((r) => !known.has(r)))]
  const rowList = [...rowChoices.map((c) => ({ code: c.value, label: c.label })), ...extraRows.map((r) => ({ code: r, label: r }))]

  const columns: Column[] = [...axis.known]
  for (const cell of cells) {
    if (!columns.some((c) => c.id === cell.column)) {
      columns.push({ id: cell.column, label: cell.column === null ? axis.none : axis.label(cell.column) })
    }
  }

  const cellAt = (row: string, column: string | null): Group => {
    const cell = cells.find((c) => c.row === row && c.column === column)
    return cell ? { count: cell.count, records: cell.records } : EMPTY
  }
  const rows = rowList.map(({ code, label }) => {
    const cells = columns.map((c) => cellAt(code, c.id))
    return { code, label, cells, total: cells.reduce((n, c) => n + c.count, 0), records: cells.flatMap((c) => c.records) }
  })
  const columnTotals = columns.map((_, i) => rows.reduce((n, r) => n + r.cells[i].count, 0))
  // A format 0 run lists its blank records inside unmapped too; the table keeps the two groups apart.
  const blank = run.blank ?? EMPTY
  const isBlank = new Set(blank.records)
  const unmapped = run.unmapped.records.filter((id) => !isBlank.has(id))
  return {
    columns,
    rows,
    columnTotals,
    columnRecords: columns.map((_, i) => rows.flatMap((r) => r.cells[i].records)),
    placed: columnTotals.reduce((n, c) => n + c, 0),
    placedRecords: rows.flatMap((r) => r.records),
    pending: run.pending,
    unmapped: { count: unmapped.length, records: unmapped },
    blank,
    conflicted: run.conflicted ?? EMPTY,
    total: run.total,
  }
}

/**
 * How many different people `records` are about — a group session counts each attendee, and a
 * person seen twice counts once. Null when the run did not record people.
 */
export function headCount(run: RunRecord, records: string[]): number | null {
  if (!run.people) return null
  return new Set(records.flatMap((r) => run.people?.[r] ?? [])).size
}

/** A kept run, as the engine lists them. */
export interface KeptRun {
  id: string
  device: string
  at: string
  report: { name: string; version: number }
  period: { from: string; to: string }
  total: number
}

/** Why two runs differ, record by record, with both runs. */
export interface Comparison {
  earlier: RunRecord
  later: RunRecord
  late: string[]
  removed: string[]
  revised: string[]
  /** Conflicted in the earlier run and placed in the later one: a person picked a value. */
  settled: string[]
  moved: string[]
  unchanged: string[]
}

/** Where a run put one record. */
export type Place =
  | { kind: 'cell'; row: string; column: string | null }
  | { kind: 'pending' }
  | { kind: 'unmapped' }
  | { kind: 'blank' }
  | { kind: 'conflicted' }

/** Every record of a run, with where the run put it. */
export function placesOf(run: RunRecord): Map<string, Place> {
  const places = new Map<string, Place>()
  for (const cell of run.cells) for (const id of cell.records) places.set(id, { kind: 'cell', ...rowAndColumn(cell) })
  for (const id of run.pending.records) places.set(id, { kind: 'pending' })
  for (const id of run.unmapped.records) places.set(id, { kind: 'unmapped' })
  for (const id of run.blank?.records ?? []) places.set(id, { kind: 'blank' })
  for (const id of run.conflicted?.records ?? []) places.set(id, { kind: 'conflicted' })
  return places
}

/** The row scheme and version a run counted in. */
export function rowSchemeOf(run: RunRecord): { scheme: string; version: number } {
  const [scheme, { version }] = Object.entries(run.schemes)[0] ?? ['', { version: 0 }]
  return { scheme, version }
}

/** Earlier runs of the same form name over the same period — what a run can be compared with. */
export function comparable(runs: KeptRun[], run: RunRecord): KeptRun[] {
  return runs
    .filter((k) => k.id !== run.id && k.report.name === run.report.report && k.period.from === run.period.from && k.period.to === run.period.to)
    .filter((k) => k.id < run.id)
    .sort((a, b) => b.id.localeCompare(a.id))
}

/** The month before `now`'s, which is the one a monthly report is usually made for. */
export function lastMonth(now = new Date()): { year: number; month: number } {
  const m = now.getMonth() // 0-based: this month's index is last month's number
  return m === 0 ? { year: now.getFullYear() - 1, month: 12 } : { year: now.getFullYear(), month: m }
}
