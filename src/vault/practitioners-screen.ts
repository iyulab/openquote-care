import { html } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { newestFirst, text, type Entity } from '../records.js'
import { shell } from '../shell.js'
import { strings } from '../strings.js'
import { listDetail, nameField } from './parts.js'
import { VaultScreen } from './screen.js'
import { sessionTable, toggled } from './session-parts.js'

/** The practitioners sessions are kept by, and the sessions each one kept. */
@customElement('oc-practitioners')
export class OcPractitioners extends VaultScreen {
  @state() private practitionerName = ''
  @state() private selected?: string
  /** The document is the form for adding a practitioner, rather than one's sessions. */
  @state() private adding = false
  /** While the window is narrow: the document shows instead of the list. */
  @state() private documentOpen = false
  /** Sessions whose written content is open under their row. */
  @state() private openNotes = new Set<string>()

  private async addPractitioner() {
    const name = this.practitionerName.trim()
    if (!name) return this.store.problem('no-name')
    await this.store.run(async () => {
      const path = await shell.record('/changes/practitioner', { fields: { name } })
      this.practitionerName = ''
      await this.store.load()
      this.pick(path.split('/')[1])
    })
  }

  private pick(id: string) {
    this.selected = id
    this.adding = false
    this.documentOpen = true
  }

  protected screen() {
    const { practitioners } = this.store
    const practitioner = this.adding ? undefined : practitioners.find((p) => p.id === this.selected)
    return listDetail({
      label: strings.practitioners,
      head: html`<dc-button
        variant="secondary"
        size="sm"
        @click=${() => {
          this.adding = true
          this.documentOpen = true
        }}
        >${strings.newPractitioner}</dc-button
      >`,
      entries: practitioners.map((p) => ({ id: p.id, label: text(p, 'name') })),
      selected: this.adding ? undefined : this.selected,
      select: (id) => this.pick(id),
      empty: strings.noPractitioners,
      document: this.adding
        ? this.addForm()
        : practitioner
          ? this.practitionerDetail(practitioner)
          : html`<p class="muted">${strings.pickPractitioner}</p>`,
      open: this.documentOpen,
      back: () => (this.documentOpen = false),
    })
  }

  private addForm() {
    const busy = this.store.busy
    const add = () => void this.addPractitioner()
    return html`<h2>${strings.addPractitioner}</h2>
      <div class="row">
        ${nameField(busy, strings.practitionerName, this.practitionerName, (v) => (this.practitionerName = v), add)}
        <dc-button variant="primary" ?disabled=${busy} @click=${add}>${strings.addPractitioner}</dc-button>
      </div>`
  }

  /** The sessions whose practitioner reference — whichever field the packs give it — points at this one. */
  private practitionerDetail(practitioner: Entity) {
    const store = this.store
    const refs = store.sessionFields.filter((f) => f.kind === 'reference' && f.refType === 'practitioner').map((f) => f.name)
    const sessions = newestFirst(store.sessions.filter((s) => refs.some((r) => s.fields[r] === practitioner.id)))
    return html`<h2>${strings.sessions(text(practitioner, 'name'))}</h2>
      ${sessions.length === 0
        ? html`<p class="muted">${strings.noSessions}</p>`
        : html`<p class="muted">${strings.sessionCount(sessions.length)}</p>
            ${sessionTable(store, {
              sessions,
              attendees: true,
              openNotes: this.openNotes,
              toggleNote: (id) => (this.openNotes = toggled(this.openNotes, id)),
            })}`}`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'oc-practitioners': OcPractitioners
  }
}
