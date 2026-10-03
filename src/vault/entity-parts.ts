import { html, nothing } from 'lit'
import { recordFields } from '../fields.js'
import type { Entity } from '../records.js'
import { valueText } from './session-parts.js'
import type { VaultStore } from './store.js'

/**
 * What a subject's or a practitioner's record holds besides its name, to read: each field the packs
 * declare for its type, by its label, in words — the fields left empty are not listed. Correcting
 * them is the record's form.
 */
export function recordFieldList(store: VaultStore, entity: Entity) {
  const rows = recordFields(store.fieldsOf(entity.type))
    .map((f) => ({ f, value: valueText(store, f, entity.fields[f.name]) }))
    .filter(({ value }) => value !== '')
  if (rows.length === 0) return nothing
  return html`<dl class="record-fields" data-role="record-fields">
    ${rows.map(
      ({ f, value }) => html`<div data-field=${f.name}>
        <dt>${f.label}</dt>
        <dd class=${f.tier === 'narrative' ? 'narrative' : ''}>${value}</dd>
      </div>`,
    )}
  </dl>`
}
