import { html, type PropertyValues } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { asDraft, changedFields } from '../correction.js'
import { firstMissingRequired, inputFields, type FieldView } from '../fields.js'
import { extensionsOf, latest, offeredChoices, ownerOf, text, type Entity, type Offered } from '../records.js'
import { shell } from '../shell.js'
import { strings } from '../strings.js'
import { fieldInput, type Choice } from './field-input.js'
import { StoreElement } from './screen.js'

/** What the form says about the kind of record it corrects. */
function wordingOf(type: string) {
  return type === 'practitioner'
    ? { heading: strings.correctPractitioner, done: strings.practitionerCorrected }
    : { heading: strings.correctSubject, done: strings.subjectCorrected }
}

/**
 * The form that corrects what a subject's or a practitioner's record holds — its name and every
 * other field the vault's packs declare for its type. It starts from the record as it is now and
 * writes only the fields a person changed, as an edit of their own. `oc-entity-edited` says it was
 * written, `oc-edit-cancelled` that the person left it.
 */
@customElement('oc-entity-form')
export class OcEntityForm extends StoreElement {
  @property({ attribute: false }) entity!: Entity

  @state() private values: Record<string, string> = {}

  private get defs(): FieldView[] {
    return this.store.fieldsOf(this.entity.type)
  }

  protected willUpdate(changed: PropertyValues<this>) {
    super.willUpdate(changed)
    // A vault read again (on returning to the window, or a change synced from another device) hands down
    // the same record as a new object: what the person has typed stays. Only another record starts the form again.
    if (changed.has('entity') && changed.get('entity')?.id !== this.entity.id) this.values = asDraft(inputFields(this.defs), this.entity)
  }

  // A record of this kind is classified in a scheme's newest version, or in a list the vault keeps beside it.
  private offeredFor(scheme: string): Offered {
    return { base: latest(this.store.schemes, scheme), extensions: extensionsOf(this.store.schemes, scheme) }
  }

  private choicesOf(f: FieldView): Choice[] {
    if (f.kind === 'coded' && f.scheme) return offeredChoices(this.offeredFor(f.scheme))
    if (f.kind === 'reference') return this.store.entitiesOf(f.refType).map((e) => ({ value: e.id, label: text(e, 'name') }))
    return []
  }

  /** The fields the inputs hold, as they are recorded; undefined (and the person told) when a required one is empty. */
  private filledIn(): Record<string, unknown> | undefined {
    const defs = this.defs
    const missing = firstMissingRequired(defs, this.values)
    if (missing) {
      this.store.missing(missing.label)
      return undefined
    }
    const fields: Record<string, unknown> = {}
    for (const f of inputFields(defs)) {
      const value = (this.values[f.name] ?? '').trim()
      if (!value) continue
      if (f.kind === 'coded' && f.scheme) {
        const owner = ownerOf(this.offeredFor(f.scheme), value)
        if (owner) fields[f.name] = { scheme: owner.scheme, version: owner.version, code: value }
      } else if (f.kind === 'number') {
        fields[f.name] = Number(value)
      } else {
        fields[f.name] = f.tier === 'narrative' ? (this.values[f.name] ?? '') : value
      }
    }
    return fields
  }

  private async save() {
    const store = this.store
    const filled = this.filledIn()
    if (!filled) return
    const changed = changedFields(inputFields(this.defs), this.entity, filled)
    if (Object.keys(changed).length === 0) {
      store.set({ notice: strings.nothingChanged })
      return
    }
    const entity = this.entity
    await store.run(async () => {
      await shell.record('/changes/update', { type: entity.type, id: entity.id, fields: changed })
      this.dispatchEvent(new Event('oc-entity-edited'))
      await store.load()
      store.notice = wordingOf(entity.type).done
    })
  }

  /** Leaves the form unwritten; what it said was wrong goes with it. */
  private leave() {
    this.store.set({ error: undefined })
    this.dispatchEvent(new Event('oc-edit-cancelled'))
  }

  render() {
    const store = this.store
    const inputs = inputFields(this.defs)
    return html`<dc-card data-role=${`correct-${this.entity.type}`}>
      <h3 slot="header">${wordingOf(this.entity.type).heading}</h3>
      <div class="stack">
        <dc-callout><p>${strings.correctionLead}</p></dc-callout>
        <div class="fields">${inputs.map((f) => fieldInput(f, this.values[f.name] ?? '', (v) => (this.values = { ...this.values, [f.name]: v }), store.busy, this.choicesOf(f)))}</div>
      </div>
      <dc-button slot="footer" variant="secondary" ?disabled=${store.busy} @click=${() => this.leave()}>${strings.cancel}</dc-button>
      <dc-button slot="footer" variant="primary" ?disabled=${store.busy} @click=${() => void this.save()}>${strings.saveCorrection}</dc-button>
    </dc-card>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'oc-entity-form': OcEntityForm
  }
}
