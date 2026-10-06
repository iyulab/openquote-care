import { describe, expect, it } from 'vitest'
import { toTsv, type ExportTable } from '../export.js'

const table: ExportTable = {
  export: 'session-list',
  version: 1,
  from: '2026-04-01',
  to: '2026-04-30',
  columns: ['상담일자', '대상자', '상담인원'],
  rows: [
    { record: 'a', cells: ['2026-04-02', '가', '1'] },
    { record: 'b', cells: ['2026-04-09', '가, 나', '2'] },
  ],
  pending: [],
  unmapped: [],
  conflicted: [],
  withheld: [],
  names: [],
}

describe('toTsv', () => {
  it('puts the headings first and one record per line, cells split by tabs', () => {
    expect(toTsv(table)).toBe('상담일자\t대상자\t상담인원\r\n2026-04-02\t가\t1\r\n2026-04-09\t가, 나\t2\r\n')
  })
  it('keeps a tab or a line break inside a cell from starting a new cell or row', () => {
    const odd = { ...table, rows: [{ record: 'a', cells: ['x\ty', 'first\r\nsecond', ''] }] }
    expect(toTsv(odd).split('\r\n')[1]).toBe('x y\tfirst second\t')
  })
})
