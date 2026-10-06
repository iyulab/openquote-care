import { html, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { entityOf, newestFirst, text, type Entity } from '../records.js'
import { shell } from '../shell.js'
import { strings } from '../strings.js'
import './entity-form.js'
import { recordFieldList } from './entity-parts.js'
import { countBy, listDetail, nameField, noticeLine } from './parts.js'
import { VaultScreen } from './screen.js'
import { recordTable, toggled } from './session-parts.js'

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
  /** The practitioner picked shows the form correcting their record. */
  @state() private correcting = false

  private async addPractitioner() {
    const name = this.practitionerName.trim()
    if (!name) return this.store.problem('no-name')
    await this.store.run(async () => {
      const path = await shell.record('/changes/practitioner', { fields: { name } })
      this.practitionerName = ''
      await this.store.load()
      this.pick(entityOf(path))
    })
  }

  private pick(id: string) {
    this.selected = id
    this.adding = false
    this.correcting = false
    this.documentOpen = true
  }

  protected screen() {
    const { practitioners } = this.store
    const practitioner = this.adding ? undefined : practitioners.find((p) => p.id === this.selected)
    const refs = this.store.sessionFields.filter((f) => f.kind === 'reference' && f.refType === 'practitioner').map((f) => f.name)
    const counts = countBy(this.store.sessions, (s) => [...new Set(refs.map((r) => s.fields[r]).filter((id): id is string => typeof id === 'string'))])
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
      entries: practitioners.map((p) => ({ id: p.id, label: text(p, 'name'), meta: strings.sessionCount(counts.get(p.id) ?? 0) })),
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
    return html`<dp-page-header eyebrow=${strings.practitioners} heading=${strings.addPractitioner}></dp-page-header>
      <dc-card>
        ${nameField(busy, strings.practitionerName, this.practitionerName, (v) => (this.practitionerName = v), add)}
        <dc-button slot="footer" variant="primary" ?disabled=${busy} @click=${add}>${strings.addPractitioner}</dc-button>
      </dc-card>`
  }

  /** The sessions whose practitioner reference — whichever field the packs give it — points at this one. */
  private practitionerDetail(practitioner: Entity) {
    const store = this.store
    const refs = store.sessionFields.filter((f) => f.kind === 'reference' && f.refType === 'practitioner').map((f) => f.name)
    const sessions = newestFirst(store.sessions.filter((s) => refs.some((r) => s.fields[r] === practitioner.id)), store.dayOf)
    return html`<dp-page-header
        eyebrow=${strings.practitioners}
        heading=${text(practitioner, 'name')}
        description=${strings.sessionCount(sessions.length)}
      >
        ${this.correcting
          ? nothing
          : html`<dc-button slot="actions" variant="secondary" size="sm" data-role="correct-practitioner-open" ?disabled=${store.busy} @click=${() => {
              store.set({ notice: '' })
              this.correcting = true
            }}>${strings.correctPractitioner}</dc-button>`}
      </dp-page-header>
      ${this.correcting
        ? html`<oc-entity-form
            .store=${store}
            .entity=${practitioner}
            @oc-entity-edited=${() => (this.correcting = false)}
            @oc-edit-cancelled=${() => (this.correcting = false)}
          ></oc-entity-form>`
        : recordFieldList(store, practitioner)}
      <section>
        <dc-section-heading marker size="lg" heading=${strings.sessionHistory}></dc-section-heading>
        ${sessions.length === 0
          ? html`<dc-empty-state description=${strings.noSessions}></dc-empty-state>`
          : html`<dc-card
              ><div class="scroll">
                ${recordTable(store, {
                  records: sessions,
                  attendees: true,
                  openNotes: this.openNotes,
                  toggleNote: (id) => (this.openNotes = toggled(this.openNotes, id)),
                })}
              </div></dc-card
            >`}
      </section>
      ${noticeLine(store)}`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'oc-practitioners': OcPractitioners
  }
}
