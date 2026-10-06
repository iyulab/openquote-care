import { html, nothing } from 'lit'
import { byCase, caseCounts, caseDays, caseHead, caseStateBesideDays, showsCases, type CaseGroup } from '../cases.js'
import type { PlainCase } from '../plain-copy.js'
import type { Entity } from '../records.js'
import { strings } from '../strings.js'
import type { VaultStore } from './store.js'

/**
 * A subject's cases, newest first: each with its days, its state, its records counted by kind, and what came
 * after it ended. Shown only when some record opened or closed a case, and only when the packs say which kinds do.
 */
export function caseSection(store: VaultStore, subject: string) {
  const subjectCases = store.cases.get(subject)
  const { opens, closes } = store.caseKinds()
  if (!opens || !closes || !showsCases(subjectCases)) return nothing
  const opening = store.labelOf(opens)
  const closing = store.labelOf(closes)
  const kinds = store.kinds.map((k) => ({ type: k.type, label: store.labelOf(k) }))
  const typeOf = (id: string) => store.recordById(id)?.type
  const numbered = subjectCases.cases.map((c, i) => ({ c, n: i + 1 })).reverse()
  return html`<section data-role="cases">
    <dc-section-heading marker size="lg" heading=${strings.cases}></dc-section-heading>
    <p class="muted">${strings.caseLead(opening, closing)}</p>
    <dc-card>
      <ul class="cases">
        ${numbered.map(
          ({ c, n }) => html`<li data-case=${n} data-open=${c.open ? 'yes' : 'no'}>
            <strong>${strings.caseTitle(n)}</strong>
            <span>${caseDays(c)}</span>
            <span>${caseStateBesideDays(c, opening)}</span>
            ${c.opening === null ? html`<span class="muted">${strings.caseWithoutOpening(opening)}</span>` : nothing}
            <div class="muted">${caseCounts(c, kinds, typeOf)}${c.afterClosing.length > 0 ? html` · <span data-role="after-closing">${strings.caseAfterClosing(c.afterClosing.length)}</span>` : nothing}</div>
          </li>`,
        )}
      </ul>
      ${subjectCases.undated.length > 0 ? html`<p class="muted" data-role="undated">${strings.caseUndated(subjectCases.undated.length)}</p>` : nothing}
    </dc-card>
  </section>`
}

/**
 * How a subject's lists split their records by case, newest case first — or undefined when the subject's cases are
 * not shown, and the lists stay one run of rows.
 */
export function recordsByCase(store: VaultStore, subject: string): ((records: Entity[]) => CaseGroup<Entity>[]) | undefined {
  const subjectCases = store.cases.get(subject)
  const { opens, closes } = store.caseKinds()
  if (!opens || !closes || !showsCases(subjectCases)) return undefined
  const opening = store.labelOf(opens)
  return (records) => byCase(records, subjectCases, opening)
}

/**
 * A subject's cases in words for the copy that reads without the app, newest first — each one's heading, what it
 * holds by kind, and what came after it ended; none when the subject's cases are not shown.
 */
export function plainCases(store: VaultStore, subject: string): PlainCase[] {
  const subjectCases = store.cases.get(subject)
  const { opens, closes } = store.caseKinds()
  if (!opens || !closes || !showsCases(subjectCases)) return []
  const opening = store.labelOf(opens)
  const kinds = store.kinds.map((k) => ({ type: k.type, label: store.labelOf(k) }))
  const typeOf = (id: string) => store.recordById(id)?.type
  return subjectCases.cases
    .map((c, i) => ({
      start: c.start,
      end: c.end,
      line: [caseHead(c, i + 1, opening), caseCounts(c, kinds, typeOf), ...(c.afterClosing.length > 0 ? [strings.caseAfterClosing(c.afterClosing.length)] : [])]
        .filter(Boolean)
        .join(' · '),
    }))
    .reverse()
}
