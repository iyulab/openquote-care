import { describe, expect, it } from 'vitest'
import { firstRecordMoment } from '../first-moment.js'
import source from '../first-moment.ts?raw'

describe('first moments', () => {
  it('are a folder going from no records to its first, and nothing else', () => {
    expect(firstRecordMoment(0, 1)).toBe('first-record')
    expect(firstRecordMoment(0, 3)).toBe('first-record') // several at once, from another device say
    expect(firstRecordMoment(1, 2)).toBeNull()
    expect(firstRecordMoment(0, 0)).toBeNull()
    expect(firstRecordMoment(2, 0)).toBeNull()
  })

  it('never take a click or speak to a screen reader, and hold still where motion is reduced', () => {
    expect(source).toMatch(/pointer-events: none/)
    expect(source.match(/aria-hidden="true"/g)?.length).toBe(2)
    expect(source).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.glow \{ animation: none;/)
  })
})
