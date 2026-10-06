// An export form's rows, as the engine lays them out, and the text a spreadsheet takes in.

/** One month's records laid out as an export form's rows. */
export interface ExportTable {
  export: string
  version: number
  from: string
  to: string
  /** Column headings, in order. */
  columns: string[]
  rows: { record: string; cells: string[] }[]
  /** Records whose classified cell was left empty: waiting for a person to choose. */
  pending: string[]
  /** Records whose classified cell was left empty: no code in the form's version. */
  unmapped: string[]
  /** Records with a cell left empty: its field holds values two devices set without seeing each other. */
  conflicted: string[]
  /** Columns left empty in every row because they would carry written content (the record's narrative fields). */
  withheld: string[]
  /** Columns that show who a record is about by name, which a person may hide in what is printed or copied. */
  names: number[]
}

/**
 * The table as tab-separated text with a heading row — what a spreadsheet takes in when pasted.
 * A tab or line break inside a cell would start a new cell or row, so it becomes a space.
 */
export function toTsv(table: ExportTable): string {
  const line = (cells: string[]) => cells.map((c) => c.replace(/[\t\r\n]+/g, ' ')).join('\t')
  return [line(table.columns), ...table.rows.map((r) => line(r.cells))].join('\r\n') + '\r\n'
}

/**
 * How many columns from the start stay in view while the table scrolls across: through the first column that
 * names who a row is about, when it is among the first three — the row then reads as when and who — or the
 * first column alone.
 */
export function pinnedColumns(table: Pick<ExportTable, 'columns' | 'names'>): number {
  if (table.columns.length === 0) return 0
  const who = Math.min(...table.names, Infinity)
  return who < 3 ? who + 1 : 1
}
