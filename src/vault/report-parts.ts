import { html } from 'lit'
import { labelOfField, type FieldView } from '../fields.js'
import { rowFieldOf, type Dimension, type ReportEntry } from '../forms.js'
import { labelOf, namesOf, newestFirst, text, type Entity } from '../records.js'
import { placesOf, referenceAxis, schemeAxis, valueAxis, type Axis, type Comparison, type Group, type Place, type RunRecord } from '../report.js'
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
 * How a run reads along each dimension of its form, in key order: a classified dimension by the
 * scheme version the run counted in, a field that refers to entities by their names, any other field
 * by its values. A form of one dimension gets a second axis whose one column holds every record.
 */
export function axesOf(store: VaultStore, form: ReportEntry | undefined, run: RunRecord): Axis[] {
  const axes = form
    ? form.dimensions.map((d) => axisOf(store, form, run, d))
    : // A form the vault no longer offers: its rows by the scheme the run counted in.
      [schemeAxis(schemeOf(store, run, Object.keys(run.schemes)[0] ?? '', null), strings.noValue(strings.reportRow))]
  if (axes.length < 2) axes.push(referenceAxis([], strings.reportCount))
  return axes
}

function schemeOf(store: VaultStore, run: RunRecord, scheme: string, version: number | null) {
  const counted = run.schemes[scheme]?.version ?? version
  return store.schemes.find((s) => s.scheme === scheme && s.version === counted)
}

/**
 * One dimension's axis. A value naming nothing a reference field refers to — a vault without field
 * definitions — is looked up among every named entity.
 */
function axisOf(store: VaultStore, form: ReportEntry, run: RunRecord, d: Dimension): Axis {
  const defs = store.fieldsOf(d.ofSubject ? 'subject' : form.counts)
  const none = strings.noValue(labelOfField(defs, d.field))
  if (d.scheme) return schemeAxis(schemeOf(store, run, d.scheme, d.version), none)
  const field = defs.find((f) => f.name === d.field)
  if (d.ofSubject || (field && field.kind !== 'reference')) return valueAxis(none, store.names)
  const axis = referenceAxis(field?.kind === 'reference' ? store.entitiesOf(field.refType) : [], none, store.names)
  const named = new Map([...store.practitioners, ...store.subjects, ...store.groups].map((e) => [e.id, text(e, 'name')]))
  return { ...axis, label: (id) => named.get(id) ?? axis.label(id) }
}

/** What each dimension of a form is called, in key order: its field's label. */
export function dimensionTitles(store: VaultStore, form: ReportEntry | undefined): string[] {
  return (form?.dimensions ?? []).map((d) => labelOfField(store.fieldsOf(d.ofSubject ? 'subject' : form!.counts), d.field))
}

/** A form's conditions in words: each field, and the values it lets through (a classified one in the version the run counted in). */
export function filterParts(store: VaultStore, form: ReportEntry | undefined, run: RunRecord): string[] {
  return (form?.filters ?? []).map((f) => {
    const name = labelOfField(store.fieldsOf(f.ofSubject ? 'subject' : form!.counts), f.field)
    const scheme = f.scheme
    const values = scheme ? f.in.map((code) => labelOf(store.schemes, { scheme, version: run.schemes[scheme]?.version ?? f.version ?? 0, code })) : f.in
    return `${name}: ${values.join(', ')}`
  })
}

/** The row of a form's records with no value in its row field, in words: "(Concern none)". */
export function blankLabel(store: VaultStore, form: ReportEntry | undefined): string {
  return strings.noValue(form ? labelOfField(store.fieldsOf(form.counts), rowFieldOf(form)) : strings.reportRow)
}

/**
 * What a form calls the records it cannot carry into the version it counts in. A form counting by
 * lists that extend another — the items added to a vault — counts no value of the list it extends:
 * those records are outside the added items, not of an old category.
 */
export function unmappedWording(store: VaultStore, form: ReportEntry | undefined): { label: string; hint: string } {
  const classified = form?.dimensions.filter((d) => d.scheme !== null) ?? []
  const extending = classified.length > 0 && classified.every((d) => store.schemes.some((s) => s.scheme === d.scheme && s.extends))
  return extending ? { label: strings.outsideAdded, hint: strings.outsideAddedHint } : { label: strings.unmapped, hint: strings.unmappedHint }
}

/** The field a form places records in a month by, and how to read it on a record. */
function periodOf(store: VaultStore, form: ReportEntry | undefined): { label: string; of: (e: Entity) => string } {
  const defs = store.fieldsOf(form?.counts ?? 'session')
  const name = form?.periodField ?? defs.find((f) => f.kind === 'date')?.name ?? ''
  const field: FieldView | undefined = defs.find((f) => f.name === name)
  return { label: labelOfField(defs, name), of: (e) => valueText(store, field, e.fields[name]) }
}

/** A place in words: its place on each dimension (a classified one in the version that run counted in), or a group. */
function placeText(store: VaultStore, run: RunRecord, place: Place | undefined): string {
  if (!place) return strings.nowhere
  if (place.kind === 'pending') return strings.pending
  if (place.kind === 'unmapped') return unmappedWording(store, formOf(store, run)).label
  if (place.kind === 'blank') return blankLabel(store, formOf(store, run))
  if (place.kind === 'conflicted') return strings.conflict
  const axes = axesOf(store, formOf(store, run), run)
  return place.key.map((id, i) => (id === null ? (axes[i]?.none ?? strings.nowhere) : (axes[i]?.label(id) ?? id))).join(' · ')
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
    ...c.settled.map((id) => ({ id, kind: 'settled' as const })),
    ...c.moved.map((id) => ({ id, kind: 'moved' as const })),
  ]
  const kinds = ['late', 'removed', 'revised', 'settled', 'moved'] as const
  const period = periodOf(store, formOf(store, c.later))
  const date = (id: string) => (byId.get(id) ? period.of(byId.get(id)!) : '')
  changed.sort((a, b) => date(b.id).localeCompare(date(a.id)) || a.id.localeCompare(b.id))
  return html`<section data-role="comparison">
    <dc-section-heading marker size="lg" heading=${strings.comparisonTitle(c.earlier.report.version, c.later.report.version)}></dc-section-heading>
    <p data-role="comparison-counts">${strings.comparisonCounts(c.late.length, c.removed.length, c.revised.length, c.settled.length, c.moved.length, c.unchanged.length)}</p>
    ${changed.length === 0
      ? html`<p class="muted">${strings.noDifference}</p>`
      : html`<dl class="legend" data-role="comparison-legend">
            ${kinds
              .filter((k) => changed.some((ch) => ch.kind === k))
              .map((k) => html`<div><dt>${strings.changeKind[k]}</dt><dd>${strings.changeKindHint[k]}</dd></div>`)}
          </dl>
          <dc-card><div class="scroll"><table>
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
                  <td class="wrap">${placeText(store, c.earlier, before.get(id))}</td>
                  <td class="wrap">${placeText(store, c.later, after.get(id))}</td>
                </tr>`
              })}
            </tbody>
          </table></div></dc-card>`}
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
    <dc-section-heading marker size="lg" heading=${strings.reclassifyTitle(choices.length)}></dc-section-heading>
    <p class="muted">${strings.reclassifyLead}</p>
    <dc-card><div class="scroll"><table>
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
    </table></div></dc-card>
  </section>`
}

/** The records a count is made of: when, about whom, and the value the form's rows count by. */
export function evidenceList(store: VaultStore, run: RunRecord, title: string, group: Group) {
  const byId = new Map(store.sessions.map((s) => [s.id, s]))
  const subjectNames = subjectNamesOf(store)
  const form = formOf(store, run)
  const period = periodOf(store, form)
  const defs = store.fieldsOf(form?.counts ?? 'session')
  const rowField = form ? rowFieldOf(form) : ''
  const row = defs.find((f) => f.name === rowField)
  const rows = newestFirst(group.records.map((id) => byId.get(id)).filter((s): s is Entity => !!s))
  return html`<section data-role="evidence">
    <dc-section-heading marker size="lg" heading=${strings.evidence(title, group.count)}></dc-section-heading>
    <dc-card><div class="scroll"><table>
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
    </table></div></dc-card>
  </section>`
}
