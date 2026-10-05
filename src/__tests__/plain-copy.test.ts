import { describe, expect, it } from 'vitest'
import type { FieldView } from '../fields.js'
import { plainCopy, type PlainCopySource } from '../plain-copy.js'
import type { Entity } from '../records.js'
import { en } from '../locales/en.js'

const field = (name: string, kind: FieldView['kind'], extra: Partial<FieldView> = {}): FieldView => ({
  name,
  kind,
  scheme: null,
  refType: null,
  required: false,
  hidden: false,
  tier: 'structured',
  defaultFromSubject: null,
  label: name.toUpperCase(),
  aliases: [],
  ...extra,
})

const entity = (type: string, id: string, fields: Record<string, unknown>, extra: Partial<Entity> = {}): Entity => ({
  type,
  id,
  subject: null,
  group: null,
  people: [],
  fields,
  conflicts: {},
  ...extra,
})

const subjects = [entity('subject', 's2', { name: 'Zed', grade: '2' }), entity('subject', 's1', { name: 'Ann <b>', grade: '1' })]
const practitioners = [entity('practitioner', 'p1', { name: 'Counselor, A' })]
const groups = [entity('group', 'g1', { name: 'Peers', members: ['s1', 's2'] })]
const sessions = [
  entity('session', 'x2', { date: '2026-04-20', topic: { scheme: 'topic', version: 2, code: 'peer' }, practitioner: 'p1', note: 'said "hello"\nand left' }, { subject: 's1', people: ['s1'] }),
  entity('session', 'x1', { date: '2026-04-02', topic: { scheme: 'topic', version: 1, code: 'study' }, practitioner: 'p1', note: 'first' }, { subject: 's1', people: ['s1'] }),
  entity('session', 'x3', { date: '2026-04-10', topic: { scheme: 'topic', version: 2, code: 'peer' }, practitioner: 'p1' }, { group: 'g1', people: ['s1', 's2'] }),
]
const sessionFields = [
  field('date', 'date'),
  field('topic', 'coded', { scheme: 'topic' }),
  field('practitioner', 'reference', { refType: 'practitioner' }),
  field('note', 'text', { tier: 'narrative' }),
  field('attendees', 'references', { refType: 'subject' }),
  field('internal', 'text', { hidden: true }),
]

function source(withNarrative: boolean): PlainCopySource {
  return {
    vault: 'records',
    device: 'this device',
    at: new Date(2026, 9, 1, 9, 5),
    subjects,
    groups,
    practitioners,
    sessions,
    subjectFields: [field('name', 'text'), field('grade', 'text')],
    sessionFields,
    valueText: (f, v) => {
      if (f?.kind === 'reference') return practitioners.find((p) => p.id === v)?.fields.name as string
      if (f?.kind === 'coded') return ({ peer: 'Peers', study: 'Study' } as Record<string, string>)[(v as { code: string }).code] ?? ''
      return typeof v === 'string' ? v : ''
    },
    withNarrative,
    names: new Intl.Collator('en'),
  }
}

const file = (files: { name: string; content: string }[], name: string) => files.find((f) => f.name === name)!.content

describe('plain copy', () => {
  it('makes a page, two tables and a note, named in the app language', () => {
    expect(plainCopy(source(false), en.plainCopy).map((f) => f.name)).toEqual(['records.html', 'clients.csv', 'sessions.csv', 'read-me.txt'])
  })

  it('leaves written content out unless asked, and says so', () => {
    const without = plainCopy(source(false), en.plainCopy)
    expect(file(without, 'records.html')).not.toContain('hello')
    expect(file(without, 'sessions.csv')).not.toContain('hello')
    expect(file(without, 'records.html')).toContain('Session content is left out.')
    expect(file(without, 'read-me.txt')).toContain('Session content is left out.')
    const withIt = plainCopy(source(true), en.plainCopy)
    expect(file(withIt, 'records.html')).toContain('said &quot;hello&quot;\nand left')
    expect(file(withIt, 'sessions.csv')).toContain('"said ""hello""\nand left"')
  })

  it('escapes what a person typed in the page, and quotes it in the tables', () => {
    const files = plainCopy(source(false), en.plainCopy)
    expect(file(files, 'records.html')).toContain('Ann &lt;b&gt;')
    expect(file(files, 'records.html')).not.toContain('Ann <b>')
    expect(file(files, 'sessions.csv')).toContain('"Counselor, A"')
  })

  it('writes a classification by its label, keeping the code and scheme version it was recorded in', () => {
    const page = file(plainCopy(source(false), en.plainCopy), 'records.html')
    expect(page).toContain('Peers (peer · topic v2)')
    expect(page).toContain('Study (study · topic v1)')
  })

  it('lists subjects by name and each one’s sessions oldest first, group sessions apart', () => {
    const page = file(plainCopy(source(false), en.plainCopy), 'records.html')
    expect(page.indexOf('>1. Ann &lt;b&gt;</h2>')).toBeLessThan(page.indexOf('>2. Zed</h2>'))
    const ann = page.slice(page.indexOf('>1. Ann &lt;b&gt;</h2>'), page.indexOf('>2. Zed</h2>'))
    expect(ann.indexOf('2026-04-02')).toBeLessThan(ann.indexOf('2026-04-20'))
    expect(page).toContain('Members: Ann <b>, Zed'.replace('<b>', '&lt;b&gt;'))
  })

  it('opens the tables in a spreadsheet as UTF-8, one row per record, hidden fields left out', () => {
    const files = plainCopy(source(false), en.plainCopy)
    const rows = file(files, 'sessions.csv').split('\r\n')
    expect(rows[0]).toBe('﻿Clients,Group,DATE,TOPIC,PRACTITIONER')
    expect(rows.slice(1, 4).map((r) => r.match(/2026-04-\d\d/)![0])).toEqual(['2026-04-02', '2026-04-10', '2026-04-20'])
    expect(rows[2]).toMatch(/^"Ann <b>, Zed",Peers,2026-04-10,/)
    expect(file(files, 'clients.csv').split('\r\n').slice(0, 3)).toEqual(['﻿Name,GRADE', 'Ann <b>,1', 'Zed,2'])
  })

  it('lists the edits made after a record was first written, with when and on which device, content only when it goes in', () => {
    const history = new Map([
      ['s1', [{ id: 'c1', device: 'pc01', at: '2026-04-01T09:00:00Z', op: 'create' as const, fields: { name: 'Ann' }, source: {} }, { id: 'c2', device: 'pc02', at: '2026-04-03T09:00:00Z', op: 'update' as const, fields: { name: 'Ann <b>' }, source: {} }]],
      ['x2', [{ id: 'c3', device: 'pc01', at: '2026-04-21T09:00:00Z', op: 'update' as const, fields: { note: 'private words' }, source: {} }, { id: 'c4', device: 'pc01', at: '2026-04-22T09:00:00Z', op: 'reclassify' as const, fields: { topic: { scheme: 'topic', version: 2, code: 'peer' } }, source: {} }]],
    ])
    const deviceName = (d: string) => ({ pc01: 'Room PC', pc02: 'Laptop' })[d] ?? d
    const without = file(plainCopy({ ...source(false), history, deviceName }, en.plainCopy), 'records.html')
    expect(without).toContain('<h3>Changes</h3>')
    expect(without).toContain('Laptop</td><td>Ann &lt;b&gt;</td><td class="note">NAME: Ann &lt;b&gt;</td>')
    expect(without).toContain('Session of 2026-04-20</td><td class="note">TOPIC: Peers (peer · topic v2)\n(moved to the revised classification)</td>')
    expect(without).not.toContain('private words')
    expect(without).not.toContain('>NAME: Ann</td>') // the first writing is the record itself, not an edit
    const withIt = file(plainCopy({ ...source(true), history, deviceName }, en.plainCopy), 'records.html')
    expect(withIt).toContain('NOTE: private words')
    expect(file(plainCopy(source(false), en.plainCopy), 'records.html')).not.toContain('<h3>Changes</h3>')
  })

  it('opens with what the copy holds and a numbered list that finds each subject on paper', () => {
    const page = file(plainCopy(source(false), en.plainCopy), 'records.html')
    expect(page).toContain('<p>Clients 2 · Groups 1 · Sessions 3</p>')
    expect(page).toContain('<p>Sessions on 2026-04-02 ~ 2026-04-20</p>')
    expect(page).toContain('<ol><li><a href="#s-s1">Ann &lt;b&gt;</a> — 3 sessions · 2026-04-02 ~ 2026-04-20</li><li><a href="#s-s2">Zed</a> — 1 session · 2026-04-10</li></ol>')
    expect(page.indexOf('Clients 2')).toBeLessThan(page.indexOf('<h2>Clients</h2>'))
  })

  it('puts names in the vault’s order, the same as the app', () => {
    const korean = [entity('subject', 'k2', { name: '나영' }), entity('subject', 'k1', { name: '가람' }), entity('subject', 'k3', { name: 'Bo' })]
    const order = (names: Intl.Collator) =>
      file(plainCopy({ ...source(false), subjects: korean, sessions: [], groups: [], names }, en.plainCopy), 'clients.csv').split('\r\n').slice(1, 4).map((r) => r.split(',')[0])
    expect(order(new Intl.Collator('ko'))).toEqual(['가람', '나영', 'Bo'])
    expect(order(new Intl.Collator('en'))).toEqual(['Bo', '가람', '나영'])
  })

  it('over a period holds its sessions and the clients and groups they are about, and says so', () => {
    const files = plainCopy({ ...source(false), period: { from: '2026-04-15', to: '2026-04-30' } }, en.plainCopy)
    const page = file(files, 'records.html')
    expect(page).toContain('Period 2026-04-15 ~ 2026-04-30')
    expect(page).toContain('<p>Clients 1 · Groups 0 · Sessions 1</p>')
    expect(page).not.toContain('Zed')
    expect(page).not.toContain('2026-04-02')
    expect(file(files, 'sessions.csv').split('\r\n').filter(Boolean)).toHaveLength(2)
    expect(file(files, 'read-me.txt').split('\r\n')[2]).toBe('Period 2026-04-15 ~ 2026-04-30 — only the sessions in it, and the clients and groups they are about.')
    // A group session in the period brings in everyone it is about, and the group.
    const withGroup = file(plainCopy({ ...source(false), period: { from: '2026-04-10', to: '2026-04-10' } }, en.plainCopy), 'records.html')
    expect(withGroup).toContain('<p>Clients 2 · Groups 1 · Sessions 1</p>')
  })

  it('the note reads with Windows line ends', () => {
    expect(file(plainCopy(source(false), en.plainCopy), 'read-me.txt')).toMatch(/^Openquote Care records copy\r\n/)
  })

  it('holds every kind of record besides sessions: on the page of each subject, in its own table, and in the changes', () => {
    const referralFields = [field('date', 'date'), field('to', 'text'), field('note', 'text', { tier: 'narrative' })]
    const referrals = [entity('referral', 'r1', { date: '2026-04-15', to: 'Clinic', note: 'called ahead' }, { subject: 's2', people: ['s2'] })]
    const withKinds: PlainCopySource = {
      ...source(false),
      others: [{ label: 'Referral', fields: referralFields, records: referrals }],
      history: new Map([['r1', [
        { id: 'c1', op: 'create', at: '2026-04-15T10:00:00+09:00', device: 'pc', fields: { date: '2026-04-15', to: 'Hospital' }, source: {} },
        { id: 'c2', op: 'update', at: '2026-04-16T10:00:00+09:00', device: 'pc', fields: { to: 'Clinic' }, source: {} },
      ]]]),
    }

    const files = plainCopy(withKinds, en.plainCopy)
    expect(files.map((f) => f.name)).toEqual(['records.html', 'clients.csv', 'sessions.csv', 'referral.csv', 'read-me.txt'])
    const page = file(files, 'records.html')
    expect(page).toContain('<h3>Referral</h3>')
    expect(page).toContain('Clinic')
    expect(page).toContain('Referral of 2026-04-15')
    expect(page).not.toContain('called ahead')
    expect(file(files, 'referral.csv')).toContain('Zed,,2026-04-15,Clinic')

    const april1to10 = plainCopy({ ...withKinds, period: { from: '2026-04-01', to: '2026-04-10' } }, en.plainCopy)
    expect(april1to10.map((f) => f.name)).not.toContain('referral.csv')
    const april15 = plainCopy({ ...withKinds, period: { from: '2026-04-15', to: '2026-04-15' } }, en.plainCopy)
    expect(file(april15, 'records.html')).toContain('Zed')
  })
})
