import { html, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { conflictsOf, labelOf, newestFirst, text, type Entity } from '../records.js'
import { shell } from '../shell.js'
import { strings } from '../strings.js'
import { headingOf } from '../subject-fields.js'
import { planImport, tally, type ImportPlan, type PlannedRow } from '../subject-import.js'
import { nameField, noticeLine } from './parts.js'
import { VaultScreen } from './screen.js'
import './session-form.js'
import { conflictPanel } from './session-parts.js'

/** Subjects: adding them one by one or from pasted rows, and each one's sessions. */
@customElement('oc-subjects')
export class OcSubjects extends VaultScreen {
  @state() private subjectName = ''
  @state() private selected?: string
  /** Pasted subject rows, planned but not yet written. */
  @state() private importPlan?: ImportPlan
  /** The session whose concurrent changes are open for a person to settle. */
  @state() private settling?: string

  private async addSubject() {
    const name = this.subjectName.trim()
    if (!name) return this.store.problem('no-name')
    await this.store.run(async () => {
      const path = await shell.record('/changes/subject', { fields: { name } })
      this.subjectName = ''
      await this.store.load()
      this.selected = path.split('/')[1]
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

  protected screen() {
    const { busy, subjects } = this.store
    const subject = subjects.find((s) => s.id === this.selected)
    const addSubject = () => void this.addSubject()
    return html`<div class="columns">
      <section>
        <div class="row">
          ${nameField(busy, strings.subjectName, this.subjectName, (v) => (this.subjectName = v), addSubject)}
          <dc-button variant="secondary" ?disabled=${busy} @click=${addSubject}>${strings.addSubject}</dc-button>
        </div>
        <dc-paste-rows-zone
          placeholder=${strings.importPaste}
          @rows=${(e: CustomEvent<{ rows: string[][] }>) => {
            this.store.set({ notice: '' })
            this.importPlan = planImport(e.detail.rows, this.store.subjects)
          }}
        ></dc-paste-rows-zone>
        ${noticeLine(this.store)}
        ${subjects.length === 0
          ? html`<p class="muted">${strings.noSubjects}</p>`
          : html`<ul aria-label=${strings.subjects}>
              ${subjects.map(
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
        ? Object.entries(r.fields).map(([k, v]) => `${headingOf(k)} ${v}`).join(' · ')
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
    const names = new Map(store.practitioners.map((p) => [p.id, text(p, 'name')]))
    const open = sessions.find((s) => s.id === this.settling && conflictsOf(s).length > 0)
    return html`
      <h2>${strings.sessions(text(subject, 'name'))}</h2>
      ${open ? conflictPanel(store, open, (field, value) => void this.settle(open, field, value)) : nothing}
      <oc-session-form .store=${store} .holder=${{ kind: 'subject', id: subject.id }}></oc-session-form>
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
                    <td>${labelOf(store.schemes, s.fields.topic)}</td>
                    <td>${labelOf(store.schemes, s.fields.method)}</td>
                    <td>${names.get(text(s, 'practitioner')) ?? ''}</td>
                  </tr>`,
                )}
              </tbody>
            </table>`}
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'oc-subjects': OcSubjects
  }
}
