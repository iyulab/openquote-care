import { html, nothing } from 'lit'
import { primaryAndOthers } from '../several.js'
import type { DcCheckbox } from '@iyulab/desktop-compact/checkbox'
import { attendeesAt, labelOfField, listColumns, narrativeFields, type FieldView } from '../fields.js'
import { conflictsOf, labelOf, namesOf, text, type Entity } from '../records.js'
import type { CaseGroup } from '../cases.js'
import { strings } from '../strings.js'
import { deviceLabel } from './parts.js'
import type { VaultStore } from './store.js'

/** Where a new session is kept: a subject's folder, or a group's (with its attendees). */
export type Holder = { kind: 'subject'; id: string } | { kind: 'group'; id: string }

/** A list of subjects to tick. `current` is read afresh on each tick: two can land before the next render. */
export function subjectPicker(store: VaultStore, label: string, current: () => string[], set: (ids: string[]) => void) {
  const picked = current()
  if (store.subjects.length === 0) return html`<p class="muted">${strings.noSubjects}</p>`
  return html`<fieldset class="picker" aria-label=${label}>
    <legend>${label}</legend>
    ${store.subjects.map(
      (s) => html`<dc-checkbox
        data-subject=${s.id}
        .checked=${picked.includes(s.id)}
        ?disabled=${store.busy}
        @change=${(e: Event) => {
          const now = current().filter((id) => id !== s.id)
          set((e.target as DcCheckbox).checked ? [...now, s.id] : now)
        }}
        >${text(s, 'name')}</dc-checkbox
      >`,
    )}
  </fieldset>`
}

/**
 * A recorded value in words, by what its field holds: a classification by its label in the version
 * it was recorded in, a reference by the name of what it points at, anything else as written.
 */
export function valueText(store: VaultStore, field: FieldView | undefined, value: unknown): string {
  if (value === undefined || value === null) return ''
  // A number as people read one: an amount of 120000 is 120,000.
  if (field?.kind === 'number' && typeof value === 'number') return strings.number(value)
  if (field?.kind === 'reference' && typeof value === 'string') {
    if (pointsAtRecords(store, field)) {
      const record = store.recordById(value)
      return record ? recordName(store, record) : value
    }
    const entity = store.entitiesOf(field.refType).find((e) => e.id === value)
    return entity ? text(entity, 'name') : value
  }
  const label = labelOf(store.schemes, value)
  if (label) return label
  if (Array.isArray(value)) {
    // Several values: the primary one first, the others after it.
    const { primary, others } = primaryAndOthers(value)
    const labels = others.map((o) => labelOf(store.schemes, o))
    return primary ? strings.severalValues(labelOf(store.schemes, primary), labels) : labels.join(', ')
  }
  return typeof value === 'string' || typeof value === 'number' ? String(value) : JSON.stringify(value)
}

/** Whether a reference field points at records of a kind (a provision at the referral it follows), not at people. */
function pointsAtRecords(store: VaultStore, field: FieldView): boolean {
  return store.kinds.some((k) => k.type === field.refType)
}

/** How a record another points at is named: the day it happened and its first classification ("2026-10-01 · Mental health service"). */
export function recordName(store: VaultStore, record: Entity): string {
  const field = store.fieldsOf(record.type).find((f) => f.kind === 'coded' && !f.hidden && record.fields[f.name] !== undefined && record.fields[f.name] !== null)
  return [store.dayOf(record), field ? valueText(store, field, record.fields[field.name]) : ''].filter(Boolean).join(' · ')
}

/**
 * What a reference field may point at from a record `holder` keeps: the people of its type, or — when it
 * points at a kind of record — the holder's own records of that kind, the latest first.
 */
export function referenceChoices(store: VaultStore, field: FieldView, holder: Holder | undefined): { value: string; label: string }[] {
  if (!pointsAtRecords(store, field))
    return store.entitiesOf(field.refType).map((e) => ({ value: e.id, label: text(e, 'name') }))
  const own = store
    .recordsOf(field.refType!)
    .filter((r) => holder !== undefined && (holder.kind === 'subject' ? r.subject === holder.id : r.group === holder.id))
  return [...own].sort((a, b) => store.dayOf(b).localeCompare(store.dayOf(a))).map((r) => ({ value: r.id, label: recordName(store, r) }))
}

/** The set with `id` added, or taken out when it is there. */
export function toggled(set: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(set)
  if (!next.delete(id)) next.add(id)
  return next
}

/** How a list of records on a screen draws — sessions or another kind: which records, and what a row's buttons do. */
export interface RecordTable {
  records: Entity[]
  /** The fields of the kind of record listed: sessions' when not given. */
  fields?: FieldView[]
  /** A group's list: the participants get a column, before the references. */
  attendees?: boolean
  /** Sessions whose written content is open under their row. */
  openNotes: ReadonlySet<string>
  toggleNote(id: string): void
  /** Opens a session's concurrent changes for a person to settle; without it, they are not offered. */
  settle?(id: string): void
  /** Opens a session to correct; without it, correcting is not offered. */
  correct?(id: string): void
  /** A subject's list: its records split by case, each case under a heading row; one run of rows without it. */
  byCase?(records: Entity[]): CaseGroup<Entity>[]
}

/**
 * Records as a table whose columns are the fields of their kind (dates, classifications, references).
 * Written content is not a column: a row that has some offers to open it underneath.
 */
export function recordTable(store: VaultStore, t: RecordTable) {
  const defs = t.fields ?? store.sessionFields
  const columns = listColumns(defs)
  const notes = narrativeFields(defs)
  const subjectNames = new Map(store.subjects.map((s) => [s.id, text(s, 'name')]))
  const at = t.attendees ? attendeesAt(columns) : -1
  const heads = columns.map((f) => f.label)
  if (at >= 0) heads.splice(at, 0, strings.attendees)
  // Numbers line up by their last digit, as in any table of amounts; the attendees' column is never one.
  const numeric = columns.map((f) => f.kind === 'number')
  if (at >= 0) numeric.splice(at, 0, false)
  // The fields a form of the vault adds up for this kind — sessions' minutes, a provision's amount — are added up
  // under each case too; a number no form adds up (a scale's score) is not.
  const type = t.records[0]?.type
  const summed = new Set((store.summary?.reports ?? []).filter((r) => r.offered && r.counts === type).flatMap((r) => r.sums))
  const totals = columns.map((f) => f.kind === 'number' && summed.has(f.name))
  if (at >= 0) totals.splice(at, 0, false)
  const span = Math.max(heads.length, 1)
  return html`<table>
    <thead>
      <tr>
        ${heads.map((h, i) => html`<th class=${numeric[i] ? 'num' : nothing}>${h}</th>`)}
      </tr>
    </thead>
    <tbody>
      ${(t.byCase?.(t.records) ?? [{ n: null, head: '', records: t.records }]).map(
        (g) => html`${g.head
          ? html`<tr class="case-head" data-case-head=${g.n ?? 'none'}><th colspan=${span} scope="colgroup">${g.head}</th></tr>`
          : nothing}${g.records.map((s) => row(s))}${total(g.records, g.n)}`,
      )}
    </tbody>
  </table>`

  /** Under two or more records, the sums of the fields a form adds up; nothing when there are none. */
  function total(records: Entity[], n: number | null) {
    if (records.length < 2 || !totals.some(Boolean)) return nothing
    const sums = columns.map((f) => records.reduce((sum, r) => sum + (typeof r.fields[f.name] === 'number' ? (r.fields[f.name] as number) : 0), 0))
    if (at >= 0) sums.splice(at, 0, 0)
    return html`<tr class="case-total" data-case-total=${n ?? 'all'}>
      ${heads.map((_, i) =>
        i === 0
          ? html`<td>${strings.caseTotal}</td>`
          : totals[i]
            ? html`<td class="num">${strings.number(sums[i])}</td>`
            : html`<td></td>`,
      )}
    </tr>`
  }

  function row(s: Entity) {
    const cells = columns.map((f) => valueText(store, f, s.fields[f.name]))
    if (at >= 0) cells.splice(at, 0, namesOf(s, subjectNames))
    const written = notes.filter((f) => typeof s.fields[f.name] === 'string' && (s.fields[f.name] as string).trim() !== '')
    const open = t.openNotes.has(s.id)
    return html`<tr data-session=${s.type === 'session' ? s.id : nothing} data-record=${s.id}>
        ${cells.map(
          (c, i) =>
            html`<td class=${i === at ? 'wrap' : numeric[i] ? 'num' : nothing}>
              ${c}
              ${i === 0 && store.corrected.has(s.id) ? html`<dc-badge class="cell" variant="accent" data-role="corrected">${strings.corrected}</dc-badge>` : nothing}
              ${i === 0 && t.correct
                ? html`<button class="cell" data-role="correct" ?disabled=${store.busy} @click=${() => t.correct!(s.id)}>${strings.correct}</button>`
                : nothing}
              ${i === 0 && t.settle && conflictsOf(s).length > 0
                ? html`<button class="cell conflict" data-role="conflict" @click=${() => t.settle!(s.id)}>${strings.conflict}</button>`
                : nothing}
              ${i === 0 && written.length > 0
                ? html`<button class="cell" data-role="note" aria-expanded=${open ? 'true' : 'false'} @click=${() => t.toggleNote(s.id)}>
                    ${open ? strings.hideNote(written[0].label) : strings.showNote(written[0].label)}
                  </button>`
                : nothing}
            </td>`,
        )}
      </tr>
      ${open && written.length > 0
        ? html`<tr data-note=${s.id}>
            <td colspan=${span}>
              ${written.map((f) => html`<div class="note"><strong>${f.label}</strong><p>${s.fields[f.name] as string}</p></div>`)}
            </td>
          </tr>`
        : nothing}`
  }
}

/** A record's concurrent changes, each field with every device's value to keep; `fields` are sessions' when not given. */
export function conflictPanel(store: VaultStore, session: Entity, settle: (field: string, value: unknown) => void, fields?: FieldView[]) {
  const defs = fields ?? store.sessionFields
  const date = defs.find((f) => f.name === store.datedOf(session.type))
  return html`<dc-callout variant="warning" data-role="settle"><div class="stack">
    <h3>${strings.conflictTitle}${date ? ` · ${valueText(store, date, session.fields[date.name])}` : ''}</h3>
    <p>${strings.conflictLead}</p>
    ${(session.missingBase?.length ?? 0) > 0 ? html`<p data-role="missing-base">${strings.conflictMissingBase}</p>` : nothing}
    ${conflictsOf(session).map(
      ({ field, heads }) => html`<div class="row">
        <span>${labelOfField(defs, field)}</span>
        ${heads.map(
          (h) => html`<dc-button
            size="sm"
            variant="secondary"
            data-device=${h.device}
            ?disabled=${store.busy}
            @click=${() => settle(field, h.value)}
            >${valueText(store, defs.find((f) => f.name === field), h.value)} · ${strings.conflictFrom(deviceLabel(store.summary, h.device))}</dc-button
          >`,
        )}
      </div>`,
    )}
  </div></dc-callout>`
}
