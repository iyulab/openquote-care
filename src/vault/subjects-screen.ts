import { html, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { headingIndex, labelOfField } from '../fields.js'
import { conflictsOf, entityOf, newestFirst, text, type Entity } from '../records.js'
import { shell } from '../shell.js'
import { strings } from '../strings.js'
import { planImport, tally, type ImportPlan, type PlannedRow } from '../subject-import.js'
import { latestCaseState } from '../cases.js'
import { recordFields } from '../fields.js'
import { today } from '../records.js'
import { narrowSubjects, shortDay, type CaseFilter, type SubjectOrder, type SubjectRow } from '../subject-list.js'
import { valueText } from './session-parts.js'
import { caseSection, recordsByCase } from './case-parts.js'
import { recordFieldList } from './entity-parts.js'
import { countBy, listDetail, nameField, noticeLine } from './parts.js'
import { VaultScreen } from './screen.js'
import './record-form.js'
import './record-kinds.js'
import './entity-form.js'
import { conflictPanel, recordTable, toggled } from './session-parts.js'
import type { VaultStore } from './store.js'
import type { OcRecordForm } from './record-form.js'

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
  /** The session open for correcting. */
  @state() private correcting?: string
  /** The subject's own record is open for correcting. */
  @state() private correctingSubject = false
  /** What narrows the list: words typed, the cases kept in view, the order. */
  @state() private query = ''
  @state() private caseFilter: CaseFilter = 'all'
  @state() private order: SubjectOrder = 'name'

  /** Brings the new session's form for the subject on screen into focus; with none on screen, finding one. */
  async focusNewSession() {
    await this.updateComplete
    const form = [...this.renderRoot.querySelectorAll<OcRecordForm>('oc-record-form')].find((f) => !f.edit && f.type === 'session')
    if (!this.adding && this.selected && form) await form.focusFirst()
    else await this.focusFind()
  }

  /** Brings the place to type words for finding a subject into focus. */
  async focusFind() {
    await this.updateComplete
    ;(this.renderRoot.querySelector('dc-input[data-role=find-subjects]') as HTMLElement | null)?.focus()
  }

  private async addSubject() {
    const name = this.subjectName.trim()
    if (!name) return this.store.problem('no-name')
    await this.store.run(async () => {
      const path = await shell.record('/changes/subject', { fields: { name } })
      this.subjectName = ''
      await this.store.load()
      this.pick(entityOf(path))
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
    this.correcting = undefined
    this.correctingSubject = false
    this.selected = id
    this.adding = false
    this.documentOpen = true
  }

  /** Opens `id` with `session`'s written content open under its row, and brings that row into view — a session's or another record's. */
  async showSession(id: string, session: string) {
    this.pick(id)
    this.openNotes = new Set([...this.openNotes, session])
    await this.updateComplete
    const kinds = this.renderRoot.querySelector('oc-record-kinds')
    await kinds?.updateComplete
    const row = this.renderRoot.querySelector(`tr[data-session="${session}"]`) ?? kinds?.renderRoot.querySelector(`tr[data-record="${session}"]`)
    row?.scrollIntoView({ block: 'center' })
  }

  /** Words to find a subject by, the cases kept in view — when some subject's cases are shown — and the order. */
  private listTools(withCases: boolean) {
    return html`<div class="list-tools">
      <dc-input
        type="search"
        data-role="find-subjects"
        aria-label=${strings.findSubjects}
        placeholder=${strings.findSubjects}
        .value=${this.query}
        @input=${(e: Event) => (this.query = (e.target as HTMLInputElement).value)}
      ></dc-input>
      <div class="list-filters">
        ${withCases
          ? html`<dc-select
              aria-label=${strings.subjectCases}
              data-role="subject-cases"
              .options=${[
                { value: 'all', label: strings.casesAll },
                { value: 'open', label: strings.caseOpen },
                { value: 'closed', label: strings.caseClosed },
              ]}
              .value=${this.caseFilter}
              @change=${(e: Event) => (this.caseFilter = (e.target as HTMLSelectElement).value as CaseFilter)}
            ></dc-select>`
          : nothing}
        <dc-select
          aria-label=${strings.subjectOrder}
          data-role="subject-order"
          .options=${[
            { value: 'name', label: strings.orderByName },
            { value: 'recent', label: strings.orderByRecent },
          ]}
          .value=${this.order}
          @change=${(e: Event) => (this.order = (e.target as HTMLSelectElement).value as SubjectOrder)}
        ></dc-select>
      </div>
    </div>`
  }

  private startAdding() {
    this.adding = true
    this.documentOpen = true
  }

  protected screen() {
    const { subjects } = this.store
    const subject = this.adding ? undefined : subjects.find((s) => s.id === this.selected)
    const counts = countBy(this.store.sessions, (s) => s.people)
    const all = subjectRows(this.store)
    const rows = narrowSubjects(all, { query: this.query, cases: this.caseFilter, order: this.order }, this.store.names)
    const year = today().slice(0, 4)
    return listDetail({
      store: this.store,
      label: strings.subjects,
      head: html`<dc-button variant="secondary" size="sm" @click=${() => this.startAdding()}>${strings.newSubject}</dc-button>
        ${all.length === 0 ? nothing : this.listTools(all.some((r) => r.state !== null))}`,
      entries: rows.map((r) => ({
        id: r.id,
        label: r.name,
        meta: [strings.sessionCount(counts.get(r.id) ?? 0), r.last ? strings.lastOn(shortDay(r.last, year)) : '', r.state ? (r.state === 'open' ? strings.caseOpen : strings.caseClosed) : '']
          .filter(Boolean)
          .join(' · '),
      })),
      selected: this.adding ? undefined : this.selected,
      select: (id) => this.pick(id),
      empty: all.length === 0 ? strings.noSubjects : strings.noSubjectsFound,
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
    return html`<dp-page-header heading=${strings.addSubject}></dp-page-header>
      <dc-card>
        <div class="stack">
          ${nameField(busy, strings.subjectName, this.subjectName, (v) => (this.subjectName = v), addSubject)}
          <dc-paste-rows-zone
            placeholder=${strings.importPaste}
            @rows=${(e: CustomEvent<{ rows: string[][] }>) => {
              this.store.set({ notice: '' })
              this.importPlan = planImport(e.detail.rows, this.store.subjects, headingIndex(this.store.subjectFields))
            }}
          ></dc-paste-rows-zone>
        </div>
        <dc-button slot="footer" variant="primary" ?disabled=${busy} @click=${addSubject}>${strings.addSubject}</dc-button>
      </dc-card>
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
    return html`<section data-role="import">
      <dp-page-header heading=${strings.importTitle}></dp-page-header>
      <p class="muted" data-role="import-tally">${strings.importTally(counts.create, counts.update, counts.same, counts.problem)}</p>
      ${plan.missingName ? html`<dc-callout variant="danger"><p>${strings.importMissingName}</p></dc-callout>` : nothing}
      ${plan.unknownHeadings.length > 0 ? html`<p class="muted">${strings.importUnknown(plan.unknownHeadings)}</p>` : nothing}
      <dc-card>
        <div class="scroll">
          <table>
            <tbody>
              ${plan.rows.map(
                (r) => html`<tr data-import-row=${r.line} data-kind=${r.kind}>
                  <td class="num">${r.line}</td>
                  <td class=${r.kind === 'problem' ? 'wrap error' : 'wrap'}>${status(r)}</td>
                  <td class="wrap">${shown(r)}</td>
                </tr>`,
              )}
            </tbody>
          </table>
        </div>
      </dc-card>
      <div class="row">
        <dc-button variant="primary" ?disabled=${busy || !plan.ready || counts.create + counts.update === 0} @click=${() => void this.importSubjects(plan)}
          >${strings.importApply(counts.create, counts.update)}</dc-button
        >
        <dc-button variant="secondary" ?disabled=${busy} @click=${() => (this.importPlan = undefined)}>${strings.cancel}</dc-button>
      </div>
    </section>`
  }

  private subjectDetail(subject: Entity) {
    const store = this.store
    const sessions = newestFirst(store.sessions.filter((s) => s.people.includes(subject.id)), store.dayOf)
    const open = sessions.find((s) => s.id === this.settling && conflictsOf(s).length > 0)
    const correcting = sessions.find((s) => s.id === this.correcting)
    return html`
      <dp-page-header
        heading=${text(subject, 'name')}
        description=${strings.sessionCount(sessions.length)}
      >
        ${this.correctingSubject
          ? nothing
          : html`<dc-button slot="actions" variant="secondary" size="sm" data-role="correct-subject-open" ?disabled=${store.busy} @click=${() => {
              store.set({ notice: '' })
              this.correctingSubject = true
            }}>${strings.correctSubject}</dc-button>`}
      </dp-page-header>
      ${this.correctingSubject
        ? html`<oc-entity-form
            .store=${store}
            .entity=${subject}
            @oc-entity-edited=${() => (this.correctingSubject = false)}
            @oc-edit-cancelled=${() => (this.correctingSubject = false)}
          ></oc-entity-form>`
        : recordFieldList(store, subject)}
      ${caseSection(store, subject.id)}
      ${open ? conflictPanel(store, open, (field, value) => void this.settle(open, field, value)) : nothing}
      ${correcting
        ? html`<oc-record-form
            .store=${store}
            .holder=${{ kind: 'subject', id: subject.id }}
            .edit=${correcting}
            @oc-record-edited=${() => (this.correcting = undefined)}
            @oc-edit-cancelled=${() => (this.correcting = undefined)}
          ></oc-record-form>`
        : nothing}
      <oc-record-form .store=${store} .holder=${{ kind: 'subject', id: subject.id }}></oc-record-form>
      <section>
        <dc-section-heading marker size="lg" heading=${strings.sessionHistory}></dc-section-heading>
        ${sessions.length === 0
          ? html`<dc-empty-state description=${strings.noSessions}></dc-empty-state>`
          : html`<dc-card
              ><div class="scroll">
                ${recordTable(store, {
                  records: sessions,
                  byCase: recordsByCase(store, subject.id),
                  openNotes: this.openNotes,
                  toggleNote: (id) => (this.openNotes = toggled(this.openNotes, id)),
                  settle: (id) => (this.settling = id),
                  correct: (id) => {
                    this.store.set({ notice: '' })
                    this.correcting = id
                  },
                })}
              </div></dc-card
            >`}
      </section>
      <oc-record-kinds .store=${store} .holder=${{ kind: 'subject', id: subject.id }}></oc-record-kinds>
      ${noticeLine(store)}
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'oc-subjects': OcSubjects
  }
}

/** Each subject as the list finds and shows it: its name and short values to find it by, its latest record, its latest case. */
function subjectRows(store: VaultStore): SubjectRow[] {
  const fields = recordFields(store.fieldsOf('subject')).filter((f) => f.tier !== 'narrative')
  const last = new Map<string, string>()
  for (const kind of store.kinds)
    for (const r of store.recordsOf(kind.type)) {
      const day = store.dayOf(r)
      if (!day) continue
      for (const id of r.people) if ((last.get(id) ?? '') < day) last.set(id, day)
    }
  return store.subjects.map((s) => {
    const name = text(s, 'name')
    return {
      id: s.id,
      name,
      words: [name, ...fields.map((f) => valueText(store, f, s.fields[f.name]))].join(' '),
      last: last.get(s.id) ?? null,
      state: latestCaseState(store.cases.get(s.id)),
    }
  })
}
