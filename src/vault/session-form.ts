import { html, nothing, type PropertyValues } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { copiedFromSubject, firstMissingRequired, inputFields, type FieldView } from '../fields.js'
import { Latest } from '../latest.js'
import { asDraft, changedFields } from '../correction.js'
import { choices, latest, text, type Entity } from '../records.js'
import { shell } from '../shell.js'
import { strings } from '../strings.js'
import { fieldInput, type Choice } from './field-input.js'
import { StoreElement } from './screen.js'
import type { Holder } from './session-parts.js'

/**
 * The form a new session is recorded with, for a subject or a group: one input per field the
 * vault's packs declare. What is filled in is the store's draft, so it carries between the two. A
 * group's attendee picker goes in the slot, and `oc-session-recorded` says the session was written.
 *
 * Given a session to `edit`, it is the form that corrects it instead: filled in with what the
 * session holds now, it writes only the fields a person changed, as a new change file — the session
 * as first written stays in the vault. `oc-session-edited` says it was written, `oc-edit-cancelled`
 * that the person left it.
 */
@customElement('oc-session-form')
export class OcSessionForm extends StoreElement {
  @property({ attribute: false }) holder!: Holder
  /** Who took part in a group session. */
  @property({ attribute: false }) attendees: string[] = []
  /** The session being corrected; none while recording a new one. */
  @property({ attribute: false }) edit?: Entity

  /** What the form shows while correcting a session: its own, apart from the new-session draft. */
  @state() private corrected: Record<string, string> = {}

  /** The version of each classification in force on the draft's date, by scheme; null when none is. */
  @state() private versions: Record<string, number | null> = {}
  private readonly versionReads = new Latest()
  private versionsFor = ''

  protected willUpdate(changed: PropertyValues<this>) {
    super.willUpdate(changed)
    if (changed.has('edit') && this.edit) this.corrected = asDraft(inputFields(this.store.sessionFields), this.edit)
    const key = this.versionKey()
    if (key !== this.versionsFor) {
      this.versionsFor = key
      void this.readVersions()
    }
  }

  /** What is filled in: the session being corrected, or the new-session draft. */
  private get draft(): Record<string, string> {
    return this.edit ? this.corrected : this.store.draft
  }

  private setValue(name: string, value: string) {
    if (this.edit) this.corrected = { ...this.corrected, [name]: value }
    else this.store.editDraft({ [name]: value })
  }

  // The date that decides which version of a classification is offered: the form's first date field.
  private dateOf(): string {
    const date = inputFields(this.store.sessionFields).find((f) => f.kind === 'date')
    return date ? (this.draft[date.name] ?? '') : ''
  }

  private coded(): FieldView[] {
    return inputFields(this.store.sessionFields).filter((f) => f.kind === 'coded' && f.scheme)
  }

  private versionKey(): string {
    return `${this.dateOf()}|${this.coded().map((f) => f.scheme).join(',')}|${this.store.schemes.length}`
  }

  private async readVersions(): Promise<Record<string, number | null>> {
    const current = this.versionReads.begin()
    const date = this.dateOf()
    const schemes = [...new Set(this.coded().map((f) => f.scheme!))]
    const found = /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? await Promise.all(schemes.map(async (s) => [s, await shell.inForce(s, date)] as const))
      : schemes.map((s) => [s, null] as const)
    const versions = Object.fromEntries(found)
    if (current()) this.versions = versions
    return versions
  }

  // The version a classification is offered and recorded in: the one in force that day, else the newest.
  private schemeFor(field: FieldView, versions = this.versions) {
    const name = field.scheme!
    const version = versions[name]
    return this.store.schemes.find((s) => s.scheme === name && s.version === version) ?? latest(this.store.schemes, name)
  }

  /**
   * The fields the form's inputs hold, as they are recorded; undefined (and the person told) when a
   * required one is missing. An input left empty is not among them.
   */
  private async filledIn(): Promise<Record<string, unknown> | undefined> {
    const store = this.store
    const draft = this.draft
    const defs = store.sessionFields
    const missing = firstMissingRequired(defs, draft)
    if (missing) {
      store.missing(missing.label)
      return undefined
    }
    const versions = await this.readVersions()
    const fields: Record<string, unknown> = {}
    for (const f of inputFields(defs)) {
      const value = (draft[f.name] ?? '').trim()
      if (!value) continue
      if (f.kind === 'coded') {
        const scheme = this.schemeFor(f, versions)
        // A code the version in force that day does not hold (the date moved after it was picked) is not recorded.
        if (!scheme?.items.some((i) => i.code === value)) {
          if (f.required) {
            store.missing(f.label)
            return undefined
          }
          continue
        }
        fields[f.name] = { scheme: scheme.scheme, version: scheme.version, code: value }
      } else if (f.kind === 'number') {
        fields[f.name] = Number(value)
      } else {
        fields[f.name] = f.tier === 'narrative' ? (draft[f.name] ?? '') : value
      }
    }
    return fields
  }

  /** Writes what a person changed in the session being corrected: changed fields only, an emptied one cleared. */
  private async saveCorrection(session: Entity) {
    const store = this.store
    const filled = await this.filledIn()
    if (!filled) return
    const changed = changedFields(inputFields(store.sessionFields), session, filled)
    if (Object.keys(changed).length === 0) {
      store.set({ notice: strings.nothingChanged })
      return
    }
    await store.run(async () => {
      await shell.record('/changes/update', { type: session.type, id: session.id, fields: changed })
      this.dispatchEvent(new Event('oc-session-edited'))
      await store.load()
      store.notice = strings.sessionCorrected
    })
  }

  private async recordSession() {
    const store = this.store
    const holder = this.holder
    const defs = store.sessionFields
    const filled = await this.filledIn()
    if (!filled) return
    const subject = holder.kind === 'subject' ? store.subjects.find((s) => s.id === holder.id) : undefined
    const fields: Record<string, unknown> = { ...(subject ? copiedFromSubject(defs, subject) : {}), ...filled }
    if (holder.kind === 'group') {
      if (this.attendees.length === 0) return store.problem('no-attendees')
      fields.attendees = this.attendees
    }
    await store.run(async () => {
      await (holder.kind === 'subject'
        ? shell.record('/changes/in-subject', { subjectId: holder.id, type: 'session', fields })
        : shell.record('/changes/in-group', { groupId: holder.id, type: 'session', fields }))
      store.clearDraft()
      this.dispatchEvent(new Event('oc-session-recorded'))
      await store.load()
    })
  }

  private input(f: FieldView) {
    const store = this.store
    const choicesOf = (): Choice[] => {
      if (f.kind === 'coded') {
        const scheme = this.schemeFor(f)
        return scheme ? choices(scheme) : []
      }
      if (f.kind === 'reference') return store.entitiesOf(f.refType).map((e) => ({ value: e.id, label: text(e, 'name') }))
      return []
    }
    return fieldInput(f, this.draft[f.name] ?? '', (v) => this.setValue(f.name, v), store.busy, choicesOf())
  }

  render() {
    const store = this.store
    const inputs = inputFields(store.sessionFields)
    if (inputs.length === 0) return html`<p class="muted" data-role="no-fields">${strings.noFieldDefinitions}</p>`
    // A required reference with nothing to point at (no practitioner yet) is added first.
    const unmet = inputs.find((f) => f.kind === 'reference' && f.required && store.entitiesOf(f.refType).length === 0)
    if (unmet) return html`<p class="muted">${strings.addFirst(unmet.label)}</p>`
    const session = this.edit
    if (session)
      return html`<div class="form" data-role="correct-session">
        <h3>${strings.correctSession}</h3>
        <p class="muted">${strings.correctSessionLead}</p>
        <div class="row">${inputs.map((f) => this.input(f))}</div>
        <div class="row">
          <dc-button variant="primary" ?disabled=${store.busy} @click=${() => void this.saveCorrection(session)}>${strings.saveCorrection}</dc-button>
          <dc-button variant="secondary" ?disabled=${store.busy} @click=${() => this.dispatchEvent(new Event('oc-edit-cancelled'))}>${strings.cancel}</dc-button>
        </div>
      </div>`
    return html`<div class="form">
      <h3>${strings.newSession}</h3>
      <div class="row">${inputs.map((f) => this.input(f))}</div>
      <slot></slot>
      <div class="row">
        <dc-button variant="primary" ?disabled=${store.busy} @click=${() => void this.recordSession()}>${strings.recordSession}</dc-button>
      </div>
    </div>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'oc-session-form': OcSessionForm
  }
}
