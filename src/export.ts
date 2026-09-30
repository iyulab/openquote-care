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
  /** Columns left empty in every row because they would carry written content (the record's narrative fields). */
  withheld: string[]
}

/**
 * The table as tab-separated text with a heading row — what a spreadsheet takes in when pasted.
 * A tab or line break inside a cell would start a new cell or row, so it becomes a space.
 */
export function toTsv(table: ExportTable): string {
  const line = (cells: string[]) => cells.map((c) => c.replace(/[\t\r\n]+/g, ' ')).join('\t')
  return [line(table.columns), ...table.rows.map((r) => line(r.cells))].join('\r\n') + '\r\n'
}
