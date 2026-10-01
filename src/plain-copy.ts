// A copy of the vault's records that reads without the app: one page for a person, two tables for
// a spreadsheet, and a note on what the copy is. Made here from what the window already holds; the
// shell only decides where it may be written.

import { listColumns, type FieldView } from './fields.js'
import { text, type Classified, type Entity } from './records.js'

/** What the copy is made from. */
export interface PlainCopySource {
  /** The vault folder's name, and the device and moment the copy was made on. */
  vault: string
  device: string
  at: Date
  subjects: Entity[]
  groups: Entity[]
  practitioners: Entity[]
  sessions: Entity[]
  subjectFields: FieldView[]
  sessionFields: FieldView[]
  /** How a value reads to a person: a classification's label, a reference's name. */
  valueText(field: FieldView | undefined, value: unknown): string
  /** Whether written content (`narrative` fields) goes in. */
  withNarrative: boolean
}

/** The words of the copy, in the app's language. */
export interface PlainCopyWords {
  files: { page: string; subjects: string; sessions: string; readMe: string }
  title: string
  made: (vault: string, at: string, device: string) => string
  unprotected: string
  narrativeLeftOut: string
  subjects: string
  groups: string
  practitioners: string
  name: string
  people: string
  group: string
  members: string
  noSessions: string
  readMe: (files: PlainCopyWords['files'], withNarrative: boolean) => string
}

export interface PlainFile {
  name: string
  content: string
}

const BOM = '﻿'

/** The files of the copy, in the order a person would open them. */
export function plainCopy(source: PlainCopySource, words: PlainCopyWords): PlainFile[] {
  const sessionFields = sessionColumns(source.sessionFields, source.withNarrative)
  const subjectFields = source.subjectFields.filter((f) => !f.hidden && f.name !== 'name')
  return [
    { name: words.files.page, content: page(source, words, subjectFields, sessionFields) },
    { name: words.files.subjects, content: subjectsCsv(source, words, subjectFields) },
    { name: words.files.sessions, content: sessionsCsv(source, words, sessionFields) },
    { name: words.files.readMe, content: words.readMe(words.files, source.withNarrative).replaceAll('\n', '\r\n') },
  ]
}

/**
 * A session's fields as the copy shows them: the list's columns (dates, classifications, references),
 * then any other structured field, then written content when it goes in. Attendees are the
 * session's people, shown on their own.
 */
function sessionColumns(defs: FieldView[], withNarrative: boolean): FieldView[] {
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
function oldestFirst(sessions: Entity[]): Entity[] {
  return [...sessions].sort((a, b) => text(a, 'date').localeCompare(text(b, 'date')) || a.id.localeCompare(b.id))
}

function names(entities: Entity[], ids: string[]): string {
  return ids.map((id) => text(entities.find((e) => e.id === id) ?? ({ fields: {} } as Entity), 'name') || id).join(', ')
}

function membersOf(group: Entity): string[] {
  const members = group.fields.members
  return Array.isArray(members) ? members.filter((m): m is string => typeof m === 'string') : []
}

function byName(entities: Entity[]): Entity[] {
  return [...entities].sort((a, b) => text(a, 'name').localeCompare(text(b, 'name')) || a.id.localeCompare(b.id))
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
@media print{h2{break-before:page}}`

function sessionTable(source: PlainCopySource, words: PlainCopyWords, columns: FieldView[], sessions: Entity[], people: boolean): string {
  if (sessions.length === 0) return `<p>${escape(words.noSessions)}</p>`
  const heads = [...(people ? [words.people] : []), ...columns.map((f) => f.label)]
  const rows = oldestFirst(sessions).map((s) => {
    const cells = [...(people ? [names(source.subjects, s.people)] : []), ...columns.map((f) => cell(source, f, s.fields[f.name]))]
    return `<tr>${cells.map((c, i) => `<td${columns[people ? i - 1 : i]?.tier === 'narrative' ? ' class="note"' : ''}>${escape(c)}</td>`).join('')}</tr>`
  })
  return `<table><thead><tr>${heads.map((h) => `<th>${escape(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`
}

function page(source: PlainCopySource, words: PlainCopyWords, subjectFields: FieldView[], sessionFields: FieldView[]): string {
  const subjects = byName(source.subjects)
  const anchor = (e: Entity) => `s-${e.id}`
  const parts: string[] = [
    `<h1>${escape(words.title)}</h1>`,
    `<p>${escape(words.made(source.vault, stamp(source.at), source.device))}</p>`,
    `<p class="warn">${escape(words.unprotected)}</p>`,
    source.withNarrative ? '' : `<p>${escape(words.narrativeLeftOut)}</p>`,
    `<h2>${escape(words.subjects)}</h2>`,
    `<ul>${subjects.map((s) => `<li><a href="#${anchor(s)}">${escape(text(s, 'name'))}</a></li>`).join('')}</ul>`,
  ]
  for (const s of subjects) {
    const fields = subjectFields.map((f) => [f.label, cell(source, f, s.fields[f.name])]).filter(([, v]) => v)
    const own = source.sessions.filter((x) => x.people.includes(s.id) && x.group === null)
    const inGroups = source.sessions.filter((x) => x.people.includes(s.id) && x.group !== null)
    parts.push(
      `<h2 id="${anchor(s)}">${escape(text(s, 'name'))}</h2>`,
      fields.length ? `<dl>${fields.map(([k, v]) => `<dt>${escape(k)}</dt><dd>${escape(v)}</dd>`).join('')}</dl>` : '',
      sessionTable(source, words, sessionFields, own, false),
      inGroups.length ? `<h3>${escape(words.groups)}</h3>${sessionTable(source, words, sessionFields, inGroups, true)}` : '',
    )
  }
  if (source.groups.length) {
    parts.push(`<h2>${escape(words.groups)}</h2>`)
    for (const g of byName(source.groups)) {
      parts.push(
        `<h3>${escape(text(g, 'name'))}</h3>`,
        `<p>${escape(words.members)}: ${escape(names(source.subjects, membersOf(g)))}</p>`,
        sessionTable(source, words, sessionFields, source.sessions.filter((x) => x.group === g.id), true),
      )
    }
  }
  if (source.practitioners.length) {
    parts.push(`<h2>${escape(words.practitioners)}</h2>`, `<ul>${byName(source.practitioners).map((p) => `<li>${escape(text(p, 'name'))}</li>`).join('')}</ul>`)
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
  return csv([[words.name, ...fields.map((f) => f.label)], ...byName(source.subjects).map((s) => [text(s, 'name'), ...fields.map((f) => cell(source, f, s.fields[f.name]))])])
}

function sessionsCsv(source: PlainCopySource, words: PlainCopyWords, fields: FieldView[]): string {
  const groupName = (id: string | null) => (id ? text(source.groups.find((g) => g.id === id) ?? ({ fields: {} } as Entity), 'name') : '')
  return csv([
    [words.people, words.group, ...fields.map((f) => f.label)],
    ...oldestFirst(source.sessions).map((s) => [names(source.subjects, s.people), groupName(s.group), ...fields.map((f) => cell(source, f, s.fields[f.name]))]),
  ])
}
