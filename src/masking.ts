import type { ExportTable } from './export.js'

/**
 * How names are hidden in what leaves the screen — a printed or copied list that passes through other hands:
 * `initial` keeps each name's first letter and covers the rest (A○○), `number` puts a number in place of each name,
 * the same number wherever the same name appears.
 */
export type NameMask = 'none' | 'initial' | 'number'

const COVER = '○'

/**
 * A name as its first letter and two covering marks, whatever its length: Ana → A○○, Kim Ana → K○○, Bo → B○○.
 * The marks are always two, so the covered name does not tell how long the name was. The mark is the language's own
 * (`cover`): a hollow circle reads as a letter O beside Latin letters, so a language may say another.
 */
export function initialOf(name: string, cover = COVER): string {
  const first = [...name.trim()][0]
  return first === undefined ? '' : first + cover + cover
}

/**
 * The table with the cells of its name columns hidden. A cell may list several names (every attendee of a group
 * session), separated by ", "; each is hidden on its own. Numbers count names in the order the rows first show them,
 * so two people with the same name share a number — the list keeps no more than its names said.
 */
export function maskNames(table: ExportTable, names: readonly number[], mask: NameMask, cover = COVER): ExportTable {
  if (mask === 'none' || names.length === 0) return table
  const numbers = new Map<string, number>()
  const hide = (name: string) => {
    if (!name) return name
    if (mask === 'initial') return initialOf(name, cover)
    if (!numbers.has(name)) numbers.set(name, numbers.size + 1)
    return String(numbers.get(name))
  }
  const columns = new Set(names)
  return {
    ...table,
    rows: table.rows.map((r) => ({ ...r, cells: r.cells.map((cell, i) => (columns.has(i) ? cell.split(', ').map(hide).join(', ') : cell)) })),
  }
}
