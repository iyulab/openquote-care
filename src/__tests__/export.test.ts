import { describe, expect, it } from 'vitest'
import { pinnedColumns, toTsv, type ExportTable } from '../export.js'

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

describe('the columns kept in view', () => {
  const columns = ['Date', 'Year', 'Name', 'Topic', 'Notes']

  it('run through the first name column when it is among the first three', () => {
    expect(pinnedColumns({ columns, names: [2] })).toBe(3)
    expect(pinnedColumns({ columns, names: [0, 4] })).toBe(1)
  })

  it('are the first column alone when no name comes early', () => {
    expect(pinnedColumns({ columns, names: [] })).toBe(1)
    expect(pinnedColumns({ columns, names: [3] })).toBe(1)
  })

  it('are none in a table without columns', () => {
    expect(pinnedColumns({ columns: [], names: [] })).toBe(0)
  })
})
