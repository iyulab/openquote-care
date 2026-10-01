import { describe, it, expect } from 'vitest'
import { nothing, type TemplateResult } from 'lit'
import { listEntry, errorCallout } from '../vault/parts.js'

/** A template and the templates in its values, as one markup string. */
function flat(t: unknown): string {
  if (t === nothing || t === undefined || t === null) return ''
  if (Array.isArray(t)) return t.map(flat).join('')
  if (typeof t === 'object' && 'strings' in (t as TemplateResult)) {
    const { strings, values } = t as TemplateResult
    return strings.reduce((out, part, i) => out + part + (i < values.length ? flat(values[i]) : ''), '')
  }
  return String(t)
}

describe('list entries', () => {
  it('reads as the label, with the meta line under it', () => {
    const m = flat(listEntry({ id: 'a', label: 'Ada', meta: '9 sessions' }, undefined, () => {}))
    expect(m).toContain('<span class="label">Ada</span>')
    expect(m).toContain('<span class="meta">9 sessions</span>')
  })

  it('has no meta line when there is none', () => {
    expect(flat(listEntry({ id: 'a', label: 'Ada' }, undefined, () => {}))).not.toContain('class="meta"')
  })
})

describe('error callout', () => {
  it('is a danger callout announced as an alert, its text in paragraphs', () => {
    expect(flat(errorCallout({ text: 'Could not open', detail: 'E1' }))).toMatch(
      /<dc-callout variant="danger" role="alert">\s*<p>Could not open<\/p>/,
    )
  })

  it('is nothing without an error', () => expect(errorCallout(undefined)).toBe(nothing))
})
