import { LitElement, css, html, nothing } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import type { DpSidebarSelectEvent } from '@iyulab/desktop-patterns/sidebar'
import { describeError } from './errors.js'
import { choices, labelOf, latest, newestFirst, text, today, type Entity, type Scheme } from './records.js'
import { lastMonth, layOut, type Group, type RunRecord } from './report.js'
import { shell, type VaultSummary } from './shell.js'
import { strings } from './strings.js'

type View = 'subjects' | 'report' | 'practitioners'
type Problem = keyof typeof strings.problems

/** An open vault: its subjects and their sessions, and the practitioners sessions are kept by. */
@customElement('oc-vault')
export class OcVault extends LitElement {
  static styles = css`
    :host {
      display: block;
      height: 100%;
    }
    dp-shell {
      height: 100%;
    }
    .columns {
      display: grid;
      grid-template-columns: minmax(200px, 280px) 1fr;
      gap: var(--dc-space-5, 24px);
      align-items: start;
    }
    section {
      display: flex;
      flex-direction: column;
      gap: var(--dc-space-3, 12px);
      min-width: 0;
    }
    h2,
    h3 {
      margin: 0;
      font-weight: 600;
    }
    h2 {
      font-size: 16px;
    }
    h3 {
      font-size: 14px;
    }
    p {
      margin: 0;
    }
    .muted {
      color: var(--dc-color-text-secondary, #5e5c57);
    }
    .row {
      display: flex;
      gap: var(--dc-space-2, 8px);
      align-items: end;
      flex-wrap: wrap;
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    li button {
      all: unset;
      box-sizing: border-box;
      width: 100%;
      padding: var(--dc-space-2, 8px) var(--dc-space-3, 12px);
      border-radius: var(--dc-radius-md, 6px);
      cursor: pointer;
    }
    li button:hover {
      background: var(--dc-color-surface-hover, #eee);
    }
    li button:focus-visible {
      outline: 2px solid var(--dc-color-accent, #4a5bd4);
    }
    li button[aria-current='true'] {
      background: var(--dc-color-surface, #f2f2f2);
      font-weight: 600;
    }
    .plain li {
      padding: var(--dc-space-2, 8px) var(--dc-space-3, 12px);
    }
    table {
      border-collapse: collapse;
      width: 100%;
      font-size: 13px;
    }
    th,
    td {
      text-align: left;
      padding: var(--dc-space-2, 8px);
      border-bottom: 1px solid var(--dc-color-border, #e2e2e4);
    }
    th {
      font-weight: 600;
      color: var(--dc-color-text-secondary, #5e5c57);
    }
    label {
      display: flex;
      flex-direction: column;
      gap: var(--dc-space-1, 4px);
      font-size: 13px;
      flex: 1 1 160px;
    }
    /* TODO(upstream: claudedocs/issues/awaiting-release/ISSUE-desktop-compact-20260928-date-input-type.md)
       A native date input until dc-input with type="date" is published; styled to match it. */
    input[type='date'] {
      box-sizing: border-box;
      width: 100%;
      padding: var(--dc-space-2, 8px) var(--dc-space-3, 12px);
      border: 1px solid var(--dc-color-border, #e2e2e4);
      border-radius: var(--dc-radius-md, 6px);
      background: var(--dc-color-bg, #fff);
      color: inherit;
      font: inherit;
    }
    .form {
      display: flex;
      flex-direction: column;
      gap: var(--dc-space-3, 12px);
      padding: var(--dc-space-4, 16px);
      border: 1px solid var(--dc-color-border, #e2e2e4);
      border-radius: var(--dc-radius-md, 6px);
    }
    .error {
      color: var(--dc-color-danger, #b00020);
    }
    .num {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    tbody th {
      font-weight: 400;
      color: inherit;
    }
    tfoot th,
    tfoot td {
      font-weight: 600;
      border-top: 2px solid var(--dc-color-border, #e2e2e4);
    }
    .groups {
      width: auto;
    }
    button.cell {
      all: unset;
      cursor: pointer;
      padding: 0 var(--dc-space-1, 4px);
      border-radius: var(--dc-radius-sm, 4px);
      color: var(--dc-color-accent, #4a5bd4);
      text-decoration: underline;
    }
    button.cell:focus-visible {
      outline: 2px solid var(--dc-color-accent, #4a5bd4);
    }
    .detail {
      font-size: 12px;
    }
  `

  /** The folder the vault is in, shown under the heading. */
  @property() folder = ''


  @state() private view: View = 'subjects'
  @state() private sidebarOpen = true
  @state() private subjects: Entity[] = []
  @state() private sessions: Entity[] = []
  @state() private practitioners: Entity[] = []
  @state() private schemes: Scheme[] = []
  @state() private summary?: VaultSummary
  @state() private reportKey = ''
  @state() private year = lastMonth().year
  @state() private month = lastMonth().month
  /** The report on screen: the run record of the last 산출. */
  @state() private result?: RunRecord
  @state() private evidence?: { title: string; group: Group }
  @state() private selected?: string
  @state() private busy = false
  @state() private error?: { text: string; detail?: string }

  @state() private subjectName = ''
  @state() private practitionerName = ''
  @state() private date = today()
  @state() private topic = ''
  @state() private method = ''
  @state() private practitioner = ''

  connectedCallback() {
    super.connectedCallback()
    void this.run(() => this.load())
  }

  private async load() {
    const [subjects, sessions, practitioners, schemes, summary] = await Promise.all([
      shell.entities('subject'),
      shell.entities('session'),
      shell.entities('practitioner'),
      shell.schemes(),
      shell.summary(),
    ])
    this.summary = summary
    if (!this.reportKey && summary.reports.length > 0) {
      const newest = [...summary.reports].sort((a, b) => b.version - a.version)[0]
      this.reportKey = `${newest.name}@${newest.version}`
    }
    this.subjects = [...subjects].sort((a, b) => text(a, 'name').localeCompare(text(b, 'name'), 'ko'))
    this.sessions = sessions
    this.practitioners = practitioners
    this.schemes = schemes
    if (!this.practitioner && practitioners.length === 1) this.practitioner = practitioners[0].id
  }

  private async run(action: () => Promise<void>) {
    this.busy = true
    this.error = undefined
    try {
      await action()
    } catch (e) {
      this.error = describeError(e)
    } finally {
      this.busy = false
    }
  }

  private problem(p: Problem) {
    this.error = { text: strings.problems[p] as string }
  }

  private async addSubject() {
    const name = this.subjectName.trim()
    if (!name) return this.problem('no-name')
    await this.run(async () => {
      const path = await shell.record('/changes/subject', { fields: { name } })
      this.subjectName = ''
      await this.load()
      this.selected = path.split('/')[1]
    })
  }

  private async addPractitioner() {
    const name = this.practitionerName.trim()
    if (!name) return this.problem('no-name')
    await this.run(async () => {
      await shell.record('/changes/practitioner', { fields: { name } })
      this.practitionerName = ''
      await this.load()
    })
  }

  private async recordSession(subjectId: string) {
    const topics = latest(this.schemes, 'topic')
    const methods = latest(this.schemes, 'method')
    if (!this.date) return this.problem('no-date')
    if (!topics || !this.topic) return this.problem('no-topic')
    if (!this.practitioner) return this.problem('no-practitioner')
    const fields: Record<string, unknown> = {
      date: this.date,
      practitioner: this.practitioner,
      topic: { scheme: 'topic', version: topics.version, code: this.topic },
    }
    if (methods && this.method) fields.method = { scheme: 'method', version: methods.version, code: this.method }
    await this.run(async () => {
      await shell.record('/changes/in-subject', { subjectId, type: 'session', fields })
      this.topic = ''
      this.method = ''
      await this.load()
    })
  }

  private close() {
    this.dispatchEvent(new Event('oc-close', { bubbles: true, composed: true }))
  }

  render() {
    const heading = { subjects: strings.subjects, report: strings.report, practitioners: strings.practitioners }[this.view]
    const unreadable = this.summary?.unreadable.length ?? 0
    return html`
      <dp-shell ?sidebar-open=${this.sidebarOpen}>
        <dp-sidebar
          slot="sidebar"
          header=${this.folder.split(/[\\/]/).filter(Boolean).at(-1) ?? strings.appName}
          nav-label=${strings.navLabel}
          active-id=${this.view}
          .items=${[
            { id: 'subjects', icon: '◉', label: strings.navSubjects },
            { id: 'report', icon: '▦', label: strings.navReport },
            { id: 'practitioners', icon: '◎', label: strings.navPractitioners },
          ]}
          @dp-sidebar-select=${(e: DpSidebarSelectEvent) => {
            this.view = e.itemId as View
            this.error = undefined
          }}
        ></dp-sidebar>
        <dp-toolbar
          slot="toolbar"
          heading=${heading}
          show-toggle
          toggle-label=${strings.toggleSidebar}
          @dp-toolbar-toggle=${() => (this.sidebarOpen = !this.sidebarOpen)}
        >
          <dc-button slot="actions" variant="secondary" size="sm" @click=${this.close}>${strings.closeVault}</dc-button>
        </dp-toolbar>
        <dp-page>
          ${unreadable > 0 ? html`<p class="error">${strings.unreadable(unreadable)}</p>` : nothing} ${this.errorLine()}
          ${this.view === 'subjects' ? this.subjectsView() : this.view === 'report' ? this.reportView() : this.practitionersView()}
        </dp-page>
      </dp-shell>
    `
  }

  private errorLine() {
    if (!this.error) return nothing
    return html`<div class="error" role="alert">
      <p>${this.error.text}</p>
      ${this.error.detail ? html`<p class="detail muted">${strings.errorDetail(this.error.detail)}</p>` : nothing}
    </div>`
  }

  private nameField(label: string, value: string, set: (v: string) => void, submit: () => void) {
    return html`<label>
      ${label}
      <dc-input
        aria-label=${label}
        .value=${value}
        ?disabled=${this.busy}
        @input=${(e: Event) => set((e.target as HTMLInputElement).value)}
        @keydown=${(e: KeyboardEvent) => e.key === 'Enter' && !this.busy && submit()}
      ></dc-input>
    </label>`
  }

  private subjectsView() {
    const subject = this.subjects.find((s) => s.id === this.selected)
    const addSubject = () => void this.addSubject()
    return html`<div class="columns">
      <section>
        <div class="row">
          ${this.nameField(strings.subjectName, this.subjectName, (v) => (this.subjectName = v), addSubject)}
          <dc-button variant="secondary" ?disabled=${this.busy} @click=${addSubject}>${strings.addSubject}</dc-button>
        </div>
        ${this.subjects.length === 0
          ? html`<p class="muted">${strings.noSubjects}</p>`
          : html`<ul aria-label=${strings.subjects}>
              ${this.subjects.map(
                (s) => html`<li>
                  <button aria-current=${s.id === this.selected ? 'true' : 'false'} @click=${() => (this.selected = s.id)}>
                    ${text(s, 'name')}
                  </button>
                </li>`,
              )}
            </ul>`}
      </section>
      <section>${subject ? this.subjectDetail(subject) : html`<p class="muted">${strings.pickSubject}</p>`}</section>
    </div>`
  }

  private subjectDetail(subject: Entity) {
    const sessions = newestFirst(this.sessions.filter((s) => s.subject === subject.id))
    const names = new Map(this.practitioners.map((p) => [p.id, text(p, 'name')]))
    return html`
      <h2>${strings.sessions(text(subject, 'name'))}</h2>
      ${this.sessionForm(subject.id)}
      ${sessions.length === 0
        ? html`<p class="muted">${strings.noSessions}</p>`
        : html`<p class="muted">${strings.sessionCount(sessions.length)}</p>
            <table>
              <thead>
                <tr>
                  <th>${strings.sessionDate}</th>
                  <th>${strings.sessionTopic}</th>
                  <th>${strings.sessionMethod}</th>
                  <th>${strings.sessionPractitioner}</th>
                </tr>
              </thead>
              <tbody>
                ${sessions.map(
                  (s) => html`<tr data-session=${s.id}>
                    <td>${text(s, 'date')}</td>
                    <td>${labelOf(this.schemes, s.fields.topic)}</td>
                    <td>${labelOf(this.schemes, s.fields.method)}</td>
                    <td>${names.get(text(s, 'practitioner')) ?? ''}</td>
                  </tr>`,
                )}
              </tbody>
            </table>`}
    `
  }

  private sessionForm(subjectId: string) {
    const topics = latest(this.schemes, 'topic')
    const methods = latest(this.schemes, 'method')
    if (this.practitioners.length === 0) {
      return html`<p class="muted">${strings.needPractitioner}</p>`
    }
    return html`<div class="form">
      <h3>${strings.newSession}</h3>
      <div class="row">
        <label>
          ${strings.sessionDate}
          <input
            type="date"
            aria-label=${strings.sessionDate}
            .value=${this.date}
            ?disabled=${this.busy}
            @input=${(e: Event) => (this.date = (e.target as HTMLInputElement).value)}
          />
        </label>
        <label>
          ${strings.sessionPractitioner}
          <dc-select
            aria-label=${strings.sessionPractitioner}
            .options=${this.practitioners.map((p) => ({ value: p.id, label: text(p, 'name') }))}
            .value=${this.practitioner}
            placeholder=${strings.sessionPractitioner}
            ?disabled=${this.busy}
            @change=${(e: Event) => (this.practitioner = (e.target as HTMLSelectElement).value)}
          ></dc-select>
        </label>
      </div>
      <div class="row">
        <label>
          ${strings.sessionTopic}
          <dc-select
            aria-label=${strings.sessionTopic}
            .options=${topics ? choices(topics) : []}
            .value=${this.topic}
            placeholder=${strings.sessionTopic}
            ?disabled=${this.busy}
            @change=${(e: Event) => (this.topic = (e.target as HTMLSelectElement).value)}
          ></dc-select>
        </label>
        <label>
          ${strings.sessionMethod}
          <dc-select
            aria-label=${strings.sessionMethod}
            .options=${[{ value: '', label: strings.noMethod }, ...(methods ? choices(methods) : [])]}
            .value=${this.method}
            ?disabled=${this.busy}
            @change=${(e: Event) => (this.method = (e.target as HTMLSelectElement).value)}
          ></dc-select>
        </label>
      </div>
      <div class="row">
        <dc-button variant="primary" ?disabled=${this.busy} @click=${() => void this.recordSession(subjectId)}>${strings.recordSession}</dc-button>
      </div>
    </div>`
  }

  private async runReport() {
    const [name, version] = this.reportKey.split('@')
    await this.run(async () => {
      this.result = await shell.runReport(name, Number(version), this.year, this.month)
      this.evidence = undefined
      await this.load()
    })
  }

  private reportView() {
    const reports = this.summary?.reports ?? []
    if (reports.length === 0) return html`<p class="muted">${strings.noReports}</p>`
    return html`<section>
      <div class="row">
        <label>
          ${strings.reportForm}
          <dc-select
            aria-label=${strings.reportForm}
            .options=${reports.map((r) => ({ value: `${r.name}@${r.version}`, label: strings.reportFormOption(r.label, r.version) }))}
            .value=${this.reportKey}
            ?disabled=${this.busy}
            @change=${(e: Event) => (this.reportKey = (e.target as HTMLSelectElement).value)}
          ></dc-select>
        </label>
        <label>
          ${strings.year}
          <dc-input
            type="number"
            aria-label=${strings.year}
            min="2000"
            max="2100"
            .value=${String(this.year)}
            ?disabled=${this.busy}
            @input=${(e: Event) => (this.year = Number((e.target as HTMLInputElement).value))}
          ></dc-input>
        </label>
        <label>
          ${strings.month}
          <dc-select
            aria-label=${strings.month}
            .options=${Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: strings.monthOption(i + 1) }))}
            .value=${String(this.month)}
            ?disabled=${this.busy}
            @change=${(e: Event) => (this.month = Number((e.target as HTMLSelectElement).value))}
          ></dc-select>
        </label>
        <dc-button variant="primary" ?disabled=${this.busy} @click=${() => void this.runReport()}>${strings.runReport}</dc-button>
      </div>
      ${this.result ? this.reportTable(this.result) : nothing}
    </section>`
  }

  /** Shows what a count is made of, and brings the list into view: it sits below the table. */
  private async showEvidence(title: string, group: Group) {
    this.evidence = { title, group }
    await this.updateComplete
    this.renderRoot.querySelector('[data-role=evidence]')?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  private reportTable(result: RunRecord) {
    const table = layOut(result, this.schemes, this.practitioners, strings.noPractitioner)
    const count = (title: string, group: Group) =>
      group.count === 0
        ? html`<td class="num">0</td>`
        : html`<td class="num"><button class="cell" @click=${() => void this.showEvidence(title, group)}>${group.count}</button></td>`
    return html`
      <p class="muted" data-role="period">${strings.reportPeriod(result.period.from, result.period.to)}</p>
      <table class="report">
        <thead>
          <tr>
            <th>${strings.reportRow}</th>
            ${table.columns.map((c) => html`<th class="num">${c.label}</th>`)}
            <th class="num">${strings.reportTotal}</th>
          </tr>
        </thead>
        <tbody>
          ${table.rows.map(
            (r) => html`<tr data-row=${r.code}>
              <th>${r.label}</th>
              ${r.cells.map((cell, i) => count(`${r.label} · ${table.columns[i].label}`, cell))}
              <td class="num">${r.total}</td>
            </tr>`,
          )}
        </tbody>
        <tfoot>
          <tr>
            <th>${strings.reportTotal}</th>
            ${table.columnTotals.map((n) => html`<td class="num">${n}</td>`)}
            <td class="num" data-role="placed">${table.placed}</td>
          </tr>
        </tfoot>
      </table>
      <table class="groups">
        <tbody>
          <tr data-group="pending">
            <th>${strings.pending}</th>
            ${count(strings.pending, table.pending)}
            <td class="muted">${strings.pendingHint}</td>
          </tr>
          <tr data-group="unmapped">
            <th>${strings.unmapped}</th>
            ${count(strings.unmapped, table.unmapped)}
            <td class="muted">${strings.unmappedHint}</td>
          </tr>
          <tr data-group="total">
            <th>${strings.grandTotal}</th>
            ${count(strings.grandTotal, table.total)}
            <td></td>
          </tr>
        </tbody>
      </table>
      ${this.evidence ? this.evidenceList(this.evidence.title, this.evidence.group) : html`<p class="muted">${strings.pickCell}</p>`}
    `
  }

  private evidenceList(title: string, group: Group) {
    const byId = new Map(this.sessions.map((s) => [s.id, s]))
    const subjectNames = new Map(this.subjects.map((s) => [s.id, text(s, 'name')]))
    const rows = newestFirst(group.records.map((id) => byId.get(id)).filter((s): s is Entity => !!s))
    return html`<section data-role="evidence">
      <h3>${strings.evidence(title, group.count)}</h3>
      <table>
        <thead>
          <tr>
            <th>${strings.sessionDate}</th>
            <th>${strings.evidenceSubject}</th>
            <th>${strings.sessionTopic}</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(
            (s) => html`<tr data-evidence=${s.id}>
              <td>${text(s, 'date')}</td>
              <td>${subjectNames.get(s.subject ?? '') ?? ''}</td>
              <td>${labelOf(this.schemes, s.fields.topic)}</td>
            </tr>`,
          )}
        </tbody>
      </table>
    </section>`
  }

  private practitionersView() {
    const add = () => void this.addPractitioner()
    return html`<section>
      <div class="row">
        ${this.nameField(strings.practitionerName, this.practitionerName, (v) => (this.practitionerName = v), add)}
        <dc-button variant="secondary" ?disabled=${this.busy} @click=${add}>${strings.addPractitioner}</dc-button>
      </div>
      ${this.practitioners.length === 0
        ? html`<p class="muted">${strings.noPractitioners}</p>`
        : html`<ul class="plain" aria-label=${strings.practitioners}>
            ${this.practitioners.map((p) => html`<li>${text(p, 'name')}</li>`)}
          </ul>`}
    </section>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'oc-vault': OcVault
  }
}
