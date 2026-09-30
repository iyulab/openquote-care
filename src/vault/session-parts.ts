import { html, nothing } from 'lit'
import type { DcCheckbox } from '@iyulab/desktop-compact/checkbox'
import { conflictsOf, labelOf, text, type Entity } from '../records.js'
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

/** A value in words: a classification by its label, a practitioner by name, anything else as written. */
function valueText(store: VaultStore, field: string, value: unknown): string {
  if (field === 'practitioner' && typeof value === 'string') {
    return text(store.practitioners.find((p) => p.id === value) ?? ({ fields: {} } as Entity), 'name') || value
  }
  return labelOf(store.schemes, value) || (typeof value === 'string' ? value : JSON.stringify(value))
}

/** A session's concurrent changes, each field with every device's value to keep. */
export function conflictPanel(store: VaultStore, session: Entity, settle: (field: string, value: unknown) => void) {
  return html`<div class="form" data-role="settle">
    <h3>${strings.conflictTitle} · ${text(session, 'date')}</h3>
    <p class="muted">${strings.conflictLead}</p>
    ${(session.missingBase?.length ?? 0) > 0 ? html`<p class="muted" data-role="missing-base">${strings.conflictMissingBase}</p>` : nothing}
    ${conflictsOf(session).map(
      ({ field, heads }) => html`<div class="row">
        <span>${strings.conflictField[field] ?? field}</span>
        ${heads.map(
          (h) => html`<dc-button
            size="sm"
            variant="secondary"
            data-device=${h.device}
            ?disabled=${store.busy}
            @click=${() => settle(field, h.value)}
            >${valueText(store, field, h.value)} · ${strings.conflictFrom(deviceLabel(store.summary, h.device))}</dc-button
          >`,
        )}
      </div>`,
    )}
  </div>`
}
