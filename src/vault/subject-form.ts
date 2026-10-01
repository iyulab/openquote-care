import { html, type PropertyValues } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { asDraft, changedFields } from '../correction.js'
import { firstMissingRequired, inputFields, type FieldView } from '../fields.js'
import { choices, latest, text, type Entity } from '../records.js'
import { shell } from '../shell.js'
import { strings } from '../strings.js'
import { fieldInput, type Choice } from './field-input.js'
import { StoreElement } from './screen.js'

/**
 * The form that corrects what a subject's record holds — its name and every other field the vault's
 * packs declare for a subject. It starts from the record as it is now and writes only the fields a
 * person changed, as an edit of their own. `oc-subject-edited` says it was written,
 * `oc-edit-cancelled` that the person left it.
 */
@customElement('oc-subject-form')
export class OcSubjectForm extends StoreElement {
  @property({ attribute: false }) subject!: Entity

  @state() private values: Record<string, string> = {}

  protected willUpdate(changed: PropertyValues<this>) {
    super.willUpdate(changed)
    if (changed.has('subject')) this.values = asDraft(inputFields(this.store.subjectFields), this.subject)
  }

  private choicesOf(f: FieldView): Choice[] {
    if (f.kind === 'coded' && f.scheme) {
      const scheme = latest(this.store.schemes, f.scheme)
      return scheme ? choices(scheme) : []
    }
    if (f.kind === 'reference') return this.store.entitiesOf(f.refType).map((e) => ({ value: e.id, label: text(e, 'name') }))
    return []
  }

  /** The fields the inputs hold, as they are recorded; undefined (and the person told) when a required one is empty. */
  private filledIn(): Record<string, unknown> | undefined {
    const defs = this.store.subjectFields
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
        const scheme = latest(this.store.schemes, f.scheme)
        if (scheme?.items.some((i) => i.code === value)) fields[f.name] = { scheme: scheme.scheme, version: scheme.version, code: value }
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
    const changed = changedFields(inputFields(store.subjectFields), this.subject, filled)
    if (Object.keys(changed).length === 0) {
      store.set({ notice: strings.nothingChanged })
      return
    }
    const subject = this.subject
    await store.run(async () => {
      await shell.record('/changes/update', { type: subject.type, id: subject.id, fields: changed })
      this.dispatchEvent(new Event('oc-subject-edited'))
      await store.load()
      store.notice = strings.subjectCorrected
    })
  }

  render() {
    const store = this.store
    const inputs = inputFields(store.subjectFields)
    return html`<dc-card data-role="correct-subject">
      <h3 slot="header">${strings.correctSubject}</h3>
      <div class="stack">
        <dc-callout><p>${strings.correctSubjectLead}</p></dc-callout>
        <div class="fields">${inputs.map((f) => fieldInput(f, this.values[f.name] ?? '', (v) => (this.values = { ...this.values, [f.name]: v }), store.busy, this.choicesOf(f)))}</div>
      </div>
      <dc-button slot="footer" variant="secondary" ?disabled=${store.busy} @click=${() => this.dispatchEvent(new Event('oc-edit-cancelled'))}>${strings.cancel}</dc-button>
      <dc-button slot="footer" variant="primary" ?disabled=${store.busy} @click=${() => void this.save()}>${strings.saveCorrection}</dc-button>
    </dc-card>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'oc-subject-form': OcSubjectForm
  }
}
