// A monthly report's run record, laid out as the table a counsellor reads and hands in.

import { choices, text, type Entity, type Scheme } from './records.js'

/** The run record the engine keeps in the vault for every report it produces. */
export interface RunRecord {
  report: { report: string; version: number }
  schemes: Record<string, { version: number; crosswalks: string[] }>
  period: { from: string; to: string }
  cells: { row: string; column: string | null; count: number; records: string[] }[]
  pending: Group
  unmapped: Group
  total: Group
}

export interface Group {
  count: number
  records: string[]
}

export interface Column {
  /** The practitioner id, or null for records with none. */
  id: string | null
  label: string
}

export interface Row {
  code: string
  label: string
  /** One per column, in the columns' order. */
  cells: Group[]
  total: number
}

export interface Table {
  columns: Column[]
  rows: Row[]
  columnTotals: number[]
  /** What the cells add up to: records placed in a row. */
  placed: number
  pending: Group
  unmapped: Group
  total: Group
}

const EMPTY: Group = { count: 0, records: [] }

/**
 * Lays out a run: every row the report's scheme version offers, in the scheme's order (a row
 * nothing fell into still shows, as a form does), by every practitioner, with totals.
 */
export function layOut(run: RunRecord, schemes: Scheme[], practitioners: Entity[], noPractitioner: string): Table {
  const [rowScheme, { version }] = Object.entries(run.schemes)[0] ?? ['', { version: 0 }]
  const scheme = schemes.find((s) => s.scheme === rowScheme && s.version === version)
  const rowChoices = scheme ? choices(scheme).filter((c) => !c.disabled) : []
  const known = new Set(rowChoices.map((c) => c.value))
  const extraRows = [...new Set(run.cells.map((c) => c.row).filter((r) => !known.has(r)))]
  const rowList = [...rowChoices.map((c) => ({ code: c.value, label: c.label })), ...extraRows.map((r) => ({ code: r, label: r }))]

  const names = new Map(practitioners.map((p) => [p.id, text(p, 'name')]))
  const byName = [...practitioners].sort((a, b) => text(a, 'name').localeCompare(text(b, 'name'), 'ko'))
  const columns: Column[] = byName.map((p) => ({ id: p.id, label: text(p, 'name') }))
  for (const cell of run.cells) {
    if (!columns.some((c) => c.id === cell.column)) {
      columns.push({ id: cell.column, label: cell.column === null ? noPractitioner : (names.get(cell.column) ?? cell.column) })
    }
  }

  const cellAt = (row: string, column: string | null): Group => {
    const cell = run.cells.find((c) => c.row === row && c.column === column)
    return cell ? { count: cell.count, records: cell.records } : EMPTY
  }
  const rows = rowList.map(({ code, label }) => {
    const cells = columns.map((c) => cellAt(code, c.id))
    return { code, label, cells, total: cells.reduce((n, c) => n + c.count, 0) }
  })
  const columnTotals = columns.map((_, i) => rows.reduce((n, r) => n + r.cells[i].count, 0))
  return {
    columns,
    rows,
    columnTotals,
    placed: columnTotals.reduce((n, c) => n + c, 0),
    pending: run.pending,
    unmapped: run.unmapped,
    total: run.total,
  }
}

/** The month before `now`'s, which is the one a monthly report is usually made for. */
export function lastMonth(now = new Date()): { year: number; month: number } {
  const m = now.getMonth() // 0-based: this month's index is last month's number
  return m === 0 ? { year: now.getFullYear() - 1, month: 12 } : { year: now.getFullYear(), month: m }
}
