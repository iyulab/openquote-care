import { describe, expect, it } from 'vitest'
import { newCaseNumber } from '../case-number.js'

describe('newCaseNumber', () => {
  it('is the day it is given and four characters that read aloud without confusion', () => {
    const number = newCaseNumber('2026-10-13', new Set())
    expect(number).toMatch(/^2026-1013-[0-9A-HJKMNP-TV-Z]{4}$/)
  })

  it('draws again while the vault already holds the number', () => {
    const tails = ['AAAA', 'BBBB', 'CCCC']
    const number = newCaseNumber('2026-10-13', new Set(['2026-1013-AAAA', '2026-1013-BBBB']), () => tails.shift()!)
    expect(number).toBe('2026-1013-CCCC')
  })
})
