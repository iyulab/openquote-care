import { html, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { comparable, headCount, layOut, type Comparison, type Group, type KeptRun, type RunRecord } from '../report.js'
import { shell } from '../shell.js'
import { strings } from '../strings.js'
import { applyPackButton, formBehind, noticeLine, periodFields } from './parts.js'
import { columnAxis, comparisonView, evidenceList, formOf, pendingList, type PendingEntry } from './report-parts.js'
import { VaultScreen } from './screen.js'

/** A month's report: its counts, what each is made of, what still waits, and how it moved since an earlier run. */
@customElement('oc-report')
export class OcReport extends VaultScreen {
  /** The report on screen: the record of the last run. */
  @state() private result?: RunRecord
  @state() private evidence?: { title: string; group: Group }
  /** Pending records of the report on screen, each with the codes a person chooses from. */
  @state() private pendingChoices?: PendingEntry[]
  @state() private reclassified = new Set<string>()
  @state() private keptRuns: KeptRun[] = []
  @state() private compareWith = ''
  @state() private comparison?: Comparison

  private async runReport() {
    const store = this.store
    const [name, version] = store.reportKey.split('@')
    if (!name) return
    await store.run(async () => {
      this.result = await shell.runReport(name, Number(version), store.year, store.month)
      this.evidence = undefined
      this.pendingChoices = undefined
      this.reclassified = new Set()
      store.notice = ''
      await store.load()
      await this.loadRuns()
    })
  }

  private async loadRuns() {
    this.keptRuns = await shell.runs()
    const offered = this.result ? comparable(this.keptRuns, this.result) : []
    this.compareWith = offered[0]?.id ?? ''
    this.comparison = undefined
  }

  /** Brings a list below the table into view once it is drawn. */
  private async reveal(role: string) {
    await this.updateComplete
    this.renderRoot.querySelector(`[data-role=${role}]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  private async compareRuns() {
    if (!this.result || !this.compareWith) return
    const later = this.result.id
    await this.store.run(async () => {
      this.comparison = await shell.compareRuns(this.compareWith, later)
      this.evidence = undefined
      this.pendingChoices = undefined
    })
    await this.reveal('comparison')
  }

  /** Lists the report's pending records with the codes each may take, for a person to choose. */
  private async showPending(result: RunRecord) {
    const byId = new Map(this.store.sessions.map((s) => [s.id, s]))
    await this.store.run(async () => {
      // The engine says which records still wait and for which codes — the screen never carries values itself.
      const waiting = await shell.pending(result.report.report, result.report.version, result.pending.records)
      this.evidence = undefined
      this.comparison = undefined
      this.pendingChoices = waiting
        .filter((w) => byId.has(w.record))
        .map((w) => ({ session: byId.get(w.record)!, field: w.field, was: w.was, scheme: w.scheme, version: w.version, candidates: w.candidates }))
    })
    await this.reveal('pending')
  }

  private async reclassify(choice: PendingEntry, code: string) {
    const store = this.store
    await store.run(async () => {
      await shell.record('/changes/reclassify', {
        type: choice.session.type,
        id: choice.session.id,
        field: choice.field,
        value: { scheme: choice.scheme, version: choice.version, code },
      })
      this.reclassified = new Set([...this.reclassified, choice.session.id])
      store.notice = strings.reclassifiedNotice(this.reclassified.size)
      await store.load()
    })
  }

  /** Shows what a count is made of, and brings the list into view: it sits below the table. */
  private async showEvidence(title: string, group: Group) {
    this.pendingChoices = undefined
    this.comparison = undefined
    this.evidence = { title, group }
    await this.reveal('evidence')
  }

  protected screen() {
    const store = this.store
    const busy = store.busy
    const reports = store.summary?.reports ?? []
    if (reports.length === 0)
      return html`<p class="muted">${strings.noReports}</p>
        ${applyPackButton(store)}
        ${noticeLine(store)}`
    return html`<section>
      <div class="row">
        <label>
          ${strings.reportForm}
          <dc-select
            aria-label=${strings.reportForm}
            .options=${reports.map((r) => ({ value: `${r.name}@${r.version}`, label: strings.reportFormOption(r.label, r.version) }))}
            .value=${store.reportKey}
            ?disabled=${busy}
            @change=${(e: Event) => store.set({ reportKey: (e.target as HTMLSelectElement).value })}
          ></dc-select>
        </label>
        ${periodFields(store)}
        <dc-button variant="primary" ?disabled=${busy} @click=${() => void this.runReport()}>${strings.runReport}</dc-button>
        ${applyPackButton(store)}
      </div>
      ${formBehind(reports, store.reportKey)}
      ${noticeLine(store)}
      ${this.result ? this.reportTable(this.result) : nothing}
    </section>`
  }

  private reportTable(result: RunRecord) {
    const store = this.store
    const table = layOut(result, store.schemes, columnAxis(store, formOf(store, result)))
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
        ? comparisonView(store, this.comparison)
        : this.pendingChoices
          ? pendingList(store, result, this.pendingChoices, this.reclassified, (c, code) => void this.reclassify(c, code))
          : this.evidence
            ? evidenceList(store, result, this.evidence.title, this.evidence.group)
            : html`<p class="muted">${strings.pickCell}</p>`}
    `
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
          ?disabled=${this.store.busy}
          @change=${(e: Event) => (this.compareWith = (e.target as HTMLSelectElement).value)}
        ></dc-select>
      </label>
      <dc-button variant="secondary" ?disabled=${this.store.busy} @click=${() => void this.compareRuns()}>${strings.compare}</dc-button>
    </div>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'oc-report': OcReport
  }
}
