import { describe, it, expect } from 'vitest'
import { dialogueMark, quoteMark } from '../brand-mark.js'

// The vitest environment here has no DOM (the other tests are pure too): read the template itself.
const markup = (t: { strings: readonly string[] }) => t.strings.join('')

describe('brand marks', () => {
  it('draws the dialogue mark in the two voices and where they meet, hidden from screen readers', () => {
    const m = markup(dialogueMark(96))
    for (const fill of ['#f3b39c', '#a9bbec', '#c890b6']) expect(m).toContain(`fill="${fill}"`)
    expect(m).toContain('aria-hidden="true"')
  })

  it('draws the plain mark in the current text color only', () => {
    const m = markup(quoteMark(16))
    expect(m.match(/fill="([^"]+)"/g)).toEqual(['fill="currentColor"', 'fill="currentColor"'])
  })
})
