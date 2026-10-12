import { html } from 'lit'
import { customElement } from 'lit/decorators.js'
import { strings } from '../strings.js'
import './record-kinds.js'
import { VaultScreen } from './screen.js'

/**
 * Work about no one in particular — a training given or attended, a meeting, an event — each kind the vault's packs
 * keep in the activity folder with its records, newest first, and a form to add one.
 */
@customElement('oc-activities')
export class OcActivities extends VaultScreen {
  protected screen() {
    // The toolbar names the screen; each kind's own heading carries the button that adds a record of it.
    return html`<div class="stack">
      <p class="muted" data-role="activities-lead">${strings.activitiesLead}</p>
      <oc-record-kinds .store=${this.store} .holder=${{ kind: 'activity' } as const}></oc-record-kinds>
    </div>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'oc-activities': OcActivities
  }
}
