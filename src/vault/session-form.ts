import { css, html, nothing, type PropertyValues } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { copiedFromSubject, firstMissingRequired, inputFields, labelOfField, type FieldView } from '../fields.js'
import { Latest } from '../latest.js'
import { asDraft, changedFields } from '../correction.js'
import { choices, latest, text, type Entity, type FieldSuggestions, type Scheme, type SuggestedCode } from '../records.js'
import { shell, type CarryView } from '../shell.js'
import { strings } from '../strings.js'
import { alsoKey, othersOf, recordedValues } from '../several.js'
import { fieldInput, type Choice, type FieldExtras } from './field-input.js'
import { StoreElement } from './screen.js'
import { vaultStyles } from './styles.js'
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
 *
 * While a new session is filled in, an empty classification offers the codes the vault's settled
 * sessions suggest for what is filled in so far, each with how many similar records hold it and,
 * on request, which ones (their date and who they are about — never what they say). Nothing is filled
 * in until a person takes one; the session then records that the value came from a suggestion, until
 * a person changes it.
 */
@customElement('oc-session-form')
export class OcSessionForm extends StoreElement {
  static styles = [
    vaultStyles,
    css`
      :host {
        display: contents;
      }
      /*
       * A classification's suggestions, and why when asked: a row of the form's grid of its own under the
       * field's row, named by the field — inside the field's narrow column they made the whole row taller.
       */
      .suggested {
        display: flex;
        flex-direction: column;
        gap: var(--dc-space-2, 8px);
        margin-top: calc(-1 * var(--dc-space-1, 4px));
      }
      .suggestions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--dc-space-1, 4px);
      }
      .why {
        margin: 0;
        padding: var(--dc-space-2, 8px) var(--dc-space-3, 12px);
        border-radius: var(--dc-radius-md, 6px);
        background: var(--dc-color-surface, #f7f7f8);
        font-size: var(--dc-font-size-sm, 12px);
      }
      .why ul {
        margin: var(--dc-space-1, 4px) 0 0;
        padding-left: var(--dc-space-4, 16px);
      }
    `,
  ]

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

  /** Codes suggested for the new session's empty classifications; none while correcting a session. */
  @state() private suggestions: FieldSuggestions[] = []
  /** The field whose suggestions' similar records are shown. */
  @state() private whyOpen = ''
  private readonly suggestionReads = new Latest()
  private suggestionsFor = ''
  private suggestionsFrom?: Entity[]
  private suggestionTimer?: ReturnType<typeof setTimeout>

  /** What the new session would take from its subject on the draft's date; none for a group or while correcting. */
  @state() private carried: CarryView[] = []
  /** The values a person gives the subject's stale fields before the session takes them, by the subject's field. */
  @state() private refreshed: Record<string, string> = {}
  private readonly carryReads = new Latest()
  private carryFor = ''
  private carryFrom?: Entity[]

  protected willUpdate(changed: PropertyValues<this>) {
    super.willUpdate(changed)
    if (changed.has('edit') && this.edit) this.corrected = asDraft(inputFields(this.store.sessionFields), this.edit)
    const key = this.versionKey()
    if (key !== this.versionsFor) {
      this.versionsFor = key
      void this.readVersions()
    }
    // Asked again when the date or the subject changes, or the subjects are read again (one is corrected, say).
    const carry = !this.edit && this.holder.kind === 'subject' ? `${this.holder.id}|${this.dateOf()}` : ''
    if (carry !== this.carryFor || this.store.subjects !== this.carryFrom) {
      this.carryFor = carry
      this.carryFrom = this.store.subjects
      void this.readCarry()
    }
    // Asked again once typing pauses, and when the vault's sessions change (one is recorded, say).
    const asked = this.edit ? '' : `${JSON.stringify(this.store.draft)}|${JSON.stringify(this.versions)}`
    if (asked !== this.suggestionsFor || this.store.sessions !== this.suggestionsFrom) {
      this.suggestionsFor = asked
      this.suggestionsFrom = this.store.sessions
      clearTimeout(this.suggestionTimer)
      if (asked) this.suggestionTimer = setTimeout(() => void this.readSuggestions(), 300)
      else this.suggestions = []
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    clearTimeout(this.suggestionTimer)
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
   * The values the form's inputs hold, as they are recorded: a classification as its code in the
   * version in force that day. An input left empty is not among them, nor is a code that version
   * does not hold (the date moved after it was picked) — that field is named in `dropped`.
   */
  private recorded(versions: Record<string, number | null>): { fields: Record<string, unknown>; dropped: FieldView[] } {
    const draft = this.draft
    const fields: Record<string, unknown> = {}
    const dropped: FieldView[] = []
    for (const f of inputFields(this.store.sessionFields)) {
      const value = (draft[f.name] ?? '').trim()
      if (!value) continue
      if (f.kind === 'coded') {
        const scheme = this.schemeFor(f, versions)
        if (!scheme?.items.some((i) => i.code === value)) {
          dropped.push(f)
          continue
        }
        // A field taking several: the others that version holds go with the primary value.
        const others = f.many ? othersOf(draft, f.name).filter((c) => scheme.items.some((i) => i.code === c)) : []
        fields[f.name] = recordedValues(scheme.scheme, scheme.version, value, others)
      } else if (f.kind === 'number') {
        fields[f.name] = Number(value)
      } else {
        fields[f.name] = f.tier === 'narrative' ? (draft[f.name] ?? '') : value
      }
    }
    return { fields, dropped }
  }

  /**
   * The fields the form's inputs hold, as they are recorded; undefined (and the person told) when a
   * required one is missing.
   */
  private async filledIn(): Promise<Record<string, unknown> | undefined> {
    const store = this.store
    const missing = firstMissingRequired(store.sessionFields, this.draft)
    if (missing) {
      store.missing(missing.label)
      return undefined
    }
    const { fields, dropped } = this.recorded(await this.readVersions())
    const required = dropped.find((f) => f.required)
    if (required) {
      store.missing(required.label)
      return undefined
    }
    return fields
  }

  private async readSuggestions() {
    const current = this.suggestionReads.begin()
    const date = this.dateOf()
    let found: FieldSuggestions[] = []
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      try {
        found = (await shell.suggestions('session', date, this.recorded(this.versions).fields)).fields
      } catch {
        // Suggestions are a help, never in the way: none are offered when they cannot be read.
      }
    }
    if (current()) this.suggestions = found
  }

  /** Reads what the session would take from its subject; a stale value is offered for the person to confirm. */
  private async readCarry() {
    const current = this.carryReads.begin()
    const date = this.dateOf()
    let found: CarryView[] = []
    if (this.holder.kind === 'subject' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      try {
        found = await shell.carry('session', this.holder.id, date)
      } catch {
        // Then the session takes the subject's values as they stand, as it always did.
      }
    }
    if (!current()) return
    this.carried = found
    this.refreshed = Object.fromEntries(found.filter((c) => c.stale).map((c) => [c.subjectField, c.offer ?? '']))
  }

  /** The subject's values that are stale for the draft's date. */
  private get stale(): CarryView[] {
    return this.carried.filter((c) => c.stale)
  }

  /** Says which of the subject's values may no longer hold, with a field for each, filled with what is offered. */
  private staleView() {
    const stale = this.stale
    if (stale.length === 0) return nothing
    const writtenOn = stale.map((c) => c.writtenOn ?? '').sort()[0]
    return html`<dc-callout role="status" data-role="stale-subject">
      <p>${strings.staleSubject(stale.map((c) => c.label), writtenOn)}</p>
      <div class="fields">
        ${stale.map(
          (c) => html`<dc-field label=${c.label} hint=${c.value ? strings.staleSubjectWas(c.value) : ''}>
            <dc-input
              aria-label=${c.label}
              data-stale=${c.subjectField}
              .value=${this.refreshed[c.subjectField] ?? ''}
              ?disabled=${this.store.busy}
              @input=${(e: Event) => (this.refreshed = { ...this.refreshed, [c.subjectField]: (e.target as HTMLInputElement).value })}
            ></dc-input>
          </dc-field>`,
        )}
      </div>
    </dc-callout>`
  }

  private take(f: FieldView, code: string) {
    this.whyOpen = ''
    this.store.editDraft({ [f.name]: code }, 'suggestion')
  }

  /** A suggestion's similar record as a person knows it: its date and who it is about. */
  private similarRecord(id: string): string {
    const store = this.store
    const session = store.sessions.find((s) => s.id === id)
    if (!session) return ''
    const group = session.group ? store.groups.find((g) => g.id === session.group) : undefined
    const subject = session.subject ? store.subjects.find((s) => s.id === session.subject) : undefined
    const who = group ? text(group, 'name') : subject ? text(subject, 'name') : ''
    return [text(session, 'date'), who].filter(Boolean).join(' ')
  }

  /**
   * The value the session being entered shares with the records a suggestion rests on, as a person reads
   * it; none for written content, which a suggestion never repeats.
   */
  private sharedValue(name: string): string | undefined {
    const field = this.store.sessionFields.find((f) => f.name === name)
    const value = this.draft[name]
    if (!field || !value || field.tier === 'narrative') return undefined
    if (field.kind !== 'coded' || !field.scheme) return value
    return latest(this.store.schemes, field.scheme)?.items.find((i) => i.code === value)?.label ?? value
  }

  /** Why a code is suggested, beside it: how many records it rests on, and what they share with this one. */
  private reasonOf(c: SuggestedCode): string {
    if (c.basis === 'frequent') return strings.frequentlyChosen
    if (c.basis === 'sameValue' && c.field) return strings.sameValueRecords(labelOfField(this.store.sessionFields, c.field), c.similar.length)
    return c.similar.length > 0 ? strings.similarRecords(c.similar.length) : ''
  }

  /** Why a code is suggested, in full: the records it rests on, or that it is simply chosen often. */
  private whyOf(c: SuggestedCode): string {
    const records = c.similar.map((id) => this.similarRecord(id)).filter(Boolean).join(', ')
    if (c.basis === 'frequent') return strings.whyFrequent
    if (c.basis === 'sameValue' && c.field) {
      const field = labelOfField(this.store.sessionFields, c.field)
      const value = this.sharedValue(c.field)
      return `${value ? strings.whySameValue(field, value) : strings.whySameField(field)} ${records}`
    }
    return records
  }


  /**
   * What a classification of a new session offers besides its dropdown: the codes suggested for it and —
   * when asked — why, as a row of the form's grid below the field's row (`below`).
   */
  private suggestionExtras(f: FieldView): FieldExtras & { below?: unknown } {
    const store = this.store
    const hint = store.suggested.has(f.name) ? strings.takenFromSuggestion : undefined
    const offered = this.draft[f.name] ? undefined : this.suggestions.find((s) => s.field === f.name)
    const scheme: Scheme | undefined = offered && store.schemes.find((s) => s.scheme === offered.scheme && s.version === offered.version)
    if (!offered || !scheme) return { hint }
    const label = (code: string) => scheme.items.find((i) => i.code === code)?.label ?? code
    const explained = offered.codes.filter((c) => c.basis !== 'similarRecords' || c.similar.length > 0)
    const open = this.whyOpen === f.name
    return {
      hint,
      below: html`<div class="suggested wide" data-suggested=${f.name}>
        <div class="suggestions" role="group" aria-label=${`${f.label} · ${strings.suggested}`} data-suggestions=${f.name}>
          <span class="muted">${f.label} · ${strings.suggested}</span>
          ${offered.codes.map(
            (c) =>
              html`<dc-button
                size="sm"
                variant=${c.confirm ? 'secondary' : 'outline'}
                data-suggestion=${c.code}
                ?data-confirm=${c.confirm}
                ?disabled=${store.busy}
                @click=${() => this.take(f, c.code)}
                >${c.confirm ? html`<strong>${strings.confirmFirst}</strong> · ` : nothing}${label(c.code)}${this.reasonOf(c)
                  ? ` · ${this.reasonOf(c)}`
                  : ''}</dc-button
              >`,
          )}
          ${explained.length > 0
            ? html`<dc-button
                size="sm"
                variant="ghost"
                data-role="why-suggested"
                aria-expanded=${open ? 'true' : 'false'}
                @click=${() => (this.whyOpen = open ? '' : f.name)}
                >${open ? strings.hideWhySuggested : strings.showWhySuggested}</dc-button
              >`
            : nothing}
        </div>
        ${open
          ? html`<div class="why" data-why=${f.name}>
              <span class="muted">${strings.suggestedBecause}</span>
              <ul aria-label=${`${f.label} · ${strings.suggestedBecause}`}>
                ${explained.map(
                  (c) =>
                    html`<li data-basis=${c.basis}>
                      <strong>${label(c.code)}</strong>
                      ${this.whyOf(c)}
                    </li>`,
                )}
              </ul>
            </div>`
          : nothing}
      </div>`,
    }
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
    const stale = holder.kind === 'subject' ? this.stale : []
    if (stale.length > 0) {
      // The subject is corrected first, to what the person confirmed, so the session takes values someone gave.
      const corrected = Object.fromEntries(stale.map((c) => [c.subjectField, (this.refreshed[c.subjectField] ?? '').trim() || null]))
      await store.run(async () => {
        await shell.record('/changes/update', { type: 'subject', id: holder.id, fields: corrected })
        await store.load()
      })
      if (store.error) return
    }
    const subject = holder.kind === 'subject' ? store.subjects.find((s) => s.id === holder.id) : undefined
    const fields: Record<string, unknown> = { ...(subject ? copiedFromSubject(defs, subject) : {}), ...filled }
    // Only a value still as it was taken, and still recorded, is from a suggestion.
    const source = Object.fromEntries([...store.suggested].filter((name) => name in filled).map((name) => [name, 'suggestion']))
    if (holder.kind === 'group') {
      if (this.attendees.length === 0) return store.problem('no-attendees')
      fields.attendees = this.attendees
    }
    await store.run(async () => {
      await (holder.kind === 'subject'
        ? shell.record('/changes/in-subject', { subjectId: holder.id, type: 'session', fields, source })
        : shell.record('/changes/in-group', { groupId: holder.id, type: 'session', fields, source }))
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
    const extras: FieldExtras & { below?: unknown } = !this.edit && f.kind === 'coded' ? this.suggestionExtras(f) : {}
    const options = choicesOf()
    if (f.kind === 'coded' && f.many) extras.after = html`${extras.after ?? nothing}${this.others(f, options)}`
    return html`${fieldInput(f, this.draft[f.name] ?? '', (v) => this.setValue(f.name, v), store.busy, options, extras)}${extras.below ?? nothing}`
  }

  /**
   * The other values of a field taking several, beside the primary one the dropdown holds: each
   * with a way to take it out, and a dropdown to add one more — offered once a primary value is chosen.
   */
  private others(f: FieldView, options: Choice[]) {
    const busy = this.store.busy
    const primary = this.draft[f.name] ?? ''
    const others = othersOf(this.draft, f.name)
    const label = (code: string) => options.find((o) => o.value === code)?.label ?? code
    const setOthers = (codes: string[]) => this.setValue(alsoKey(f.name), codes.join('\n'))
    const left = options.filter((o) => o.value !== primary && !others.includes(o.value))
    return html`<div class="others" data-others=${f.name}>
      ${others.map(
        (code) => html`<dc-button size="sm" variant="outline" data-other=${code} aria-label=${strings.removeOther(label(code))} ?disabled=${busy}
          @click=${() => setOthers(others.filter((c) => c !== code))}>${label(code)} ✕</dc-button>`,
      )}
      ${primary && left.length > 0
        ? html`<dc-select
            size="sm"
            aria-label=${strings.addOther}
            placeholder=${strings.addOther}
            data-add-other=${f.name}
            .options=${left}
            .value=${''}
            ?disabled=${busy}
            @change=${(e: Event) => {
              const code = (e.target as HTMLSelectElement).value
              if (code) setOthers([...others, code])
            }}
          ></dc-select>`
        : nothing}
    </div>`
  }

  /** Leaves the form unwritten; what it said was wrong goes with it. */
  private leave() {
    this.store.set({ error: undefined })
    this.dispatchEvent(new Event('oc-edit-cancelled'))
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
      return html`<dc-card data-role="correct-session">
        <h3 slot="header">${strings.correctSession}</h3>
        <div class="stack">
          <dc-callout><p>${strings.correctSessionLead}</p></dc-callout>
          <div class="fields">${inputs.map((f) => this.input(f))}</div>
        </div>
        <dc-button slot="footer" variant="secondary" ?disabled=${store.busy} @click=${() => this.leave()}>${strings.cancel}</dc-button>
        <dc-button slot="footer" variant="primary" ?disabled=${store.busy} @click=${() => void this.saveCorrection(session)}>${strings.saveCorrection}</dc-button>
      </dc-card>`
    return html`<section>
      <dc-section-heading marker size="lg" heading=${strings.newSession}></dc-section-heading>
      <dc-card>
        <div class="stack">
          <div class="fields">${inputs.map((f) => this.input(f))}</div>
          ${this.staleView()}
          <slot></slot>
        </div>
        <dc-button slot="footer" variant="primary" ?disabled=${store.busy} @click=${() => void this.recordSession()}>${strings.recordSession}</dc-button>
      </dc-card>
    </section>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'oc-session-form': OcSessionForm
  }
}
