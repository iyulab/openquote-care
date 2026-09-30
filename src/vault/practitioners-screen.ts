import { html } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { text } from '../records.js'
import { shell } from '../shell.js'
import { strings } from '../strings.js'
import { nameField } from './parts.js'
import { VaultScreen } from './screen.js'

/** The practitioners sessions are kept by. */
@customElement('oc-practitioners')
export class OcPractitioners extends VaultScreen {
  @state() private practitionerName = ''

  private async addPractitioner() {
    const name = this.practitionerName.trim()
    if (!name) return this.store.problem('no-name')
    await this.store.run(async () => {
      await shell.record('/changes/practitioner', { fields: { name } })
      this.practitionerName = ''
      await this.store.load()
    })
  }

  protected screen() {
    const { busy, practitioners } = this.store
    const add = () => void this.addPractitioner()
    return html`<section>
      <div class="row">
        ${nameField(busy, strings.practitionerName, this.practitionerName, (v) => (this.practitionerName = v), add)}
        <dc-button variant="secondary" ?disabled=${busy} @click=${add}>${strings.addPractitioner}</dc-button>
      </div>
      ${practitioners.length === 0
        ? html`<p class="muted">${strings.noPractitioners}</p>`
        : html`<ul class="plain" aria-label=${strings.practitioners}>
            ${practitioners.map((p) => html`<li>${text(p, 'name')}</li>`)}
          </ul>`}
    </section>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'oc-practitioners': OcPractitioners
  }
}
