import { describe, it, expect } from 'vitest'
import stateSource from '../quote-state.ts?raw'
import markSource from '../brand-mark.ts?raw'

// The vitest environment here has no DOM: read the element's source rather than render it.
const comma = (source: string) => source.match(/const COMMA = '([^']+)'/)?.[1]

describe('quote states', () => {
  it('draws the same comma as the brand marks', () => {
    expect(comma(stateSource)).toBeTruthy()
    expect(comma(stateSource)).toBe(comma(markSource))
  })

  it('keeps the two voices and where they meet, and the mark out of what screen readers read', () => {
    for (const colour of ['#f3b39c', '#a9bbec', '#c890b6']) expect(stateSource).toContain(`'${colour}'`)
    expect(stateSource).toContain('aria-hidden="true"')
    expect(stateSource).toContain('prefers-reduced-motion')
  })

  it('waits a moment before getting ready or in progress shows, so a quick action does not flash it', () => {
    expect(stateSource).toMatch(/:host\(\[state='opening'\]\),\s*:host\(\[state='ongoing'\]\) \{\s*opacity: 0;\s*animation: appear 0s linear 0\.4s forwards;/)
  })
})
