import { html } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { choices, latest, text } from '../records.js'
import { shell } from '../shell.js'
import { strings } from '../strings.js'
import { atSession } from '../subject-fields.js'
import { StoreElement } from './screen.js'
import type { Holder } from './session-parts.js'

/**
 * The form a new session is recorded with, for a subject or a group. What is filled in is the
 * store's draft, so it carries between the two. A group's attendee picker goes in the slot, and
 * `oc-session-recorded` says the session was written.
 */
@customElement('oc-session-form')
export class OcSessionForm extends StoreElement {
  @property({ attribute: false }) holder!: Holder
  /** Who took part in a group session. */
  @property({ attribute: false }) attendees: string[] = []

  private async recordSession() {
    const store = this.store
    const holder = this.holder
    const draft = store.draft
    const topics = latest(store.schemes, 'topic')
    const methods = latest(store.schemes, 'method')
    if (!draft.date) return store.problem('no-date')
    if (!topics || !draft.topic) return store.problem('no-topic')
    if (!draft.practitioner) return store.problem('no-practitioner')
    const subject = holder.kind === 'subject' ? store.subjects.find((s) => s.id === holder.id) : undefined
    const fields: Record<string, unknown> = {
      ...(subject ? atSession(subject) : {}),
      date: draft.date,
      practitioner: draft.practitioner,
      topic: { scheme: 'topic', version: topics.version, code: draft.topic },
    }
    if (methods && draft.method) fields.method = { scheme: 'method', version: methods.version, code: draft.method }
    if (holder.kind === 'group') {
      if (this.attendees.length === 0) return store.problem('no-attendees')
      fields.attendees = this.attendees
    }
    await store.run(async () => {
      await (holder.kind === 'subject'
        ? shell.record('/changes/in-subject', { subjectId: holder.id, type: 'session', fields })
        : shell.record('/changes/in-group', { groupId: holder.id, type: 'session', fields }))
      store.editDraft({ topic: '', method: '' })
      this.dispatchEvent(new Event('oc-session-recorded'))
      await store.load()
    })
  }

  render() {
    const store = this.store
    const { busy, draft } = store
    const topics = latest(store.schemes, 'topic')
    const methods = latest(store.schemes, 'method')
    if (store.practitioners.length === 0) {
      return html`<p class="muted">${strings.needPractitioner}</p>`
    }
    return html`<div class="form">
      <h3>${strings.newSession}</h3>
      <div class="row">
        <label>
          ${strings.sessionDate}
          <dc-input
            type="date"
            aria-label=${strings.sessionDate}
            .value=${draft.date}
            ?disabled=${busy}
            @input=${(e: Event) => store.editDraft({ date: (e.target as HTMLInputElement).value })}
          ></dc-input>
        </label>
        <label>
          ${strings.sessionPractitioner}
          <dc-select
            aria-label=${strings.sessionPractitioner}
            .options=${store.practitioners.map((p) => ({ value: p.id, label: text(p, 'name') }))}
            .value=${draft.practitioner}
            placeholder=${strings.sessionPractitioner}
            ?disabled=${busy}
            @change=${(e: Event) => store.editDraft({ practitioner: (e.target as HTMLSelectElement).value })}
          ></dc-select>
        </label>
      </div>
      <div class="row">
        <label>
          ${strings.sessionTopic}
          <dc-select
            aria-label=${strings.sessionTopic}
            .options=${topics ? choices(topics) : []}
            .value=${draft.topic}
            placeholder=${strings.sessionTopic}
            ?disabled=${busy}
            @change=${(e: Event) => store.editDraft({ topic: (e.target as HTMLSelectElement).value })}
          ></dc-select>
        </label>
        <label>
          ${strings.sessionMethod}
          <dc-select
            aria-label=${strings.sessionMethod}
            .options=${[{ value: '', label: strings.noMethod }, ...(methods ? choices(methods) : [])]}
            .value=${draft.method}
            ?disabled=${busy}
            @change=${(e: Event) => store.editDraft({ method: (e.target as HTMLSelectElement).value })}
          ></dc-select>
        </label>
      </div>
      <slot></slot>
      <div class="row">
        <dc-button variant="primary" ?disabled=${busy} @click=${() => void this.recordSession()}>${strings.recordSession}</dc-button>
      </div>
    </div>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'oc-session-form': OcSessionForm
  }
}
