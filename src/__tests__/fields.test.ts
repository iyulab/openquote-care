import { describe, expect, it } from 'vitest'
import {
  attendeesAt,
  copiedFromSubject,
  firstMissingRequired,
  fixedDefaults,
  headingIndex,
  inputFields,
  labelOfField,
  listColumns,
  narrativeFields,
  recordFields,
  schemeLabel,
  type FieldView,
} from '../fields.js'
import type { Entity } from '../records.js'

const field = (name: string, kind: FieldView['kind'], more: Partial<FieldView> = {}): FieldView => ({
  name,
  kind,
  scheme: kind === 'coded' ? name : null,
  refType: kind === 'reference' || kind === 'references' ? name : null,
  required: false,
  hidden: false,
  tier: 'structured',
  defaultFromSubject: null,
  label: name.toUpperCase(),
  aliases: [],
  ...more,
})

const session: FieldView[] = [
  field('note', 'text', { tier: 'narrative' }),
  field('date', 'date', { required: true }),
  field('practitioner', 'reference', { required: true }),
  field('concern', 'coded', { hidden: true }),
  field('topic', 'coded', { required: true }),
  field('mode', 'coded'),
  field('grade', 'text', { defaultFromSubject: 'grade' }),
  field('attendees', 'references'),
  field('minutes', 'number'),
]

describe('fields', () => {
  it('lists input fields without hidden, copied or multi-reference ones', () => {
    expect(inputFields(session).map((f) => f.name)).toEqual(['date', 'practitioner', 'topic', 'mode', 'minutes', 'note'])
  })

  it('puts a narrative field last in the form and never in the list', () => {
    expect(inputFields(session).at(-1)?.name).toBe('note')
    expect(listColumns(session).map((f) => f.name)).not.toContain('note')
    expect(narrativeFields(session).map((f) => f.name)).toEqual(['note'])
  })

  it('orders list columns date, then coded, then references, in declaration order', () => {
    expect(listColumns(session).map((f) => f.name)).toEqual(['date', 'topic', 'mode', 'practitioner'])
  })

  it('puts the attendees before the references in a group list', () => {
    expect(attendeesAt(listColumns(session))).toBe(3)
    expect(attendeesAt(listColumns([field('date', 'date')]))).toBe(1)
  })

  it('names the first required field left empty', () => {
    expect(firstMissingRequired(session, { date: '2026-04-02', practitioner: ' ' })?.name).toBe('practitioner')
    expect(firstMissingRequired(session, { date: '2026-04-02', practitioner: 'p1', topic: 'peer' })).toBeUndefined()
    expect(firstMissingRequired([field('concern', 'coded', { required: true, hidden: true })], {})).toBeUndefined()
  })

  it('copies the subject values a field takes by default, skipping empty ones', () => {
    const subject = { fields: { grade: '3', class: '' } } as unknown as Entity
    const defs = [...session, field('class', 'text', { defaultFromSubject: 'class' })]
    expect(copiedFromSubject(defs, subject)).toEqual({ grade: '3' })
  })

  it('starts the fields a person fills in from the fixed values the vault gives them', () => {
    const defs = [
      field('with', 'coded', { defaultValue: 'client' }),
      field('minutes', 'number', { defaultValue: '50' }),
      field('room', 'text', { defaultValue: 'A', hidden: true }),
      field('mode', 'coded', { defaultValue: null }),
      field('grade', 'text', { defaultFromSubject: 'grade' }),
    ]
    expect(fixedDefaults(defs)).toEqual({ with: 'client', minutes: '50' })
  })

  it('a heading matches a field by name, label or alias, ignoring spacing and case', () => {
    const find = headingIndex([
      field('name', 'text', { label: '이름', aliases: ['성명', 'Full name'] }),
      field('guardian_phone', 'text', { label: '보호자 연락처' }),
      field('secret', 'text', { hidden: true }),
    ])
    expect(find('성명')?.name).toBe('name')
    expect(find(' full  NAME ')?.name).toBe('name')
    expect(find('보호자연락처')?.name).toBe('guardian_phone')
    expect(find('name')?.name).toBe('name')
    expect(find('secret')).toBeUndefined()
    expect(find('별명')).toBeUndefined()
  })

  it('names a field by its label, or by its name when the vault does not declare it', () => {
    expect(labelOfField(session, 'topic')).toBe('TOPIC')
    expect(labelOfField(session, 'case')).toBe('case')
  })

  it("shows a record's fields besides its name, hidden ones left out, in declaration order", () => {
    const subject = [
      field('name', 'text'),
      field('school', 'text'),
      field('secret', 'text', { hidden: true }),
      field('grade', 'coded'),
      field('note', 'text', { tier: 'narrative' }),
    ]
    expect(recordFields(subject).map((f) => f.name)).toEqual(['school', 'grade', 'note'])
  })

  it('names a scheme by the field that takes its values, and by its own name when none does', () => {
    const defs = [field('topic', 'coded', { scheme: 'topic', label: '주제', hidden: true }), field('date', 'date')]
    expect(schemeLabel(defs, 'topic')).toBe('주제')
    expect(schemeLabel(defs, 'method')).toBe('method')
  })
})
