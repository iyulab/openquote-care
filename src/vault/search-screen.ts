import { html, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { newestFirst, text, type Entity } from '../records.js'
import { searchRecords, searchWords, type RecordText } from '../search.js'
import { strings } from '../strings.js'
import { openSessionEvent } from './parts.js'
import { VaultScreen } from './screen.js'
import { valueText } from './session-parts.js'

/** How many sessions found are listed; a narrower query lists the rest. */
const SHOWN = 200

/** Finding sessions and other records by what they say, newest first; each one found opens where it is kept. */
@customElement('oc-search')
export class OcSearch extends VaultScreen {
  @state() private query = ''

  /** What people call a kind of record other than sessions; nothing for a session. */
  private kindName(type: string): string {
    if (type === 'session') return ''
    return this.store.kinds.find((k) => k.type === type)?.label ?? type
  }

  /** What a record says, in words: each field shown (named with its kind, for a kind other than sessions), then who it is about and the group that held it. */
  private describe(s: Entity): RecordText[] {
    const store = this.store
    const names = new Map(store.subjects.map((p) => [p.id, text(p, 'name')]))
    const kind = this.kindName(s.type)
    const texts = store
      .fieldsOf(s.type)
      .filter((f) => !f.hidden)
      .map((f) => ({ label: kind ? `${kind} · ${f.label}` : f.label, text: valueText(store, f, s.fields[f.name]) }))
    texts.push({ label: strings.searchPeople, text: s.people.map((id) => names.get(id) ?? '').join(', ') })
    const group = s.group ? store.groups.find((g) => g.id === s.group) : undefined
    if (group) texts.push({ label: strings.searchGroup, text: text(group, 'name') })
    return texts
  }

  private open(s: Entity) {
    this.dispatchEvent(openSessionEvent(s))
  }

  protected screen() {
    const store = this.store
    const date = store.sessionFields.find((f) => f.kind === 'date')
    const names = new Map(store.subjects.map((p) => [p.id, text(p, 'name')]))
    const asked = searchWords(this.query).length > 0
    const records = store.kinds.length > 0 ? store.kinds.flatMap((k) => store.recordsOf(k.type)) : store.sessions
    const hits = asked ? searchRecords(newestFirst(records, store.dayOf), this.query, (s) => this.describe(s)) : []
    const dateOf = (s: Entity) => {
      const field = store.fieldsOf(s.type).find((f) => f.name === store.datedOf(s.type))
      return field ? valueText(store, field, s.fields[field.name]) : ''
    }
    return html`<dp-page-header heading=${strings.searchTitle}></dp-page-header>
      <dc-card>
        <div class="stack">
          <dc-field label=${strings.searchLabel}>
            <dc-input
              aria-label=${strings.searchLabel}
              type="search"
              .value=${this.query}
              @input=${(e: Event) => (this.query = (e.target as HTMLInputElement).value)}
            ></dc-input>
          </dc-field>
          <p class="muted">${strings.searchLead}</p>
        </div>
      </dc-card>
      ${asked
        ? hits.length === 0
          ? html`<p class="muted" data-role="search-none">${strings.searchNone}</p>`
          : html`<p data-role="search-count">${strings.searchCount(hits.length, Math.min(hits.length, SHOWN))}</p>
              <table data-role="search-results">
                <thead>
                  <tr>
                    <th>${date?.label ?? ''}</th>
                    <th>${strings.searchPeople}</th>
                    <th>${strings.searchWhere}</th>
                    <th>${strings.searchFound}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  ${hits.slice(0, SHOWN).map(
                    (h) => html`<tr data-hit=${h.record.id}>
                      <td>${dateOf(h.record) || nothing}</td>
                      <td class="wrap">${h.record.people.map((id) => names.get(id) ?? '').join(', ')}</td>
                      <td>${h.label}</td>
                      <td class="wrap">${h.snippet}</td>
                      <td><dc-button size="sm" variant="ghost" data-role="open-hit" @click=${() => this.open(h.record)}>${strings.searchOpen}</dc-button></td>
                    </tr>`,
                  )}
                </tbody>
              </table>`
        : nothing}`
  }
}
