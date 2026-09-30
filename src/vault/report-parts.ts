import { html } from 'lit'
import { labelOfField, type FieldView } from '../fields.js'
import type { ReportEntry } from '../forms.js'
import { labelOf, namesOf, newestFirst, text, type Entity } from '../records.js'
import { placesOf, referenceAxis, rowSchemeOf, type ColumnAxis, type Comparison, type Group, type Place, type RunRecord } from '../report.js'
import { strings } from '../strings.js'
import { valueText } from './session-parts.js'
import type { VaultStore } from './store.js'

/** A pending record of the report on screen, with the codes a person chooses from. */
export interface PendingEntry {
  session: Entity
  field: string
  was: unknown
  scheme: string
  version: number
  candidates: string[]
}

const subjectNamesOf = (store: VaultStore) => new Map(store.subjects.map((s) => [s.id, text(s, 'name')]))

/** The report form a run was made with, as the vault lists it. */
export function formOf(store: VaultStore, run: RunRecord): ReportEntry | undefined {
  return store.summary?.reports.find((r) => r.name === run.report.report && r.version === run.report.version)
}

/**
 * What splits a form's columns: what its column field refers to, by name. A value naming nothing the
 * field refers to — a vault without field definitions — is looked up among every named entity.
 */
export function columnAxis(store: VaultStore, form: ReportEntry | undefined): ColumnAxis {
  if (!form?.columnField) return referenceAxis([], strings.reportCount)
  const defs = store.fieldsOf(form.counts)
  const field = defs.find((f) => f.name === form.columnField)
  const referred = field?.kind === 'reference' ? store.entitiesOf(field.refType) : []
  const axis = referenceAxis(referred, strings.noValue(labelOfField(defs, form.columnField)), store.names)
  const named = new Map([...store.practitioners, ...store.subjects, ...store.groups].map((e) => [e.id, text(e, 'name')]))
  return { ...axis, label: (id) => named.get(id) ?? axis.label(id) }
}

/** The row of a form's records with no value in its row field, in words: "(Concern none)". */
export function blankLabel(store: VaultStore, form: ReportEntry | undefined): string {
  return strings.noValue(form ? labelOfField(store.fieldsOf(form.counts), form.rowField) : strings.reportRow)
}

/** The field a form places records in a month by, and how to read it on a record. */
function periodOf(store: VaultStore, form: ReportEntry | undefined): { label: string; of: (e: Entity) => string } {
  const defs = store.fieldsOf(form?.counts ?? 'session')
  const name = form?.periodField ?? defs.find((f) => f.kind === 'date')?.name ?? ''
  const field: FieldView | undefined = defs.find((f) => f.name === name)
  return { label: labelOfField(defs, name), of: (e) => valueText(store, field, e.fields[name]) }
}

/** A place in words: a row (in the version that run counted in) and a column, or a group. */
function placeText(store: VaultStore, run: RunRecord, place: Place | undefined): string {
  if (!place) return strings.nowhere
  if (place.kind === 'pending') return strings.pending
  if (place.kind === 'unmapped') return strings.unmapped
  if (place.kind === 'blank') return blankLabel(store, formOf(store, run))
  const { scheme, version } = rowSchemeOf(run)
  const row = labelOf(store.schemes, { scheme, version, code: place.row })
  const axis = columnAxis(store, formOf(store, run))
  const column = place.column === null ? axis.none : axis.label(place.column)
  return `${row} · ${column}`
}

/** What changed between two runs of a form, session by session. */
export function comparisonView(store: VaultStore, c: Comparison) {
  const before = placesOf(c.earlier)
  const after = placesOf(c.later)
  const byId = new Map(store.sessions.map((s) => [s.id, s]))
  const subjectNames = subjectNamesOf(store)
  const changed = [
    ...c.late.map((id) => ({ id, kind: 'late' as const })),
    ...c.removed.map((id) => ({ id, kind: 'removed' as const })),
    ...c.revised.map((id) => ({ id, kind: 'revised' as const })),
    ...c.moved.map((id) => ({ id, kind: 'moved' as const })),
  ]
  const kinds = ['late', 'removed', 'revised', 'moved'] as const
  const period = periodOf(store, formOf(store, c.later))
  const date = (id: string) => (byId.get(id) ? period.of(byId.get(id)!) : '')
  changed.sort((a, b) => date(b.id).localeCompare(date(a.id)) || a.id.localeCompare(b.id))
  return html`<section data-role="comparison">
    <h3>${strings.comparisonTitle(c.earlier.report.version, c.later.report.version)}</h3>
    <p data-role="comparison-counts">${strings.comparisonCounts(c.late.length, c.removed.length, c.revised.length, c.moved.length, c.unchanged.length)}</p>
    ${changed.length === 0
      ? html`<p class="muted">${strings.noDifference}</p>`
      : html`<dl class="legend" data-role="comparison-legend">
            ${kinds
              .filter((k) => changed.some((ch) => ch.kind === k))
              .map((k) => html`<div><dt>${strings.changeKind[k]}</dt><dd>${strings.changeKindHint[k]}</dd></div>`)}
          </dl>
          <table>
            <thead>
              <tr>
                <th>${period.label}</th>
                <th>${strings.evidenceSubject}</th>
                <th>${strings.changeKindHeader}</th>
                <th>${strings.before}</th>
                <th>${strings.after}</th>
              </tr>
            </thead>
            <tbody>
              ${changed.map(({ id, kind }) => {
                const session = byId.get(id)
                return html`<tr data-change=${kind} data-id=${id}>
                  <td>${date(id)}</td>
                  <td>${session ? namesOf(session, subjectNames) : ''}</td>
                  <td>${strings.changeKind[kind]}</td>
                  <td>${placeText(store, c.earlier, before.get(id))}</td>
                  <td>${placeText(store, c.later, after.get(id))}</td>
                </tr>`
              })}
            </tbody>
          </table>`}
  </section>`
}

/** The report's pending records, each with the codes it may take; a choice already made shows as made. */
export function pendingList(
  store: VaultStore,
  run: RunRecord,
  choices: PendingEntry[],
  reclassified: Set<string>,
  reclassify: (choice: PendingEntry, code: string) => void,
) {
  const subjectNames = subjectNamesOf(store)
  const period = periodOf(store, formOf(store, run))
  const labelIn = (scheme: string, version: number, code: string) => labelOf(store.schemes, { scheme, version, code })
  return html`<section data-role="pending">
    <h3>${strings.reclassifyTitle(choices.length)}</h3>
    <p class="muted">${strings.reclassifyLead}</p>
    <table>
      <thead>
        <tr>
          <th>${period.label}</th>
          <th>${strings.evidenceSubject}</th>
          <th>${strings.reclassifyWas}</th>
          <th>${strings.reclassifyTo}</th>
        </tr>
      </thead>
      <tbody>
        ${newestFirst(choices.map((c) => c.session)).map((session) => {
          const c = choices.find((x) => x.session.id === session.id)!
          const done = reclassified.has(session.id)
          return html`<tr data-pending=${session.id}>
            <td>${period.of(session)}</td>
            <td>${namesOf(session, subjectNames)}</td>
            <td>${labelOf(store.schemes, c.was)}</td>
            <td>
              ${done
                ? html`<span class="muted">${strings.reclassified} · ${labelOf(store.schemes, session.fields[c.field])}</span>`
                : html`<div class="row">
                    ${c.candidates.map(
                      (code) => html`<dc-button
                        size="sm"
                        variant="secondary"
                        data-code=${code}
                        ?disabled=${store.busy}
                        @click=${() => reclassify(c, code)}
                        >${labelIn(c.scheme, c.version, code)}</dc-button
                      >`,
                    )}
                  </div>`}
            </td>
          </tr>`
        })}
      </tbody>
    </table>
  </section>`
}

/** The records a count is made of: when, about whom, and the value the form's rows count by. */
export function evidenceList(store: VaultStore, run: RunRecord, title: string, group: Group) {
  const byId = new Map(store.sessions.map((s) => [s.id, s]))
  const subjectNames = subjectNamesOf(store)
  const form = formOf(store, run)
  const period = periodOf(store, form)
  const defs = store.fieldsOf(form?.counts ?? 'session')
  const rowField = form?.rowField ?? ''
  const row = defs.find((f) => f.name === rowField)
  const rows = newestFirst(group.records.map((id) => byId.get(id)).filter((s): s is Entity => !!s))
  return html`<section data-role="evidence">
    <h3>${strings.evidence(title, group.count)}</h3>
    <table>
      <thead>
        <tr>
          <th>${period.label}</th>
          <th>${strings.evidenceSubject}</th>
          <th>${labelOfField(defs, rowField)}</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(
          (s) => html`<tr data-evidence=${s.id}>
            <td>${period.of(s)}</td>
            <td>${namesOf(s, subjectNames)}</td>
            <td>${valueText(store, row, s.fields[rowField])}</td>
          </tr>`,
        )}
      </tbody>
    </table>
  </section>`
}
