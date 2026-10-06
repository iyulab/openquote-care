// A copy of the vault's records that reads without the app: one page for a person, two tables for
// a spreadsheet, and a note on what the copy is. Made here from what the window already holds; the
// shell only decides where it may be written.

import { listColumns, recordFields, type FieldView } from './fields.js'
import { dayByDate, inOrderOfFirstRecord, text, type ChangeEntry, type Classified, type DayOf, type Entity } from './records.js'

/** What the copy is made from. */
export interface PlainCopySource {
  /** The vault folder's name, and the device and moment the copy was made on. */
  vault: string
  device: string
  at: Date
  subjects: Entity[]
  groups: Entity[]
  practitioners: Entity[]
  subjectFields: FieldView[]
  /** The kinds of record the packs keep under subjects and groups — sessions, an intake, a referral — each with its records. */
  kinds: PlainKind[]
  /** How a value reads to a person: a classification's label, a reference's name. */
  valueText(field: FieldView | undefined, value: unknown): string
  /** Whether written content (`narrative` fields) goes in. */
  withNarrative: boolean
  /** The changes each entity was built from, by entity id; without it the copy has no changes section. */
  history?: ReadonlyMap<string, ChangeEntry[]>
  /** How a device reads to a person. */
  deviceName?(device: string): string
  /** How names are put in order: the vault's, as everywhere in the app. */
  names: Intl.Collator
  /** When a record happened, by the field its kind is dated by; the field called `date` when absent. */
  dayOf?: DayOf
  /**
   * The days the copy covers (`YYYY-MM-DD`, both included): only the records on them, and the
   * clients and groups those records are about. Every record when absent.
   */
  period?: { from: string; to: string }
}

/** One kind of record: what people call it, its fields and its records. */
export interface PlainKind {
  label: string
  fields: FieldView[]
  records: Entity[]
}

/** The words of the copy, in the app's language. */
export interface PlainCopyWords {
  files: { page: string; subjects: string; readMe: string }
  title: string
  made: (vault: string, at: string, device: string) => string
  /** What the copy holds, on its first page: its subjects, groups and records of each kind it has. */
  counts: (subjects: number, groups: number, records: KindCount[]) => string
  /** The days its records were on, from the first to the last. */
  recordDays: (days: string) => string
  /** A subject's line in the list at the front: how many records of each kind, on which days. */
  entry: (records: KindCount[], days: string) => string
  /** The days a copy over a period covers, and what it then holds. */
  period: (from: string, to: string) => string
  unprotected: string
  narrativeLeftOut: string
  subjects: string
  groups: string
  practitioners: string
  name: string
  people: string
  group: string
  members: string
  noRecords: string
  /** The heading over the records of a kind a subject took part in with a group. */
  inGroups: (kind: string) => string
  history: string
  historyWhen: string
  historyDevice: string
  historyWhat: string
  historyFields: string
  /** A record in the changes section: its kind and date. */
  recordOn: (kind: string, date: string) => string
  /** The table of one kind of record. */
  recordsFile: (kind: string) => string
  reclassified: string
  /** The note on what the copy is; `tables` are the tables of records, one per kind, in the order of the copy. */
  readMe: (files: PlainCopyWords['files'], tables: string[], withNarrative: boolean, made: string, period?: string) => string
}

/** How many records of one kind. */
export interface KindCount {
  label: string
  count: number
}

export interface PlainFile {
  name: string
  content: string
}

const BOM = '﻿'

/** The files of the copy, in the order a person would open them. */
export function plainCopy(whole: PlainCopySource, words: PlainCopyWords): PlainFile[] {
  const source = within(whole)
  const period = source.period ? words.period(source.period.from, source.period.to) : undefined
  const subjectFields = recordFields(source.subjectFields)
  const kinds = kindsOf(source)
  const tables = kinds.map((k) => ({ name: words.recordsFile(k.label), content: recordsCsv(source, words, k.fields, k.records) }))
  return [
    { name: words.files.page, content: page(source, words, subjectFields, kinds) },
    { name: words.files.subjects, content: subjectsCsv(source, words, subjectFields) },
    ...tables,
    {
      name: words.files.readMe,
      content: words
        .readMe(words.files, tables.map((t) => t.name), source.withNarrative, words.made(source.vault, stamp(source.at), source.device), period)
        .replaceAll('\n', '\r\n'),
    },
  ]
}

/** The records a copy over a period holds: its records of every kind, and the clients and groups they are about. */
function within(source: PlainCopySource): PlainCopySource {
  if (!source.period) return source
  const { from, to } = source.period
  const kinds = source.kinds.map((k) => ({
    ...k,
    records: k.records.filter((r) => {
      const day = (source.dayOf ?? dayByDate)(r)
      return day >= from && day <= to
    }),
  }))
  const all = kinds.flatMap((k) => k.records)
  const people = new Set(all.flatMap((r) => r.people))
  const groups = new Set(all.map((r) => r.group))
  return {
    ...source,
    kinds,
    subjects: source.subjects.filter((s) => people.has(s.id)),
    groups: source.groups.filter((g) => groups.has(g.id)),
  }
}

/**
 * The kinds the copy holds, with their fields as it shows them, in the order their first record
 * happened — the order the work took; a kind with no record is left out.
 */
function kindsOf(source: PlainCopySource): PlainKind[] {
  const held = source.kinds.filter((k) => k.records.length > 0).map((k) => ({ ...k, fields: recordColumns(k.fields, source.withNarrative) }))
  return inOrderOfFirstRecord(held, (k) => k.records, source.dayOf)
}

/** How many records of each kind, leaving out the kinds with none. */
function countsOf(kinds: PlainKind[], recordsOf: (k: PlainKind) => Entity[]): KindCount[] {
  return kinds.map((k) => ({ label: k.label, count: recordsOf(k).length })).filter((c) => c.count > 0)
}

/**
 * A record's fields as the copy shows them: the list's columns (dates, classifications, references),
 * then any other structured field, then written content when it goes in. Attendees are the
 * record's people, shown on their own.
 */
function recordColumns(defs: FieldView[], withNarrative: boolean): FieldView[] {
  const listed = listColumns(defs)
  const rest = defs.filter((f) => !f.hidden && f.kind !== 'references' && f.tier !== 'narrative' && !listed.includes(f))
  const narrative = withNarrative ? defs.filter((f) => !f.hidden && f.tier === 'narrative') : []
  return [...listed, ...rest, ...narrative]
}

/** A value as the copy writes it: what the app shows, and for a classification also its code and version. */
function cell(source: PlainCopySource, field: FieldView, value: unknown): string {
  const shown = source.valueText(field, value)
  const c = value as Partial<Classified> | null
  if (field.kind === 'coded' && c && typeof c === 'object' && typeof c.code === 'string') {
    const code = `${c.code} · ${c.scheme} v${c.version}`
    return shown && shown !== c.code ? `${shown} (${code})` : code
  }
  return shown
}

/** Oldest first: a copy is read as a history. */
function oldestFirst(records: Entity[], dayOf: DayOf = dayByDate): Entity[] {
  return [...records].sort((a, b) => dayOf(a).localeCompare(dayOf(b)) || a.id.localeCompare(b.id))
}

function names(entities: Entity[], ids: string[]): string {
  return ids.map((id) => text(entities.find((e) => e.id === id) ?? ({ fields: {} } as Entity), 'name') || id).join(', ')
}

function membersOf(group: Entity): string[] {
  const members = group.fields.members
  return Array.isArray(members) ? members.filter((m): m is string => typeof m === 'string') : []
}

function byName(entities: Entity[], names: Intl.Collator): Entity[] {
  return [...entities].sort((a, b) => names.compare(text(a, 'name'), text(b, 'name')) || a.id.localeCompare(b.id))
}

/** The first and last date the records were on, as one stretch; empty when none has a date. */
function days(records: Entity[], dayOf: DayOf = dayByDate): string {
  const dates = records.map(dayOf).filter(Boolean).sort()
  if (dates.length === 0) return ''
  return dates[0] === dates.at(-1) ? dates[0] : `${dates[0]} ~ ${dates.at(-1)}`
}

function escape(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function stamp(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

const STYLE = `body{font-family:system-ui,sans-serif;max-width:60rem;margin:2rem auto;padding:0 1rem;line-height:1.5;color:#1a1a1e}
h1{font-size:1.5rem}h2{font-size:1.2rem;margin-top:2.5rem;border-bottom:1px solid #ccc}h3{font-size:1rem;margin-top:1.5rem}
table{border-collapse:collapse;width:100%;font-size:.9rem}th,td{text-align:left;padding:.3rem .5rem;border-bottom:1px solid #ddd;vertical-align:top}
th{color:#555}dl{display:grid;grid-template-columns:max-content 1fr;gap:.2rem 1rem}dt{color:#555}dd{margin:0}
.note{white-space:pre-wrap}.warn{border:1px solid #b00020;padding:.5rem 1rem;color:#b00020}
@media print{h2{break-before:page}a{color:inherit;text-decoration:none}tr{break-inside:avoid}}`

function recordTable(source: PlainCopySource, words: PlainCopyWords, columns: FieldView[], records: Entity[], people: boolean): string {
  const heads = [...(people ? [words.people] : []), ...columns.map((f) => f.label)]
  const rows = oldestFirst(records, source.dayOf).map((s) => {
    const cells = [...(people ? [names(source.subjects, s.people)] : []), ...columns.map((f) => cell(source, f, s.fields[f.name]))]
    return `<tr>${cells.map((c, i) => `<td${columns[people ? i - 1 : i]?.tier === 'narrative' ? ' class="note"' : ''}>${escape(c)}</td>`).join('')}</tr>`
  })
  return `<table><thead><tr>${heads.map((h) => `<th>${escape(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`
}

/**
 * The edits made to `entities` after each was first written, oldest first: when, on which device,
 * what, and the fields set — the fields the copy shows, so written content only when it goes in.
 */
function changesTable(source: PlainCopySource, words: PlainCopyWords, entries: { entity: Entity; what: string; fields: FieldView[] }[]): string {
  const rows = entries
    .flatMap(({ entity, what, fields }) =>
      (source.history?.get(entity.id) ?? [])
        .filter((c) => c.op === 'update' || c.op === 'reclassify')
        .map((c) => {
          const set = fields.filter((f) => f.name in c.fields).map((f) => `${f.label}: ${cell(source, f, c.fields[f.name])}`)
          return { c, what, set: c.op === 'reclassify' ? [...set, words.reclassified] : set }
        })
        .filter((r) => r.set.length > 0),
    )
    .sort((a, b) => a.c.at.localeCompare(b.c.at) || a.c.id.localeCompare(b.c.id))
  if (rows.length === 0) return ''
  const heads = [words.historyWhen, words.historyDevice, words.historyWhat, words.historyFields]
  const body = rows.map(
    (r) =>
      `<tr><td>${escape(stamp(new Date(r.c.at)))}</td><td>${escape(source.deviceName?.(r.c.device) ?? r.c.device)}</td><td>${escape(r.what)}</td><td class="note">${escape(r.set.join('\n'))}</td></tr>`,
  )
  return `<h3>${escape(words.history)}</h3><table><thead><tr>${heads.map((h) => `<th>${escape(h)}</th>`).join('')}</tr></thead><tbody>${body.join('')}</tbody></table>`
}

function page(source: PlainCopySource, words: PlainCopyWords, subjectFields: FieldView[], kinds: PlainKind[]): string {
  const subjects = byName(source.subjects, source.names)
  const anchor = (e: Entity) => `s-${e.id}`
  const span = days(kinds.flatMap((k) => k.records), source.dayOf)
  // The records of a kind a subject or a group holds, and those a subject took part in with a group.
  const own = (k: PlainKind, s: Entity) => k.records.filter((r) => r.people.includes(s.id) && r.group === null)
  const withGroups = (k: PlainKind, s: Entity) => k.records.filter((r) => r.people.includes(s.id) && r.group !== null)
  const ofGroup = (k: PlainKind, g: Entity) => k.records.filter((r) => r.group === g.id)
  const changesOf = (k: PlainKind, records: Entity[]) => records.map((r) => ({ entity: r, what: words.recordOn(k.label, (source.dayOf ?? dayByDate)(r)), fields: k.fields }))
  // The first page says what the copy holds; on paper the numbered list after it finds each subject's pages.
  const parts: string[] = [
    `<h1>${escape(words.title)}</h1>`,
    `<p>${escape(words.made(source.vault, stamp(source.at), source.device))}</p>`,
    `<p>${escape(words.counts(source.subjects.length, source.groups.length, countsOf(kinds, (k) => k.records)))}</p>`,
    source.period ? `<p data-period>${escape(words.period(source.period.from, source.period.to))}</p>` : '',
    span ? `<p>${escape(words.recordDays(span))}</p>` : '',
    `<p class="warn">${escape(words.unprotected)}</p>`,
    source.withNarrative ? '' : `<p>${escape(words.narrativeLeftOut)}</p>`,
    `<h2>${escape(words.subjects)}</h2>`,
    `<ol>${subjects
      .map((s) => {
        const about = (k: PlainKind) => k.records.filter((r) => r.people.includes(s.id))
        return `<li><a href="#${anchor(s)}">${escape(text(s, 'name'))}</a> — ${escape(words.entry(countsOf(kinds, about), days(kinds.flatMap(about), source.dayOf)))}</li>`
      })
      .join('')}</ol>`,
  ]
  for (const [i, s] of subjects.entries()) {
    const fields = subjectFields.map((f) => [f.label, cell(source, f, s.fields[f.name])]).filter(([, v]) => v)
    // The subject's kinds in the order their work took, as on the subject's page in the app.
    const held = inOrderOfFirstRecord(kinds, (k) => own(k, s), source.dayOf).filter((k) => own(k, s).length > 0)
    const together = kinds.filter((k) => withGroups(k, s).length > 0)
    parts.push(
      `<h2 id="${anchor(s)}">${i + 1}. ${escape(text(s, 'name'))}</h2>`,
      fields.length ? `<dl>${fields.map(([k, v]) => `<dt>${escape(k)}</dt><dd>${escape(v)}</dd>`).join('')}</dl>` : '',
      held.length + together.length === 0 ? `<p>${escape(words.noRecords)}</p>` : '',
      ...held.map((k) => `<h3>${escape(k.label)}</h3>${recordTable(source, words, k.fields, own(k, s), false)}`),
      ...together.map((k) => `<h3>${escape(words.inGroups(k.label))}</h3>${recordTable(source, words, k.fields, withGroups(k, s), true)}`),
      changesTable(source, words, [
        { entity: s, what: text(s, 'name'), fields: [...subjectFields, ...source.subjectFields.filter((f) => f.name === 'name')] },
        ...held.flatMap((k) => changesOf(k, own(k, s))),
      ]),
    )
  }
  if (source.groups.length) {
    parts.push(`<h2>${escape(words.groups)}</h2>`)
    for (const g of byName(source.groups, source.names)) {
      const held = inOrderOfFirstRecord(kinds, (k) => ofGroup(k, g), source.dayOf).filter((k) => ofGroup(k, g).length > 0)
      parts.push(
        `<h3>${escape(text(g, 'name'))}</h3>`,
        `<p>${escape(words.members)}: ${escape(names(source.subjects, membersOf(g)))}</p>`,
        held.length === 0 ? `<p>${escape(words.noRecords)}</p>` : '',
        ...held.map((k) => `<h4>${escape(k.label)}</h4>${recordTable(source, words, k.fields, ofGroup(k, g), true)}`),
        changesTable(source, words, held.flatMap((k) => changesOf(k, ofGroup(k, g)))),
      )
    }
  }
  if (source.practitioners.length) {
    parts.push(`<h2>${escape(words.practitioners)}</h2>`, `<ul>${byName(source.practitioners, source.names).map((p) => `<li>${escape(text(p, 'name'))}</li>`).join('')}</ul>`)
  }
  return `<!doctype html>\n<html><head><meta charset="utf-8"><title>${escape(words.title)}</title><style>${STYLE}</style></head><body>\n${parts.filter(Boolean).join('\n')}\n</body></html>\n`
}

/** One CSV field: quoted when it holds a separator, a quote or a line break. */
function csvField(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}

function csv(rows: string[][]): string {
  return BOM + rows.map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n'
}

function subjectsCsv(source: PlainCopySource, words: PlainCopyWords, fields: FieldView[]): string {
  return csv([[words.name, ...fields.map((f) => f.label)], ...byName(source.subjects, source.names).map((s) => [text(s, 'name'), ...fields.map((f) => cell(source, f, s.fields[f.name]))])])
}

function recordsCsv(source: PlainCopySource, words: PlainCopyWords, fields: FieldView[], records: Entity[]): string {
  const groupName = (id: string | null) => (id ? text(source.groups.find((g) => g.id === id) ?? ({ fields: {} } as Entity), 'name') : '')
  return csv([
    [words.people, words.group, ...fields.map((f) => f.label)],
    ...oldestFirst(records, source.dayOf).map((s) => [names(source.subjects, s.people), groupName(s.group), ...fields.map((f) => cell(source, f, s.fields[f.name]))]),
  ])
}
