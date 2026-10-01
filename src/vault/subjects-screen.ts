import { html, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { headingIndex, labelOfField } from '../fields.js'
import { conflictsOf, newestFirst, text, type Entity } from '../records.js'
import { shell } from '../shell.js'
import { strings } from '../strings.js'
import { planImport, tally, type ImportPlan, type PlannedRow } from '../subject-import.js'
import { listDetail, nameField, noticeLine } from './parts.js'
import { VaultScreen } from './screen.js'
import './session-form.js'
import { conflictPanel, sessionTable, toggled } from './session-parts.js'

/** Subjects: adding them one by one or from pasted rows, and each one's sessions. */
@customElement('oc-subjects')
export class OcSubjects extends VaultScreen {
  @state() private subjectName = ''
  @state() private selected?: string
  /** The document is the form for adding subjects, rather than a subject's records. */
  @state() private adding = false
  /** While the window is narrow: the document shows instead of the list. */
  @state() private documentOpen = false
  /** Pasted subject rows, planned but not yet written. */
  @state() private importPlan?: ImportPlan
  /** The session whose concurrent changes are open for a person to settle. */
  @state() private settling?: string
  /** Sessions whose written content is open under their row. */
  @state() private openNotes = new Set<string>()

  private async addSubject() {
    const name = this.subjectName.trim()
    if (!name) return this.store.problem('no-name')
    await this.store.run(async () => {
      const path = await shell.record('/changes/subject', { fields: { name } })
      this.subjectName = ''
      await this.store.load()
      this.pick(path.split('/')[1])
    })
  }

  private async importSubjects(plan: ImportPlan) {
    if (!plan.ready) return
    const store = this.store
    store.set({ notice: '' })
    await store.run(async () => {
      for (const row of plan.rows) {
        if (row.kind === 'create') await shell.record('/changes/subject', { fields: row.fields })
        else if (row.kind === 'update') await shell.record('/changes/update', { type: 'subject', id: row.subject, fields: row.fields })
      }
      const counts = tally(plan)
      this.importPlan = undefined
      await store.load()
      store.notice = strings.imported(counts.create, counts.update)
    })
  }

  private async settle(session: Entity, field: string, value: unknown) {
    const store = this.store
    await store.run(async () => {
      await shell.record('/changes/update', { type: session.type, id: session.id, fields: { [field]: value } })
      await store.load()
      if (conflictsOf(store.sessions.find((s) => s.id === session.id) ?? session).length === 0) this.settling = undefined
    })
  }

  private pick(id: string) {
    this.selected = id
    this.adding = false
    this.documentOpen = true
  }

  private startAdding() {
    this.adding = true
    this.documentOpen = true
  }

  protected screen() {
    const { subjects } = this.store
    const subject = this.adding ? undefined : subjects.find((s) => s.id === this.selected)
    return listDetail({
      label: strings.subjects,
      head: html`<dc-button variant="secondary" size="sm" @click=${() => this.startAdding()}>${strings.newSubject}</dc-button>`,
      entries: subjects.map((s) => ({ id: s.id, label: text(s, 'name') })),
      selected: this.adding ? undefined : this.selected,
      select: (id) => this.pick(id),
      empty: strings.noSubjects,
      document: this.adding
        ? this.importPlan
          ? this.importPreview(this.importPlan)
          : this.addForm()
        : subject
          ? this.subjectDetail(subject)
          : html`<p class="muted">${strings.pickSubject}</p>${noticeLine(this.store)}`,
      open: this.documentOpen,
      back: () => (this.documentOpen = false),
    })
  }

  /** Adding subjects: one by name, or many from rows pasted out of a spreadsheet. */
  private addForm() {
    const busy = this.store.busy
    const addSubject = () => void this.addSubject()
    return html`<h2>${strings.addSubject}</h2>
      <div class="row">
        ${nameField(busy, strings.subjectName, this.subjectName, (v) => (this.subjectName = v), addSubject)}
        <dc-button variant="primary" ?disabled=${busy} @click=${addSubject}>${strings.addSubject}</dc-button>
      </div>
      <dc-paste-rows-zone
        placeholder=${strings.importPaste}
        @rows=${(e: CustomEvent<{ rows: string[][] }>) => {
          this.store.set({ notice: '' })
          this.importPlan = planImport(e.detail.rows, this.store.subjects, headingIndex(this.store.subjectFields))
        }}
      ></dc-paste-rows-zone>
      ${noticeLine(this.store)}`
  }

  private importPreview(plan: ImportPlan) {
    const counts = tally(plan)
    const busy = this.store.busy
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
        ? Object.entries(r.fields).map(([k, v]) => `${labelOfField(this.store.subjectFields, k)} ${v}`).join(' · ')
        : r.kind === 'same'
          ? text(this.store.subjects.find((s) => s.id === r.subject) ?? ({ fields: {} } as Entity), 'name')
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
        <dc-button variant="primary" ?disabled=${busy || !plan.ready || counts.create + counts.update === 0} @click=${() => void this.importSubjects(plan)}
          >${strings.importApply(counts.create, counts.update)}</dc-button
        >
        <dc-button variant="secondary" ?disabled=${busy} @click=${() => (this.importPlan = undefined)}>${strings.cancel}</dc-button>
      </div>
    </div>`
  }

  private subjectDetail(subject: Entity) {
    const store = this.store
    const sessions = newestFirst(store.sessions.filter((s) => s.people.includes(subject.id)))
    const open = sessions.find((s) => s.id === this.settling && conflictsOf(s).length > 0)
    return html`
      <h2>${strings.sessions(text(subject, 'name'))}</h2>
      ${open ? conflictPanel(store, open, (field, value) => void this.settle(open, field, value)) : nothing}
      <oc-session-form .store=${store} .holder=${{ kind: 'subject', id: subject.id }}></oc-session-form>
      ${sessions.length === 0
        ? html`<p class="muted">${strings.noSessions}</p>`
        : html`<p class="muted">${strings.sessionCount(sessions.length)}</p>
            ${sessionTable(store, {
              sessions,
              openNotes: this.openNotes,
              toggleNote: (id) => (this.openNotes = toggled(this.openNotes, id)),
              settle: (id) => (this.settling = id),
            })}`}
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'oc-subjects': OcSubjects
  }
}
