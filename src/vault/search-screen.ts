import { html, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { newestFirst, text, type Entity } from '../records.js'
import { searchSessions, searchWords, type SessionText } from '../search.js'
import { strings } from '../strings.js'
import { VaultScreen } from './screen.js'
import { valueText } from './session-parts.js'

/** How many sessions found are listed; a narrower query lists the rest. */
const SHOWN = 200

/** Where a session found opens: the subject or the group whose record holds it. */
export interface OpenSession {
  holder: 'subject' | 'group'
  id: string
  session: string
}

/** Finding sessions by what they say, newest first; each one found opens where it is kept. */
@customElement('oc-search')
export class OcSearch extends VaultScreen {
  @state() private query = ''

  /** What a session says, in words: each field shown, then who it is about and the group that held it. */
  private describe(s: Entity): SessionText[] {
    const store = this.store
    const names = new Map(store.subjects.map((p) => [p.id, text(p, 'name')]))
    const texts = store.sessionFields.filter((f) => !f.hidden).map((f) => ({ label: f.label, text: valueText(store, f, s.fields[f.name]) }))
    texts.push({ label: strings.searchPeople, text: s.people.map((id) => names.get(id) ?? '').join(', ') })
    const group = s.group ? store.groups.find((g) => g.id === s.group) : undefined
    if (group) texts.push({ label: strings.searchGroup, text: text(group, 'name') })
    return texts
  }

  private open(s: Entity) {
    const detail: OpenSession = s.group ? { holder: 'group', id: s.group, session: s.id } : { holder: 'subject', id: s.subject ?? s.people[0], session: s.id }
    this.dispatchEvent(new CustomEvent<OpenSession>('oc-open-session', { detail, bubbles: true, composed: true }))
  }

  protected screen() {
    const store = this.store
    const date = store.sessionFields.find((f) => f.kind === 'date')
    const names = new Map(store.subjects.map((p) => [p.id, text(p, 'name')]))
    const asked = searchWords(this.query).length > 0
    const hits = asked ? searchSessions(newestFirst(store.sessions), this.query, (s) => this.describe(s)) : []
    return html`<dp-page-header eyebrow=${strings.navGroupRecords} heading=${strings.searchTitle}></dp-page-header>
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
                    (h) => html`<tr data-hit=${h.session.id}>
                      <td>${date ? valueText(store, date, h.session.fields[date.name]) : nothing}</td>
                      <td class="wrap">${h.session.people.map((id) => names.get(id) ?? '').join(', ')}</td>
                      <td>${h.label}</td>
                      <td class="wrap">${h.snippet}</td>
                      <td><dc-button size="sm" variant="ghost" data-role="open-hit" @click=${() => this.open(h.session)}>${strings.searchOpen}</dc-button></td>
                    </tr>`,
                  )}
                </tbody>
              </table>`
        : nothing}`
  }
}
