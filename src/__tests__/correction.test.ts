import { describe, expect, it } from 'vitest'
import { asDraft, changedFields } from '../correction.js'
import { alsoKey } from '../several.js'
import type { FieldView } from '../fields.js'
import type { Entity } from '../records.js'

const field = (name: string, kind: FieldView['kind'], more: Partial<FieldView> = {}): FieldView => ({
  name,
  kind,
  scheme: kind === 'coded' ? name : null,
  refType: kind === 'reference' ? name : null,
  required: false,
  hidden: false,
  tier: 'structured',
  defaultFromSubject: null,
  label: name.toUpperCase(),
  aliases: [],
  ...more,
})

const fields = [field('date', 'date'), field('topic', 'coded'), field('minutes', 'number'), field('practitioner', 'reference'), field('note', 'text', { tier: 'narrative' })]

const session = (values: Record<string, unknown>): Entity => ({ type: 'session', id: 's1', subject: 'p1', group: null, people: ['p1'], fields: values, conflicts: {} })

const recorded = session({
  date: '2026-04-02',
  topic: { scheme: 'topic', version: 1, code: 'peer' },
  minutes: 50,
  practitioner: 'pr1',
  note: 'Talked about the class.',
  grade: 3,
})

describe('correcting a saved session', () => {
  it('starts from what the session holds, a classification by its code', () => {
    expect(asDraft(fields, recorded)).toEqual({ date: '2026-04-02', topic: 'peer', minutes: '50', practitioner: 'pr1', note: 'Talked about the class.' })
    expect(asDraft(fields, session({}))).toEqual({ date: '', topic: '', minutes: '', practitioner: '', note: '' })
  })

  it('writes only the fields a person changed', () => {
    const filled = { date: '2026-04-03', topic: { scheme: 'topic', version: 1, code: 'peer' }, minutes: 50, practitioner: 'pr1', note: 'Talked about the class.' }
    expect(changedFields(fields, recorded, filled)).toEqual({ date: '2026-04-03' })
  })

  it('writes nothing when nothing changed', () => {
    const filled = { date: '2026-04-02', topic: { scheme: 'topic', version: 1, code: 'peer' }, minutes: 50, practitioner: 'pr1', note: 'Talked about the class.' }
    expect(changedFields(fields, recorded, filled)).toEqual({})
  })

  it('clears a field the person emptied, and leaves fields the form does not show', () => {
    const filled = { date: '2026-04-02', topic: { scheme: 'topic', version: 1, code: 'peer' }, practitioner: 'pr1', note: 'Talked about the class.' }
    expect(changedFields(fields, recorded, filled)).toEqual({ minutes: null })
  })

  it('takes a classification picked in another version as a change, and fills a field that was empty', () => {
    const filled = { date: '2026-04-02', topic: { scheme: 'topic', version: 2, code: 'peer' }, minutes: 50, practitioner: 'pr1', note: 'Talked about the class.' }
    expect(changedFields(fields, recorded, filled)).toEqual({ topic: { scheme: 'topic', version: 2, code: 'peer' } })
    expect(changedFields(fields, session({ date: '2026-04-02' }), { date: '2026-04-02', minutes: 30 })).toEqual({ minutes: 30 })
  })
  it('starts a field holding several values from its primary code and the others, and writes it again only when they changed', () => {
    const many = [field('topic', 'coded', { many: true })]
    const coded = (code: string, primary?: boolean) => ({ scheme: 'topic', version: 1, code, ...(primary ? { primary } : {}) })
    const held = session({ topic: [coded('a'), coded('b', true), coded('c')] })

    const draft = asDraft(many, held)

    expect(draft.topic).toBe('b')
    expect(draft[alsoKey('topic')]).toBe('a\nc')
    expect(changedFields(many, held, { topic: [coded('b', true), coded('a'), coded('c')] })).toEqual({ topic: [coded('b', true), coded('a'), coded('c')] })
    expect(changedFields(many, held, { topic: [coded('a'), coded('b', true), coded('c')] })).toEqual({})
    expect(changedFields(many, held, { topic: coded('b') })).toEqual({ topic: coded('b') })
  })
})
