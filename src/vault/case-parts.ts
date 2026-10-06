import { html, nothing } from 'lit'
import { caseCounts, caseState, showsCases } from '../cases.js'
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
            <span>${c.start} ~ ${c.end ?? ''}</span>
            <span>${caseState(c, opening)}</span>
            ${c.opening === null ? html`<span class="muted">${strings.caseWithoutOpening(opening)}</span>` : nothing}
            <div class="muted">${caseCounts(c, kinds, typeOf)}${c.afterClosing.length > 0 ? html` · <span data-role="after-closing">${strings.caseAfterClosing(c.afterClosing.length)}</span>` : nothing}</div>
          </li>`,
        )}
      </ul>
      ${subjectCases.undated.length > 0 ? html`<p class="muted" data-role="undated">${strings.caseUndated(subjectCases.undated.length)}</p>` : nothing}
    </dc-card>
  </section>`
}
