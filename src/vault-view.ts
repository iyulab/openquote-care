import { LitElement, css, html, nothing } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import type { DpSidebarSelectEvent } from '@iyulab/desktop-patterns/sidebar'
import { open } from '@tauri-apps/plugin-dialog'
import { describeError } from './errors.js'
import { Latest } from './latest.js'
import { choices, classifiedField, conflictsOf, definitionOf, labelOf, latest, namesOf, newestFirst, text, today, type Classified, type Entity, type Scheme } from './records.js'
import { toTsv, type ExportTable } from './export.js'
import { IDLE_CHOICES, idleMinutes, setIdleMinutes } from './idle.js'
import { atSession, headingOf } from './subject-fields.js'
import { planImport, tally, type ImportPlan, type PlannedRow } from './subject-import.js'
import { comparable, headCount, lastMonth, layOut, placesOf, rowSchemeOf, type Comparison, type Group, type KeptRun, type Place, type RunRecord } from './report.js'
import { shell, type VaultSummary } from './shell.js'
import { strings } from './strings.js'

type View = 'subjects' | 'groups' | 'report' | 'export' | 'practitioners' | 'devices'
/** Where a new session is kept: a subject's folder, or a group's (with its attendees). */
type Holder = { kind: 'subject'; id: string } | { kind: 'group'; id: string }
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
    .scroll {
      overflow-x: auto;
    }
    table.export td,
    table.export th {
      white-space: nowrap;
    }
    fieldset.picker {
      border: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-wrap: wrap;
      gap: var(--dc-space-2, 8px) var(--dc-space-4, 16px);
    }
    fieldset.picker legend {
      padding: 0;
      margin-bottom: var(--dc-space-1, 4px);
      font-size: 13px;
    }
    label.pick {
      display: inline-flex;
      flex-direction: row;
      flex: none;
      align-items: center;
      gap: var(--dc-space-1, 4px);
    }
    label.pick input {
      accent-color: var(--dc-color-accent, #1a73e8);
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
    .people {
      color: var(--dc-color-text-muted, #666);
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
    button.conflict {
      margin-left: var(--dc-space-2, 8px);
      color: var(--dc-color-danger, #b00020);
      font-size: 12px;
    }
    button.cell:focus-visible {
      outline: 2px solid var(--dc-color-accent, #4a5bd4);
    }
    .detail {
      font-size: 12px;
    }
    dl.legend {
      display: grid;
      gap: 2px;
      margin: 0 0 8px;
      font-size: 12px;
    }
    dl.legend div {
      display: flex;
      gap: 8px;
    }
    dl.legend dt {
      font-weight: 600;
      min-width: 5em;
    }
    dl.legend dd {
      margin: 0;
      color: var(--dc-color-text-secondary, #5e5c57);
    }
  `

  /** The folder the vault is in, shown under the heading. */
  @property() folder = ''


  @state() private view: View = 'subjects'
  @state() private sidebarOpen = true
  @state() private subjects: Entity[] = []
  @state() private sessions: Entity[] = []
  @state() private groups: Entity[] = []
  @state() private selectedGroup?: string
  @state() private groupName = ''
  /** The selected group's members as being edited; undefined while unchanged. */
  @state() private memberDraft?: string[]
  /** Who took part in the group session being recorded; undefined means the group's members. */
  @state() private attendeeDraft?: string[]
  @state() private practitioners: Entity[] = []
  @state() private schemes: Scheme[] = []
  @state() private summary?: VaultSummary
  @state() private reportKey = ''
  @state() private year = lastMonth().year
  @state() private month = lastMonth().month
  /** The report on screen: the run record of the last 산출. */
  @state() private result?: RunRecord
  @state() private exportKey = ''
  @state() private exportTable?: ExportTable
  @state() private evidence?: { title: string; group: Group }
  @state() private notice = ''
  /** The session whose concurrent changes are open for a person to settle. */
  @state() private settling?: string
  /** Pending records of the report on screen, each with the codes a person chooses from. */
  @state() private pendingChoices?: { session: Entity; field: string; was: unknown; scheme: string; version: number; candidates: string[] }[]
  @state() private reclassified = new Set<string>()
  @state() private keptRuns: KeptRun[] = []
  @state() private compareWith = ''
  @state() private comparison?: Comparison
  @state() private selected?: string
  @state() private busy = false
  @state() private error?: { text: string; detail?: string }

  @state() private subjectName = ''
  @state() private idleChoice = idleMinutes()
  /** Pasted subject rows, planned but not yet written. */
  @state() private importPlan?: ImportPlan
  @state() private practitionerName = ''
  @state() private deviceName = ''
  @state() private date = today()
  @state() private topic = ''
  @state() private method = ''
  @state() private practitioner = ''

  connectedCallback() {
    super.connectedCallback()
    void this.run(() => this.load())
    window.addEventListener('focus', this.onFocus)
    this.unlisten = shell.onVaultChanged(() => this.onOutsideChange())
  }

  disconnectedCallback() {
    window.removeEventListener('focus', this.onFocus)
    void this.unlisten?.then((stop) => stop())
    super.disconnectedCallback()
  }

  private unlisten?: Promise<() => void>
  private outsideChangeWaiting = false

  /**
   * Another device wrote to the vault: take it in without getting in the way — no busy state, no
   * cleared message, and not in the middle of the person's own action (it waits for that to end).
   */
  private async onOutsideChange() {
    if (this.busy) {
      this.outsideChangeWaiting = true
      return
    }
    this.outsideChangeWaiting = false
    try {
      await shell.refresh()
      await this.load()
    } catch {
      // Coming back to the window, or the refresh button, reads the vault again.
    }
  }

  /** Coming back to the window is when another device's records are most likely waiting. */
  private onFocus = () => {
    if (!this.busy) void this.refresh()
  }

  /** Reads the vault folder again: records other devices sharing it wrote come in. */
  async refresh() {
    await this.run(async () => {
      await shell.refresh()
      await this.load()
    })
  }

  private readonly loads = new Latest()

  /** Reads everything the views show. A read overtaken by a newer one is dropped, not applied. */
  private async load() {
    const current = this.loads.begin()
    const [subjects, sessions, groups, practitioners, schemes, summary] = await Promise.all([
      shell.entities('subject'),
      shell.entities('session'),
      shell.entities('group'),
      shell.entities('practitioner'),
      shell.schemes(),
      shell.summary(),
    ])
    if (!current()) return
    // Keep a name the person is typing; follow the saved one otherwise.
    const savedName = this.summary?.devices[this.summary.device] ?? ''
    if (this.deviceName === savedName) this.deviceName = summary.devices[summary.device] ?? ''
    this.summary = summary
    if (!this.exportKey && summary.exports.length > 0) this.exportKey = `${summary.exports[0].name}@${summary.exports[0].version}`
    if (!this.reportKey && summary.reports.length > 0) {
      const newest = [...summary.reports].sort((a, b) => b.version - a.version)[0]
      this.reportKey = `${newest.name}@${newest.version}`
    }
    this.subjects = [...subjects].sort((a, b) => text(a, 'name').localeCompare(text(b, 'name'), 'ko'))
    this.sessions = sessions
    this.groups = [...groups].sort((a, b) => text(a, 'name').localeCompare(text(b, 'name'), 'ko'))
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
      if (this.outsideChangeWaiting) void this.onOutsideChange()
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

  private async importSubjects(plan: ImportPlan) {
    if (!plan.ready) return
    this.notice = ''
    await this.run(async () => {
      for (const row of plan.rows) {
        if (row.kind === 'create') await shell.record('/changes/subject', { fields: row.fields })
        else if (row.kind === 'update') await shell.record('/changes/update', { type: 'subject', id: row.subject, fields: row.fields })
      }
      const counts = tally(plan)
      this.importPlan = undefined
      await this.load()
      this.notice = strings.imported(counts.create, counts.update)
    })
  }

  private importPreview(plan: ImportPlan) {
    const counts = tally(plan)
    const status = (r: PlannedRow) =>
      r.kind === 'problem'
        ? r.problem.kind === 'no-name'
          ? strings.importNoName
          : r.problem.kind === 'repeated'
            ? strings.importRepeated(r.problem.line)
            : strings.importAmbiguous(r.problem.name)
        : { create: strings.importCreate, update: strings.importUpdate, same: strings.importSame }[r.kind]
    const shown = (r: PlannedRow) =>
      r.kind === 'create' || r.kind === 'update'
        ? Object.entries(r.fields).map(([k, v]) => `${headingOf(k)} ${v}`).join(' · ')
        : r.kind === 'same'
          ? text(this.subjects.find((s) => s.id === r.subject) ?? ({ fields: {} } as Entity), 'name')
          : ''
    return html`<div class="form" data-role="import">
      <h3>${strings.importTitle}</h3>
      <p class="muted" data-role="import-tally">${strings.importTally(counts.create, counts.update, counts.same, counts.problem)}</p>
      ${plan.missingName ? html`<p class="error">${strings.importMissingName}</p>` : nothing}
      ${plan.unknownHeadings.length > 0 ? html`<p class="muted">${strings.importUnknown(plan.unknownHeadings)}</p>` : nothing}
      <div class="scroll">
        <table>
          <tbody>
            ${plan.rows.map(
              (r) => html`<tr data-import-row=${r.line} data-kind=${r.kind}>
                <td class="num">${r.line}</td>
                <td class=${r.kind === 'problem' ? 'error' : ''}>${status(r)}</td>
                <td>${shown(r)}</td>
              </tr>`,
            )}
          </tbody>
        </table>
      </div>
      <div class="row">
        <dc-button variant="primary" ?disabled=${this.busy || !plan.ready || counts.create + counts.update === 0} @click=${() => void this.importSubjects(plan)}
          >${strings.importApply(counts.create, counts.update)}</dc-button
        >
        <dc-button variant="secondary" ?disabled=${this.busy} @click=${() => (this.importPlan = undefined)}>${strings.cancel}</dc-button>
      </div>
    </div>`
  }

  private async addGroup() {
    const name = this.groupName.trim()
    if (!name) return this.problem('no-name')
    await this.run(async () => {
      const path = await shell.record('/changes/group', { fields: { name, members: [] } })
      this.groupName = ''
      await this.load()
      this.selectGroup(path.split('/')[1])
    })
  }

  private selectGroup(id: string) {
    this.selectedGroup = id
    this.memberDraft = undefined
    this.attendeeDraft = undefined
  }

  private async saveMembers(group: Entity) {
    const members = this.memberDraft
    if (!members) return
    await this.run(async () => {
      await shell.record('/changes/update', { type: 'group', id: group.id, fields: { members } })
      this.memberDraft = undefined
      await this.load()
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

  private async saveDeviceName() {
    this.notice = ''
    await this.run(async () => {
      await shell.record('/changes/device-name', { name: this.deviceName.trim() })
      await this.load()
      this.notice = strings.deviceNameSaved
    })
  }

  /** How a device reads to a person: its name, and which one is this computer. */
  private deviceLabel(device: string) {
    const name = this.summary?.devices[device]
    if (device === this.summary?.device) return name ? strings.thisDeviceNamed(name) : strings.thisDevice
    return name ?? strings.unnamedDevice(device)
  }

  private async recordSession(holder: Holder) {
    const topics = latest(this.schemes, 'topic')
    const methods = latest(this.schemes, 'method')
    if (!this.date) return this.problem('no-date')
    if (!topics || !this.topic) return this.problem('no-topic')
    if (!this.practitioner) return this.problem('no-practitioner')
    const subject = holder.kind === 'subject' ? this.subjects.find((s) => s.id === holder.id) : undefined
    const fields: Record<string, unknown> = {
      ...(subject ? atSession(subject) : {}),
      date: this.date,
      practitioner: this.practitioner,
      topic: { scheme: 'topic', version: topics.version, code: this.topic },
    }
    if (methods && this.method) fields.method = { scheme: 'method', version: methods.version, code: this.method }
    if (holder.kind === 'group') {
      const attendees = this.attendeesOf(holder.id)
      if (attendees.length === 0) return this.problem('no-attendees')
      fields.attendees = attendees
    }
    await this.run(async () => {
      await (holder.kind === 'subject'
        ? shell.record('/changes/in-subject', { subjectId: holder.id, type: 'session', fields })
        : shell.record('/changes/in-group', { groupId: holder.id, type: 'session', fields }))
      this.topic = ''
      this.method = ''
      this.attendeeDraft = undefined
      await this.load()
    })
  }

  /** A group's members as recorded. */
  private membersOf(groupId: string): string[] {
    const members = this.groups.find((g) => g.id === groupId)?.fields.members
    return Array.isArray(members) ? members.filter((m): m is string => typeof m === 'string') : []
  }

  /** Who the group session being recorded is about: as picked, or else the group's members. */
  private attendeesOf(groupId: string): string[] {
    return this.attendeeDraft ?? this.membersOf(groupId)
  }

  private close() {
    this.dispatchEvent(new Event('oc-close', { bubbles: true, composed: true }))
  }

  private lockNow() {
    this.dispatchEvent(new Event('oc-lock', { bubbles: true, composed: true }))
  }

  private chooseIdle(minutes: number) {
    setIdleMinutes(minutes)
    this.idleChoice = minutes
    this.dispatchEvent(new Event('oc-idle-changed', { bubbles: true, composed: true }))
  }

  render() {
    const heading = { subjects: strings.subjects, groups: strings.groups, report: strings.report, export: strings.exportTitle, practitioners: strings.practitioners, devices: strings.devices }[this.view]
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
            { id: 'groups', icon: '◈', label: strings.navGroups },
            { id: 'report', icon: '▦', label: strings.navReport },
            { id: 'export', icon: '▤', label: strings.navExport },
            { id: 'practitioners', icon: '◎', label: strings.navPractitioners },
            { id: 'devices', icon: '▣', label: strings.navDevices },
          ]}
          @dp-sidebar-select=${(e: DpSidebarSelectEvent) => {
            this.view = e.itemId as View
            this.error = undefined
            this.notice = ''
          }}
        ></dp-sidebar>
        <dp-toolbar
          slot="toolbar"
          heading=${heading}
          show-toggle
          toggle-label=${strings.toggleSidebar}
          @dp-toolbar-toggle=${() => (this.sidebarOpen = !this.sidebarOpen)}
        >
          <dc-button slot="actions" variant="ghost" size="sm" ?disabled=${this.busy} @click=${() => void this.refresh()}>${strings.refresh}</dc-button>
          <dc-button slot="actions" variant="ghost" size="sm" ?disabled=${this.busy} @click=${() => this.lockNow()}>${strings.lockNow}</dc-button>
          <dc-button slot="actions" variant="secondary" size="sm" @click=${this.close}>${strings.closeVault}</dc-button>
        </dp-toolbar>
        <dp-page>
          ${unreadable > 0 ? html`<p class="error">${strings.unreadable(unreadable)}</p>` : nothing} ${this.nameHint()} ${this.errorLine()}
          ${{ subjects: () => this.subjectsView(), groups: () => this.groupsView(), report: () => this.reportView(), export: () => this.exportView(), practitioners: () => this.practitionersView(), devices: () => this.devicesView() }[this.view]()}
        </dp-page>
      </dp-shell>
    `
  }

  /** Other devices already named themselves in this vault, but this one has no name yet. */
  private nameHint() {
    const s = this.summary
    if (!s || this.view === 'devices' || Object.keys(s.devices).length === 0 || s.device in s.devices) return nothing
    return html`<p class="row muted" role="status" data-role="name-hint">
      ${strings.nameThisDevice}
      <dc-button variant="ghost" size="sm" @click=${() => (this.view = 'devices')}>${strings.goNameThisDevice}</dc-button>
    </p>`
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
        <dc-paste-rows-zone
          placeholder=${strings.importPaste}
          @rows=${(e: CustomEvent<{ rows: string[][] }>) => {
            this.notice = ''
            this.importPlan = planImport(e.detail.rows, this.subjects)
          }}
        ></dc-paste-rows-zone>
        ${this.notice && this.view === 'subjects' ? html`<p role="status" class="muted">${this.notice}</p>` : nothing}
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
      <section>
        ${this.importPlan
          ? this.importPreview(this.importPlan)
          : subject
            ? this.subjectDetail(subject)
            : html`<p class="muted">${strings.pickSubject}</p>`}
      </section>
    </div>`
  }

  private subjectDetail(subject: Entity) {
    const sessions = newestFirst(this.sessions.filter((s) => s.people.includes(subject.id)))
    const names = new Map(this.practitioners.map((p) => [p.id, text(p, 'name')]))
    return html`
      <h2>${strings.sessions(text(subject, 'name'))}</h2>
      ${(() => {
        const open = sessions.find((s) => s.id === this.settling && conflictsOf(s).length > 0)
        return open ? this.conflictPanel(open) : nothing
      })()}
      ${this.sessionForm({ kind: 'subject', id: subject.id })}
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
                    <td>
                      ${text(s, 'date')}
                      ${conflictsOf(s).length > 0
                        ? html`<button class="cell conflict" data-role="conflict" @click=${() => (this.settling = s.id)}>${strings.conflict}</button>`
                        : nothing}
                    </td>
                    <td>${labelOf(this.schemes, s.fields.topic)}</td>
                    <td>${labelOf(this.schemes, s.fields.method)}</td>
                    <td>${names.get(text(s, 'practitioner')) ?? ''}</td>
                  </tr>`,
                )}
              </tbody>
            </table>`}
    `
  }

  /** A value in words: a classification by its label, a practitioner by name, anything else as written. */
  private valueText(field: string, value: unknown): string {
    if (field === 'practitioner' && typeof value === 'string') {
      return text(this.practitioners.find((p) => p.id === value) ?? ({ fields: {} } as Entity), 'name') || value
    }
    return labelOf(this.schemes, value) || (typeof value === 'string' ? value : JSON.stringify(value))
  }

  private async settle(session: Entity, field: string, value: unknown) {
    await this.run(async () => {
      await shell.record('/changes/update', { type: session.type, id: session.id, fields: { [field]: value } })
      await this.load()
      if (conflictsOf(this.sessions.find((s) => s.id === session.id) ?? session).length === 0) this.settling = undefined
    })
  }

  private conflictPanel(session: Entity) {
    return html`<div class="form" data-role="settle">
      <h3>${strings.conflictTitle} · ${text(session, 'date')}</h3>
      <p class="muted">${strings.conflictLead}</p>
      ${conflictsOf(session).map(
        ({ field, heads }) => html`<div class="row">
          <span>${strings.conflictField[field] ?? field}</span>
          ${heads.map(
            (h) => html`<dc-button
              size="sm"
              variant="secondary"
              data-device=${h.device}
              ?disabled=${this.busy}
              @click=${() => void this.settle(session, field, h.value)}
              >${this.valueText(field, h.value)} · ${strings.conflictFrom(this.deviceLabel(h.device))}</dc-button
            >`,
          )}
        </div>`,
      )}
    </div>`
  }

  /**
   * A list of subjects to tick. TODO(upstream: a checkbox in @iyulab/desktop-compact) —
   * native checkboxes until the component library offers one.
   */
  private subjectPicker(label: string, current: () => string[], set: (ids: string[]) => void) {
    const picked = current()
    if (this.subjects.length === 0) return html`<p class="muted">${strings.noSubjects}</p>`
    return html`<fieldset class="picker" aria-label=${label}>
      <legend>${label}</legend>
      ${this.subjects.map(
        (s) => html`<label class="pick">
          <input
            type="checkbox"
            data-subject=${s.id}
            .checked=${picked.includes(s.id)}
            ?disabled=${this.busy}
            @change=${(e: Event) => {
              // Read the picks afresh: two ticks can land before the next render.
              const now = current().filter((id) => id !== s.id)
              set((e.target as HTMLInputElement).checked ? [...now, s.id] : now)
            }}
          />
          ${text(s, 'name')}
        </label>`,
      )}
    </fieldset>`
  }

  private groupsView() {
    const group = this.groups.find((g) => g.id === this.selectedGroup)
    const addGroup = () => void this.addGroup()
    return html`<div class="columns">
      <section>
        <div class="row">
          ${this.nameField(strings.groupName, this.groupName, (v) => (this.groupName = v), addGroup)}
          <dc-button variant="secondary" ?disabled=${this.busy} @click=${addGroup}>${strings.addGroup}</dc-button>
        </div>
        ${this.groups.length === 0
          ? html`<p class="muted">${strings.noGroups}</p>`
          : html`<ul aria-label=${strings.groups}>
              ${this.groups.map(
                (g) => html`<li>
                  <button aria-current=${g.id === this.selectedGroup ? 'true' : 'false'} @click=${() => this.selectGroup(g.id)}>
                    ${text(g, 'name')}
                  </button>
                </li>`,
              )}
            </ul>`}
      </section>
      <section>${group ? this.groupDetail(group) : html`<p class="muted">${strings.pickGroup}</p>`}</section>
    </div>`
  }

  private groupDetail(group: Entity) {
    const sessions = newestFirst(this.sessions.filter((s) => s.group === group.id))
    const names = new Map(this.practitioners.map((p) => [p.id, text(p, 'name')]))
    const subjectNames = new Map(this.subjects.map((s) => [s.id, text(s, 'name')]))
    return html`
      <h2>${strings.sessions(text(group, 'name'))}</h2>
      <div class="form" data-role="members">
        ${this.subjectPicker(strings.groupMembers, () => this.memberDraft ?? this.membersOf(group.id), (ids) => (this.memberDraft = ids))}
        <div class="row">
          <dc-button variant="secondary" ?disabled=${this.busy || !this.memberDraft} @click=${() => void this.saveMembers(group)}
            >${strings.saveMembers}</dc-button
          >
        </div>
      </div>
      ${this.sessionForm({ kind: 'group', id: group.id })}
      ${sessions.length === 0
        ? html`<p class="muted">${strings.noSessions}</p>`
        : html`<p class="muted">${strings.sessionCount(sessions.length)}</p>
            <table>
              <thead>
                <tr>
                  <th>${strings.sessionDate}</th>
                  <th>${strings.sessionTopic}</th>
                  <th>${strings.attendees}</th>
                  <th>${strings.sessionPractitioner}</th>
                </tr>
              </thead>
              <tbody>
                ${sessions.map(
                  (s) => html`<tr data-session=${s.id}>
                    <td>${text(s, 'date')}</td>
                    <td>${labelOf(this.schemes, s.fields.topic)}</td>
                    <td>${namesOf(s, subjectNames)}</td>
                    <td>${names.get(text(s, 'practitioner')) ?? ''}</td>
                  </tr>`,
                )}
              </tbody>
            </table>`}
    `
  }

  private sessionForm(holder: Holder) {
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
          <dc-input
            type="date"
            aria-label=${strings.sessionDate}
            .value=${this.date}
            ?disabled=${this.busy}
            @input=${(e: Event) => (this.date = (e.target as HTMLInputElement).value)}
          ></dc-input>
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
      ${holder.kind === 'group'
        ? this.subjectPicker(strings.attendees, () => this.attendeesOf(holder.id), (ids) => (this.attendeeDraft = ids))
        : nothing}
      <div class="row">
        <dc-button variant="primary" ?disabled=${this.busy} @click=${() => void this.recordSession(holder)}>${strings.recordSession}</dc-button>
      </div>
    </div>`
  }

  private async loadRuns() {
    this.keptRuns = await shell.runs()
    const offered = this.result ? comparable(this.keptRuns, this.result) : []
    this.compareWith = offered[0]?.id ?? ''
    this.comparison = undefined
  }

  private async compareRuns() {
    if (!this.result || !this.compareWith) return
    const later = this.result.id
    await this.run(async () => {
      this.comparison = await shell.compareRuns(this.compareWith, later)
      this.evidence = undefined
      this.pendingChoices = undefined
    })
    await this.updateComplete
    this.renderRoot.querySelector('[data-role=comparison]')?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  /** A place in words: a row (in the version that run counted in) and a column, or a group. */
  private placeText(run: RunRecord, place: Place | undefined): string {
    if (!place) return strings.nowhere
    if (place.kind === 'pending') return strings.pending
    if (place.kind === 'unmapped') return strings.unmapped
    const { scheme, version } = rowSchemeOf(run)
    const row = labelOf(this.schemes, { scheme, version, code: place.row })
    const names = new Map(this.practitioners.map((p) => [p.id, text(p, 'name')]))
    const column = place.column === null ? strings.noPractitioner : (names.get(place.column) ?? place.column)
    return `${row} · ${column}`
  }

  private compareControls(result: RunRecord) {
    const offered = comparable(this.keptRuns, result)
    if (offered.length === 0) return html`<p class="muted">${strings.noEarlierRun}</p>`
    return html`<div class="row">
      <label>
        ${strings.compareWith}
        <dc-select
          aria-label=${strings.compareWith}
          .options=${offered.map((k) => ({ value: k.id, label: strings.runOption(k.at, k.report.version, k.total) }))}
          .value=${this.compareWith}
          ?disabled=${this.busy}
          @change=${(e: Event) => (this.compareWith = (e.target as HTMLSelectElement).value)}
        ></dc-select>
      </label>
      <dc-button variant="secondary" ?disabled=${this.busy} @click=${() => void this.compareRuns()}>${strings.compare}</dc-button>
    </div>`
  }

  private comparisonView(c: Comparison) {
    const before = placesOf(c.earlier)
    const after = placesOf(c.later)
    const byId = new Map(this.sessions.map((s) => [s.id, s]))
    const subjectNames = new Map(this.subjects.map((s) => [s.id, text(s, 'name')]))
    const changed = [
      ...c.late.map((id) => ({ id, kind: 'late' as const })),
      ...c.removed.map((id) => ({ id, kind: 'removed' as const })),
      ...c.revised.map((id) => ({ id, kind: 'revised' as const })),
      ...c.moved.map((id) => ({ id, kind: 'moved' as const })),
    ]
    const kinds = ['late', 'removed', 'revised', 'moved'] as const
    const date = (id: string) => (byId.get(id) ? text(byId.get(id)!, 'date') : '')
    changed.sort((a, b) => date(b.id).localeCompare(date(a.id)) || a.id.localeCompare(b.id))
    return html`<section data-role="comparison">
      <h3>${strings.comparisonTitle(c.earlier.report.version, c.later.report.version)}</h3>
      <p data-role="comparison-counts">${strings.comparisonCounts(c.late.length, c.removed.length, c.revised.length, c.moved.length, c.unchanged.length)}</p>
      ${changed.length === 0
        ? html`<p class="muted">${strings.noDifference}</p>`
        : html`<dl class="legend" data-role="comparison-legend">
              ${kinds
                .filter((k) => changed.some((ch) => ch.kind === k))
                .map((k) => html`<div><dt>${strings.changeKind[k]}</dt><dd>${strings.changeKindHint[k]}</dd></div>`)}
            </dl>
            <table>
              <thead>
                <tr>
                  <th>${strings.sessionDate}</th>
                  <th>${strings.evidenceSubject}</th>
                  <th>${strings.changeKindHeader}</th>
                  <th>${strings.before}</th>
                  <th>${strings.after}</th>
                </tr>
              </thead>
              <tbody>
                ${changed.map(({ id, kind }) => {
                  const session = byId.get(id)
                  return html`<tr data-change=${kind} data-id=${id}>
                    <td>${date(id)}</td>
                    <td>${session ? namesOf(session, subjectNames) : ''}</td>
                    <td>${strings.changeKind[kind]}</td>
                    <td>${this.placeText(c.earlier, before.get(id))}</td>
                    <td>${this.placeText(c.later, after.get(id))}</td>
                  </tr>`
                })}
              </tbody>
            </table>`}
    </section>`
  }

  private async pickPack() {
    const folder = await open({ directory: true, title: strings.applyPackTitle })
    if (typeof folder === 'string') await this.applyPack(folder)
  }

  /** Applies the data pack in `folder` (what the folder picker answers). */
  async applyPack(folder: string) {
    this.notice = ''
    await this.run(async () => {
      const added = await shell.applyPack(folder)
      await this.load()
      if (added.length === 0) {
        this.notice = strings.packNothingNew
        return
      }
      const names = added.map((p) => {
        const d = definitionOf(p)
        if (!d) return p
        if (d.kind === 'crosswalk') return strings.definition.crosswalk(d.name, d.from, d.to)
        return strings.definition[d.kind](d.name, d.version)
      })
      this.notice = strings.packAdded(names)
      // A new form version is what the person came for: offer it.
      const report = added.map(definitionOf).find((d) => d?.kind === 'report')
      if (report?.kind === 'report') this.reportKey = `${report.name}@${report.version}`
    })
  }

  private async runReport() {
    const [name, version] = this.reportKey.split('@')
    await this.run(async () => {
      this.result = await shell.runReport(name, Number(version), this.year, this.month)
      this.evidence = undefined
      this.pendingChoices = undefined
      this.reclassified = new Set()
      this.notice = ''
      await this.load()
      await this.loadRuns()
    })
  }

  private async runExport() {
    const [name, version] = this.exportKey.split('@')
    if (!name) return
    this.notice = ''
    await this.run(async () => {
      this.exportTable = await shell.runExport(name, Number(version), this.year, this.month)
    })
  }

  private async copyExport(table: ExportTable) {
    this.notice = ''
    await this.run(async () => {
      await navigator.clipboard.writeText(toTsv(table))
      this.notice = strings.exportCopied(table.rows.length)
    })
  }

  private exportView() {
    const forms = this.summary?.exports ?? []
    if (forms.length === 0)
      return html`<p class="muted">${strings.noExports}</p>
        <dc-button variant="secondary" ?disabled=${this.busy} @click=${() => void this.pickPack()}>${strings.applyPack}</dc-button>
        ${this.notice ? html`<p role="status" class="muted">${this.notice}</p>` : nothing}`
    const table = this.exportTable
    return html`<section>
      <p class="muted">${strings.exportLead}</p>
      <div class="row">
        <label>
          ${strings.exportForm}
          <dc-select
            aria-label=${strings.exportForm}
            .options=${forms.map((f) => ({ value: `${f.name}@${f.version}`, label: strings.reportFormOption(f.label, f.version) }))}
            .value=${this.exportKey}
            ?disabled=${this.busy}
            @change=${(e: Event) => (this.exportKey = (e.target as HTMLSelectElement).value)}
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
        <dc-button variant="primary" ?disabled=${this.busy} @click=${() => void this.runExport()}>${strings.makeExport}</dc-button>
        ${table && table.rows.length > 0
          ? html`<dc-button variant="secondary" ?disabled=${this.busy} @click=${() => void this.copyExport(table)}>${strings.copyExport}</dc-button>`
          : nothing}
      </div>
      ${this.notice ? html`<p role="status" class="muted">${this.notice}</p>` : nothing}
      ${table ? this.exportTableView(table) : nothing}
    </section>`
  }

  private exportTableView(table: ExportTable) {
    const gaps = table.pending.length + table.unmapped.length
    return html`
      <p class="muted" data-role="export-period">${strings.exportPeriod(table.from, table.to, table.rows.length)}</p>
      ${gaps > 0 ? html`<p class="error" data-role="export-gaps">${strings.exportGaps(table.pending.length, table.unmapped.length)}</p>` : nothing}
      ${table.rows.length === 0
        ? html`<p class="muted">${strings.exportEmpty}</p>`
        : html`<div class="scroll">
            <table class="export">
              <thead>
                <tr>
                  ${table.columns.map((c) => html`<th>${c}</th>`)}
                </tr>
              </thead>
              <tbody>
                ${table.rows.map((r) => html`<tr data-export-row=${r.record}>${r.cells.map((c) => html`<td>${c}</td>`)}</tr>`)}
              </tbody>
            </table>
          </div>`}
    `
  }

  private reportView() {
    const reports = this.summary?.reports ?? []
    if (reports.length === 0)
      return html`<p class="muted">${strings.noReports}</p>
        <dc-button variant="secondary" ?disabled=${this.busy} @click=${() => void this.pickPack()}>${strings.applyPack}</dc-button>
        ${this.notice ? html`<p role="status" class="muted">${this.notice}</p>` : nothing}`
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
        <dc-button variant="secondary" ?disabled=${this.busy} @click=${() => void this.pickPack()}>${strings.applyPack}</dc-button>
      </div>
      ${this.notice ? html`<p role="status" class="muted">${this.notice}</p>` : nothing}
      ${this.result ? this.reportTable(this.result) : nothing}
    </section>`
  }

  /** Lists the report's pending records with the codes each may take, for a person to choose. */
  private async showPending(result: RunRecord) {
    const [scheme, { version }] = Object.entries(result.schemes)[0]
    const byId = new Map(this.sessions.map((s) => [s.id, s]))
    const rows = result.pending.records
      .map((id) => byId.get(id))
      .filter((s): s is Entity => !!s)
      .map((session) => ({ session, found: classifiedField(session, scheme) }))
      .filter((r): r is { session: Entity; found: [string, Classified] } => !!r.found)
    await this.run(async () => {
      const resolved = await shell.resolve(version, rows.map((r) => r.found[1]))
      this.evidence = undefined
      this.comparison = undefined
      this.pendingChoices = rows.map((r, i) => ({
        session: r.session,
        field: r.found[0],
        was: r.found[1],
        scheme,
        version,
        candidates: resolved[i].candidates,
      }))
    })
    await this.updateComplete
    this.renderRoot.querySelector('[data-role=pending]')?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  private async reclassify(choice: NonNullable<OcVault['pendingChoices']>[number], code: string) {
    await this.run(async () => {
      await shell.record('/changes/reclassify', {
        type: choice.session.type,
        id: choice.session.id,
        field: choice.field,
        value: { scheme: choice.scheme, version: choice.version, code },
      })
      this.reclassified = new Set([...this.reclassified, choice.session.id])
      this.notice = strings.reclassifiedNotice(this.reclassified.size)
      await this.load()
    })
  }

  private pendingList(choices: NonNullable<OcVault['pendingChoices']>) {
    const subjectNames = new Map(this.subjects.map((s) => [s.id, text(s, 'name')]))
    const labelIn = (scheme: string, version: number, code: string) => labelOf(this.schemes, { scheme, version, code })
    return html`<section data-role="pending">
      <h3>${strings.reclassifyTitle(choices.length)}</h3>
      <p class="muted">${strings.reclassifyLead}</p>
      <table>
        <thead>
          <tr>
            <th>${strings.sessionDate}</th>
            <th>${strings.evidenceSubject}</th>
            <th>${strings.reclassifyWas}</th>
            <th>${strings.reclassifyTo}</th>
          </tr>
        </thead>
        <tbody>
          ${newestFirst(choices.map((c) => c.session)).map((session) => {
            const c = choices.find((x) => x.session.id === session.id)!
            const done = this.reclassified.has(session.id)
            return html`<tr data-pending=${session.id}>
              <td>${text(session, 'date')}</td>
              <td>${namesOf(session, subjectNames)}</td>
              <td>${labelOf(this.schemes, c.was)}</td>
              <td>
                ${done
                  ? html`<span class="muted">${strings.reclassified} · ${labelOf(this.schemes, session.fields[c.field])}</span>`
                  : html`<div class="row">
                      ${c.candidates.map(
                        (code) => html`<dc-button
                          size="sm"
                          variant="secondary"
                          data-code=${code}
                          ?disabled=${this.busy}
                          @click=${() => void this.reclassify(c, code)}
                          >${labelIn(c.scheme, c.version, code)}</dc-button
                        >`,
                      )}
                    </div>`}
              </td>
            </tr>`
          })}
        </tbody>
      </table>
    </section>`
  }

  /** Shows what a count is made of, and brings the list into view: it sits below the table. */
  private async showEvidence(title: string, group: Group) {
    this.pendingChoices = undefined
    this.comparison = undefined
    this.evidence = { title, group }
    await this.updateComplete
    this.renderRoot.querySelector('[data-role=evidence]')?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  private reportTable(result: RunRecord) {
    const table = layOut(result, this.schemes, this.practitioners, strings.noPractitioner)
    // The head count beside a record count, when the run recorded people.
    const people = (records: string[]) => {
      const n = records.length === 0 ? null : headCount(result, records)
      return n === null ? nothing : html`<span class="people" data-role="people">${strings.headCount(n)}</span>`
    }
    const count = (title: string, group: Group) =>
      group.count === 0
        ? html`<td class="num">0</td>`
        : html`<td class="num"><button class="cell" @click=${() => void this.showEvidence(title, group)}>${group.count}</button>${people(group.records)}</td>`
    return html`
      <p class="muted" data-role="period">${strings.reportPeriod(result.period.from, result.period.to)}</p>
      <table class="groups">
        <tbody>
          <tr data-group="pending">
            <th>${strings.pending}</th>
            ${table.pending.count === 0
              ? html`<td class="num">0</td>`
              : html`<td class="num"><button class="cell" @click=${() => void this.showPending(result)}>${table.pending.count}</button>${people(table.pending.records)}</td>`}
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
              <td class="num">${r.total}${people(r.records)}</td>
            </tr>`,
          )}
        </tbody>
        <tfoot>
          <tr>
            <th>${strings.reportTotal}</th>
            ${table.columnTotals.map((n, i) => html`<td class="num">${n}${people(table.columnRecords[i])}</td>`)}
            <td class="num" data-role="placed">${table.placed}${people(table.placedRecords)}</td>
          </tr>
        </tfoot>
      </table>
      ${result.people ? html`<p class="muted" data-role="head-count-hint">${strings.headCountHint}</p>` : nothing}
      ${this.compareControls(result)}
      ${this.comparison
        ? this.comparisonView(this.comparison)
        : this.pendingChoices
        ? this.pendingList(this.pendingChoices)
        : this.evidence
          ? this.evidenceList(this.evidence.title, this.evidence.group)
          : html`<p class="muted">${strings.pickCell}</p>`}
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
              <td>${namesOf(s, subjectNames)}</td>
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

  private devicesView() {
    const save = () => void this.saveDeviceName()
    const named = Object.keys(this.summary?.devices ?? {}).sort((a, b) => this.deviceLabel(a).localeCompare(this.deviceLabel(b)))
    return html`<section>
      <p class="muted">${strings.devicesLead}</p>
      <div class="row">
        ${this.nameField(strings.deviceName, this.deviceName, (v) => (this.deviceName = v), save)}
        <dc-button variant="secondary" ?disabled=${this.busy} @click=${save}>${strings.saveDeviceName}</dc-button>
      </div>
      ${this.notice ? html`<p role="status" class="muted">${this.notice}</p>` : nothing}
      <h3>${strings.knownDevices}</h3>
      ${named.length === 0
        ? html`<p class="muted">${strings.noNamedDevices}</p>`
        : html`<ul class="plain" aria-label=${strings.knownDevices}>
            ${named.map((d) => html`<li data-device=${d}>${this.deviceLabel(d)}</li>`)}
          </ul>`}
      <h3>${strings.idleLock}</h3>
      <div class="row" data-role="idle-lock">
        <label>
          ${strings.idleLock}
          <dc-select
            aria-label=${strings.idleLock}
            .options=${IDLE_CHOICES.map((m) => ({ value: String(m), label: strings.idleOption(m) }))}
            .value=${String(this.idleChoice)}
            @change=${(e: Event) => this.chooseIdle(Number((e.target as HTMLSelectElement).value))}
          ></dc-select>
        </label>
      </div>
      <p class="muted">${strings.idleLockLead}</p>
    </section>`
  }

}

declare global {
  interface HTMLElementTagNameMap {
    'oc-vault': OcVault
  }
}
