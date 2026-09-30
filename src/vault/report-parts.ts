import { html } from 'lit'
import { labelOf, namesOf, newestFirst, text, type Entity } from '../records.js'
import { placesOf, rowSchemeOf, type Comparison, type Group, type Place, type RunRecord } from '../report.js'
import { strings } from '../strings.js'
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

/** A place in words: a row (in the version that run counted in) and a column, or a group. */
function placeText(store: VaultStore, run: RunRecord, place: Place | undefined): string {
  if (!place) return strings.nowhere
  if (place.kind === 'pending') return strings.pending
  if (place.kind === 'unmapped') return strings.unmapped
  const { scheme, version } = rowSchemeOf(run)
  const row = labelOf(store.schemes, { scheme, version, code: place.row })
  const names = new Map(store.practitioners.map((p) => [p.id, text(p, 'name')]))
  const column = place.column === null ? strings.noPractitioner : (names.get(place.column) ?? place.column)
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
  const date = (id: string) => (byId.get(id) ? text(byId.get(id)!, 'date') : '')
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
                <th>${strings.sessionDate}</th>
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
export function pendingList(store: VaultStore, choices: PendingEntry[], reclassified: Set<string>, reclassify: (choice: PendingEntry, code: string) => void) {
  const subjectNames = subjectNamesOf(store)
  const labelIn = (scheme: string, version: number, code: string) => labelOf(store.schemes, { scheme, version, code })
  return html`<section data-role="pending">
    <h3>${strings.reclassifyTitle(choices.length)}</h3>
    <p class="muted">${strings.reclassifyLead}</p>
    <table>
      <thead>
        <tr>
          <th>${strings.sessionDate}</th>
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
            <td>${text(session, 'date')}</td>
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

/** The sessions a count is made of. */
export function evidenceList(store: VaultStore, title: string, group: Group) {
  const byId = new Map(store.sessions.map((s) => [s.id, s]))
  const subjectNames = subjectNamesOf(store)
  const rows = newestFirst(group.records.map((id) => byId.get(id)).filter((s): s is Entity => !!s))
  return html`<section data-role="evidence">
    <h3>${strings.evidence(title, group.count)}</h3>
    <table>
      <thead>
        <tr>
          <th>${strings.sessionDate}</th>
          <th>${strings.evidenceSubject}</th>
          <th>${strings.sessionTopic}</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(
          (s) => html`<tr data-evidence=${s.id}>
            <td>${text(s, 'date')}</td>
            <td>${namesOf(s, subjectNames)}</td>
            <td>${labelOf(store.schemes, s.fields.topic)}</td>
          </tr>`,
        )}
      </tbody>
    </table>
  </section>`
}
