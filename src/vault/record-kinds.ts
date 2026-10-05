import { html, nothing } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { conflictsOf, inOrderOfFirstRecord, newestFirst, type Entity } from '../records.js'
import type { RecordKind } from '../shell.js'
import { shell } from '../shell.js'
import { strings } from '../strings.js'
import './record-form.js'
import { StoreElement } from './screen.js'
import { conflictPanel, sessionTable, subjectPicker, toggled, type Holder } from './session-parts.js'

/**
 * The kinds of record besides sessions that the vault's packs keep under a subject or a group — a referral, say —
 * in the order their first record here happened, each with its records, newest first, and a form a person opens to add one. A record's concurrent changes are
 * shown for a person to settle, and a record can be corrected, as a session can.
 */
@customElement('oc-record-kinds')
export class OcRecordKinds extends StoreElement {
  @property({ attribute: false }) holder!: Holder
  /** For a group: the subjects who take part by default, the group's members. */
  @property({ attribute: false }) members: string[] = []

  /** The kinds whose form is open for adding a record. */
  @state() private adding = new Set<string>()
  /** Who a group record being added concerns, by kind; the members until a person changes it. */
  @state() private attendees: Record<string, string[]> = {}
  /** Records whose written content is open under their row. */
  @state() private openNotes = new Set<string>()
  /** The record open for correcting. */
  @state() private correcting?: string
  /** The record whose concurrent changes are open for a person to settle. */
  @state() private settling?: string

  private recordsHere(kind: RecordKind): Entity[] {
    const { kind: holds, id } = this.holder
    return newestFirst(this.store.recordsOf(kind.type).filter((r) => (holds === 'subject' ? r.subject === id && !r.group : r.group === id)))
  }

  private async settle(record: Entity, field: string, value: unknown) {
    const store = this.store
    await store.run(async () => {
      await shell.record('/changes/update', { type: record.type, id: record.id, fields: { [field]: value } })
      await store.load()
      if (conflictsOf(store.recordsOf(record.type).find((r) => r.id === record.id) ?? record).length === 0) this.settling = undefined
    })
  }

  private attendeesOf(type: string): string[] {
    return this.attendees[type] ?? this.members
  }

  render() {
    const kinds = this.store.kindsUnder(this.holder.kind).filter((k) => k.type !== 'session')
    return inOrderOfFirstRecord(kinds, (kind) => this.recordsHere(kind)).map((kind) => this.section(kind))
  }

  private section(kind: RecordKind) {
    const store = this.store
    const name = this.store.labelOf(kind)
    const fields = store.fieldsOf(kind.type)
    const records = this.recordsHere(kind)
    const correcting = records.find((r) => r.id === this.correcting)
    const open = records.find((r) => r.id === this.settling && conflictsOf(r).length > 0)
    const adding = this.adding.has(kind.type)
    const toggleAdding = () => (this.adding = toggled(this.adding, kind.type))
    return html`<section data-kind=${kind.type}>
      <dc-section-heading marker size="lg" heading=${name}>
        ${adding
          ? nothing
          : html`<dc-button slot="actions" variant="secondary" size="sm" data-role="add-record" ?disabled=${store.busy} @click=${() => {
              store.set({ notice: '' })
              toggleAdding()
            }}>${strings.openRecordForm(name)}</dc-button>`}
      </dc-section-heading>
      ${open ? conflictPanel(store, open, (field, value) => void this.settle(open, field, value), fields) : nothing}
      ${correcting
        ? html`<oc-record-form
            .store=${store}
            .holder=${this.holder}
            type=${kind.type}
            kindLabel=${name}
            .edit=${correcting}
            @oc-record-edited=${() => (this.correcting = undefined)}
            @oc-edit-cancelled=${() => (this.correcting = undefined)}
          ></oc-record-form>`
        : nothing}
      ${adding
        ? html`<oc-record-form
            .store=${store}
            .holder=${this.holder}
            type=${kind.type}
            kindLabel=${name}
            .attendees=${this.attendeesOf(kind.type)}
            @oc-record-recorded=${() => {
              this.adding = toggled(this.adding, kind.type)
              const { [kind.type]: _, ...rest } = this.attendees
              this.attendees = rest
            }}
            >${this.holder.kind === 'group'
              ? subjectPicker(store, strings.attendees, () => this.attendeesOf(kind.type), (ids) => (this.attendees = { ...this.attendees, [kind.type]: ids }))
              : nothing}</oc-record-form
          >`
        : nothing}
      ${records.length === 0
        ? html`<dc-empty-state description=${strings.noRecordsOf(name)}></dc-empty-state>`
        : html`<dc-card
            ><div class="scroll">
              ${sessionTable(store, {
                sessions: records,
                fields,
                attendees: this.holder.kind === 'group',
                openNotes: this.openNotes,
                toggleNote: (id) => (this.openNotes = toggled(this.openNotes, id)),
                settle: (id) => (this.settling = id),
                correct: (id) => {
                  store.set({ notice: '' })
                  this.correcting = id
                },
              })}
            </div></dc-card
          >`}
    </section>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'oc-record-kinds': OcRecordKinds
  }
}
