import { describe, expect, it } from 'vitest'
import type { ExportTable } from '../export.js'
import { initialOf, maskNames } from '../masking.js'

const table: ExportTable = {
  export: 'session-list',
  version: 1,
  from: '2026-04-01',
  to: '2026-04-30',
  columns: ['일자', '대상자', '상담사'],
  rows: [
    { record: 'a', cells: ['2026-04-02', '가나다', '상담사 갑'] },
    { record: 'b', cells: ['2026-04-09', '라마, 가나다', '상담사 갑'] },
    { record: 'c', cells: ['2026-04-10', '', '상담사 을'] },
  ],
  pending: [],
  unmapped: [],
  conflicted: [],
  withheld: [],
  names: [1],
}

describe('hiding names', () => {
  it('keeps the first letter and covers each other one', () => {
    expect(initialOf('가나다')).toBe('가○○')
    expect(initialOf('Kim Ana')).toBe('K○○ ○○○')
    expect(initialOf('가')).toBe('가')
  })

  it('hides only the name columns, each name of a cell on its own', () => {
    const hidden = maskNames(table, table.names, 'initial')

    expect(hidden.rows.map((r) => r.cells)).toEqual([
      ['2026-04-02', '가○○', '상담사 갑'],
      ['2026-04-09', '라○, 가○○', '상담사 갑'],
      ['2026-04-10', '', '상담사 을'],
    ])
    expect(table.rows[0].cells[1]).toBe('가나다') // the table read stays as it was
  })

  it('numbers names in the order the rows first show them, the same name the same number', () => {
    expect(maskNames(table, table.names, 'number').rows.map((r) => r.cells[1])).toEqual(['1', '2, 1', ''])
  })

  it('leaves a table as written when nothing is to be hidden', () => {
    expect(maskNames(table, table.names, 'none')).toBe(table)
    expect(maskNames(table, [], 'initial')).toBe(table)
  })
})
