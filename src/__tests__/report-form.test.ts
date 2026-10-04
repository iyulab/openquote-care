import { describe, expect, it } from 'vitest'
import { storeReportForm, storedReportForm } from '../report-form.js'

function memory() {
  const items = new Map<string, string>()
  return { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v) }
}

describe('the report form a person last chose', () => {
  it('is kept per vault on this computer', () => {
    const storage = memory()
    storeReportForm('D:/records', 'monthly-topic', storage)
    expect(storedReportForm('D:/records', storage)).toBe('monthly-topic')
    expect(storedReportForm('D:/other', storage)).toBeNull()
  })

  it('is none when storage refuses', () => {
    expect(storedReportForm('D:/records', { getItem: () => { throw new Error('denied') } })).toBeNull()
    expect(() => storeReportForm('D:/records', 'monthly-topic', { setItem: () => { throw new Error('denied') } })).not.toThrow()
  })
})
