import { describe, it, expect } from 'vitest'
import { nothing, type TemplateResult } from 'lit'
import { listEntry, errorCallout, countBy, formLabel, yearsAround } from '../vault/parts.js'

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

describe('countBy', () => {
  it('counts sessions per id', () => {
    const counts = countBy([{ people: ['a', 'b'] }, { people: ['a'] }] as never, (s: { people: string[] }) => s.people)
    expect(counts.get('a')).toBe(2)
    expect(counts.get('b')).toBe(1)
    expect(counts.get('c')).toBeUndefined()
  })
})

describe('the years a period is picked from', () => {
  it('runs from next year back ten, newest first', () => {
    const years = yearsAround(2026, 2026)
    expect(years[0]).toBe(2027)
    expect(years.at(-1)).toBe(2016)
    expect(years).toHaveLength(12)
  })

  it('reaches back to the folder\'s earliest record when that is older', () => {
    expect(yearsAround(2026, 2026, 2001).at(-1)).toBe(2001)
    expect(yearsAround(2026, 2026, 2020).at(-1)).toBe(2016)
  })

  it('reaches a year chosen outside that span', () => {
    expect(yearsAround(2005, 2026).at(-1)).toBe(2005)
    expect(yearsAround(2030, 2026)[0]).toBe(2030)
  })
})

describe('a form as a person picks it', () => {
  const topics = { name: 'topics', label: 'Topics', version: 1 }
  const grades = { name: 'grades', label: 'Grades', version: 1 }

  it('is its name alone when the vault holds one version of it', () => {
    expect(formLabel([topics, grades], topics)).toBe('Topics')
  })

  it('names its version when the vault holds more than one', () => {
    const topics2 = { ...topics, version: 2 }
    expect(formLabel([topics, topics2, grades], topics2)).not.toBe('Topics')
    expect(formLabel([topics, topics2, grades], topics2)).toContain('2')
    expect(formLabel([topics, topics2, grades], grades)).toBe('Grades')
  })
})
