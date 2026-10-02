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
  /** A place of a dimension: a code, a string value or the id of what a field refers to — null for records with none. */
  id: string | null
  label: string
}

/** How one dimension of a form reads: the places it can take, in the order to show them. */
export interface Axis {
  /** Places shown even when nothing fell into them, in order. */
  known: Column[]
  /** A place outside `known` in words: one the run found that the axis does not list. */
  label(id: string): string
  /** The heading of the records with no single value there. */
  none: string
  /** The order of places outside `known`, after them; the order the run found them in when absent. */
  compare?: (a: string, b: string) => number
}

/**
 * The axis of a dimension whose field refers to `entities` (every entity it may point at, named and
 * in name order); a value that names none of them reads as written.
 */
export function referenceAxis(entities: Entity[], none: string, collator: Intl.Collator = nameCollator()): Axis {
  const names = new Map(entities.map((e) => [e.id, text(e, 'name')]))
  return {
    known: [...entities].sort((a, b) => collator.compare(text(a, 'name'), text(b, 'name'))).map((e) => ({ id: e.id, label: text(e, 'name') })),
    label: (id) => names.get(id) ?? id,
    none,
  }
}

/**
 * The axis of a classified dimension in the scheme version the run counted in: every leaf in the
 * scheme's order (a place nothing fell into still shows, as a form does); a code it does not hold reads as written.
 */
export function schemeAxis(scheme: Scheme | undefined, none: string): Axis {
  const all = scheme ? choices(scheme) : []
  const labels = new Map(all.map((c) => [c.value, c.label]))
  return { known: all.filter((c) => !c.disabled).map((c) => ({ id: c.value, label: c.label })), label: (id) => labels.get(id) ?? id, none }
}

/** The axis of a dimension split by a field's string value: the values the run found, in `collator`'s order with numbers by value. */
export function valueAxis(none: string, collator: Intl.Collator = nameCollator()): Axis {
  const numeric = new Intl.Collator(collator.resolvedOptions().locale, { numeric: true })
  return { known: [], label: (id) => id, none, compare: (a, b) => numeric.compare(a, b) }
}

export interface Row {
  code: string | null
  label: string
  /** One per column, in the columns' order. */
  cells: Group[]
  /** Every record in the row, each once, for its count and head count. */
  records: string[]
  total: number
}

/** The rows and columns of a run's cells: its first dimension down, its second across. */
export interface Table {
  columns: Column[]
  rows: Row[]
  /** Every record in each column, each once, in the columns' order. */
  columnRecords: string[][]
  columnTotals: number[]
  /** Every record placed in a cell, each once. */
  placedRecords: string[]
  placed: number
}

/** The table of a form's cells for one place of its third dimension — or, with no `id`, for all of them together. */
export interface Section {
  id?: string | null
  label: string
  table: Table
}

/** A run laid out: one table per section, and the records it could not place in any cell. */
export interface Layout {
  /** One section for a form of one or two dimensions; with a third, all of its places together first, then each place. */
  sections: Section[]
  pending: Group
  /** Records whose value the crosswalks do not carry to the version counted in — not the blank ones. */
  unmapped: Group
  /** Records with no value in a field the form places by. */
  blank: Group
  /** Records a field the form places by holds values for that two devices set without seeing each other: in no cell until a person picks one. */
  conflicted: Group
  total: Group
}

const EMPTY: Group = { count: 0, records: [] }

/** A cell's key, one place per dimension of its form, whichever format the run record is in. */
export function keyOf(cell: RunCell): (string | null)[] {
  return cell.key ?? [cell.row ?? '', cell.column ?? null]
}

type Placed = { key: (string | null)[]; records: string[] }

const once = (records: string[]): string[] => [...new Set(records)]
const groupOf = (records: string[]): Group => ({ count: records.length, records })
const placeOf = (cell: Placed, dimension: number): string | null => cell.key[dimension] ?? null

/** The places of `axis` the cells use: the ones it always shows, then the others it found, and the place of no value last. */
function placesOn(axis: Axis, ids: (string | null)[]): Column[] {
  const known = new Set(axis.known.map((c) => c.id))
  const found = [...new Set(ids)].filter((id): id is string => id !== null && !known.has(id))
  if (axis.compare) found.sort(axis.compare)
  return [
    ...axis.known,
    ...found.map((id) => ({ id, label: axis.label(id) })),
    ...(ids.includes(null) && !known.has(null) ? [{ id: null, label: axis.none }] : []),
  ]
}

function tableOf(cells: Placed[], rowAxis: Axis, columnAxis: Axis): Table {
  const rowList = placesOn(rowAxis, cells.map((c) => placeOf(c, 0)))
  const columns = placesOn(columnAxis, cells.map((c) => placeOf(c, 1)))
  // A record counted by every value of a field may sit in several cells: totals count records, never cells.
  const at = (row: string | null, column: string | null): Group =>
    groupOf(once(cells.filter((c) => placeOf(c, 0) === row && placeOf(c, 1) === column).flatMap((c) => c.records)))
  const rows = rowList.map(({ id, label }) => {
    const cells = columns.map((c) => at(id, c.id))
    const records = once(cells.flatMap((c) => c.records))
    return { code: id, label, cells, records, total: records.length }
  })
  const columnRecords = columns.map((_, i) => once(rows.flatMap((r) => r.cells[i].records)))
  const placedRecords = once(rows.flatMap((r) => r.records))
  return { columns, rows, columnRecords, columnTotals: columnRecords.map((r) => r.length), placedRecords, placed: placedRecords.length }
}

/**
 * Lays a run out along `axes`, one per dimension of its form in key order — for a form of one
 * dimension, a second axis whose one column holds every record. With a third axis the cells are split
 * into sections: all of its places together (labelled `all`) first, then each place records fell into.
 */
export function layOut(run: RunRecord, axes: Axis[], all = ''): Layout {
  const [rowAxis, columnAxis, sectionAxis] = axes
  const cells: Placed[] = run.cells.map((c) => ({ key: keyOf(c), records: c.records }))
  const sections: Section[] = [{ label: all, table: tableOf(cells, rowAxis, columnAxis) }]
  if (sectionAxis) {
    // A section is a place records fell into: unlike a row, an empty one shows nothing worth a tab.
    const used = cells.map((c) => placeOf(c, 2))
    for (const place of placesOn(sectionAxis, used).filter((p) => used.includes(p.id))) {
      sections.push({ id: place.id, label: place.label, table: tableOf(cells.filter((c) => placeOf(c, 2) === place.id), rowAxis, columnAxis) })
    }
  }
  // A format 0 run lists its blank records inside unmapped too; the layout keeps the two groups apart.
  const blank = run.blank ?? EMPTY
  const isBlank = new Set(blank.records)
  return {
    sections,
    pending: run.pending,
    unmapped: groupOf(run.unmapped.records.filter((id) => !isBlank.has(id))),
    blank,
    conflicted: run.conflicted ?? EMPTY,
    total: run.total,
  }
}

/** A number a form shows: its records, each once; the people behind them; the visits they add up to. */
export type Measure = 'records' | 'people' | 'visits'

/** One measure of `records` — null for people and visits when the run did not record people. */
export function measureOf(run: RunRecord, records: string[], measure: Measure): number | null {
  if (measure === 'records') return records.length
  return measure === 'people' ? headCount(run, records) : visitCount(run, records)
}

/**
 * The visits behind `records`: for each, the number of people it is about, added up — a group session
 * of three counts three. Null when the run did not record people.
 */
export function visitCount(run: RunRecord, records: string[]): number | null {
  if (!run.people) return null
  return records.reduce((n, r) => n + (run.people?.[r]?.length ?? 0), 0)
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
  | { kind: 'cell'; key: (string | null)[] }
  | { kind: 'pending' }
  | { kind: 'unmapped' }
  | { kind: 'blank' }
  | { kind: 'conflicted' }

/** Every record of a run, with where the run put it. */
export function placesOf(run: RunRecord): Map<string, Place> {
  const places = new Map<string, Place>()
  for (const cell of run.cells) for (const id of cell.records) places.set(id, { kind: 'cell', key: keyOf(cell) })
  for (const id of run.pending.records) places.set(id, { kind: 'pending' })
  for (const id of run.unmapped.records) places.set(id, { kind: 'unmapped' })
  for (const id of run.blank?.records ?? []) places.set(id, { kind: 'blank' })
  for (const id of run.conflicted?.records ?? []) places.set(id, { kind: 'conflicted' })
  return places
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
