import type { DcCheckbox } from '@iyulab/desktop-compact/checkbox'
import { html, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { comparable, headCount, layOut, measureOf, sumOf, visitCount, type Comparison, type Group, type KeptRun, type Measure, type RunRecord, type Section } from '../report.js'
import { labelOfField } from '../fields.js'
import { shell, type ScaleSummary } from '../shell.js'
import { changeSigns, scaleLine } from '../cases.js'
import { scaleLabel } from './case-parts.js'
import { strings } from '../strings.js'
import { applyPackButton, formBehind, formLabel, listDetail, noticeLine, openSessionEvent, periodFields, stepMonth, raiseFormatCallout, rangeFields, yearSelect } from './parts.js'
import type { ReportEntry } from '../forms.js'
import { axesOf, blankLabel, comparisonView, dimensionTitles, evidenceList, filterParts, formOf, pendingList, unmappedWording, type PendingEntry } from './report-parts.js'
import { VaultScreen } from './screen.js'
import type { VaultStore } from './store.js'

/** A report over a period: its counts, what each is made of, what still waits, and how it moved since an earlier run. */
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
  /** While the window is narrow: the document shows instead of the list. */
  @state() private documentOpen = false
  /** The section of the report on screen, when a third dimension splits it: all of them together first. */
  @state() private section = 0
  /** Rows counting nothing are left off the screen; paper keeps the form whole. */
  @state() private hideEmpty = false
  /** The scale scores of the cases closed in the period last run, while the summary is the one picked. */
  @state() private scaleSummary?: ScaleSummary

  private async runReport() {
    const store = this.store
    const [name, version] = store.reportKey.split('@')
    const form = store.summary?.reports.find((r) => r.name === name && r.version === Number(version))
    if (!name || !form) return
    const period = periodOf(store, form)
    if (!period) {
      store.set({ error: { text: strings.rangeMissing } })
      return
    }
    await store.run(async () => {
      this.result = await shell.runReport(name, Number(version), period.from, period.to)
      this.section = 0
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
      const waiting = await shell.pending(result.report.report, result.report.version, result.pending.records, result.period.to)
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

  /** Steps the month by `by` when the chosen form counts a month; false when it counts another span. */
  stepPeriod(by: number): boolean {
    const form = this.store.summary?.reports.find((r) => `${r.name}@${r.version}` === this.store.reportKey)
    if (!form || this.store.busy || (form.unit !== undefined && form.unit !== 'month')) return false
    stepMonth(this.store, by)
    return true
  }

  /** Picks the form to report on; a report of another form leaves the document with what goes with it. */
  private pick(key: string) {
    this.documentOpen = true
    if (key === this.store.reportKey) return
    this.store.chooseReport(key)
    this.result = undefined
    this.evidence = undefined
    this.pendingChoices = undefined
    this.comparison = undefined
  }

  protected screen() {
    const store = this.store
    const reports = store.summary?.reports ?? []
    const chosen = reports.find((r) => `${r.name}@${r.version}` === store.reportKey)
    return listDetail({
      store: this.store,
      label: strings.reportForms,
      head: applyPackButton(store),
      entries: [
        ...byUnit(reports).map((r) => ({ id: `${r.name}@${r.version}`, label: formLabel(reports, r), group: unitGroup(r) })),
        // Not a form: the scale scores of the cases closed in a period, where the packs give scales.
        ...(store.scaleCodes.length > 0 ? [{ id: SCALE_SUMMARY, label: strings.scaleSummary, group: strings.formsBy.scales }] : []),
      ],
      selected: store.reportKey,
      select: (key) => this.pick(key),
      empty: strings.noReports,
      document: store.reportKey === SCALE_SUMMARY && store.scaleCodes.length > 0
        ? this.scaleSummaryDocument()
        : chosen
        ? this.formDocument(formLabel(reports, chosen))
        : html`${reports.length > 0 ? html`<p class="muted">${strings.pickReportForm}</p>` : nothing} ${raiseFormatCallout(store)} ${noticeLine(store)}`,
      open: this.documentOpen,
      back: () => (this.documentOpen = false),
    })
  }

  private async runScaleSummary() {
    const store = this.store
    const { rangeFrom: from, rangeTo: to } = store
    if (!from || !to || to < from) {
      store.set({ error: { text: strings.rangeMissing } })
      return
    }
    await store.run(async () => {
      this.scaleSummary = await shell.scaleSummary(from, to)
    })
  }

  /**
   * The scale scores of the cases closed in a period: for each scale, how many have a score and how many on two days,
   * and each case's first and last score with the difference — counts and arithmetic, nothing judged.
   */
  private scaleSummaryDocument() {
    const store = this.store
    const summary = this.scaleSummary
    const name = (subject: string) => store.subjects.find((s) => s.id === subject)?.fields.name
    const columns = strings.scaleSummaryColumns
    return html`<dp-page-header heading=${strings.scaleSummary}></dp-page-header>
      <p class="muted">${strings.scaleSummaryLead}</p>
      <div class="toolbar no-print">
        ${rangeFields(store)}
        <dc-button variant="primary" data-role="run-scale-summary" ?disabled=${store.busy} @click=${() => void this.runScaleSummary()}>${strings.runReport}</dc-button>
      </div>
      ${noticeLine(store)}
      ${summary === undefined
        ? html`<p class="muted">${strings.scaleSummaryPick}</p>`
        : summary.closed === 0
          ? html`<p class="muted" data-role="scale-summary-none">${strings.scaleSummaryNone}</p>`
          : html`<p data-role="scale-summary-closed">${strings.scaleSummaryClosed(summary.closed, summary.unscored)}</p>
              <dc-card>
                <table data-role="scale-summary">
                  <thead>
                    <tr>
                      <th>${columns.scale}</th><th class="num">${columns.scored}</th><th class="num">${columns.paired}</th>
                      <th class="num">${columns.same}</th><th class="num">${columns.higher}</th><th class="num">${columns.lower}</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${summary.scales.map((t) => {
                      const label = t.cases.length > 0 ? scaleLabel(store, t.cases[0].baseline.record, t.scale) : t.scale
                      const signs = changeSigns(t.cases)
                      return html`<tr data-scale=${t.scale}>
                          <td>${label}</td><td class="num">${t.scored}</td><td class="num">${t.paired}</td>
                          <td class="num" data-sign="same">${signs.same}</td><td class="num" data-sign="higher">${signs.higher}</td><td class="num" data-sign="lower">${signs.lower}</td>
                        </tr>
                        ${t.cases.map(
                          (c) => html`<tr class="muted" data-scale-case=${c.subject}>
                            <td colspan="6">${typeof name(c.subject) === 'string' ? name(c.subject) : c.subject} · ${scaleLine(c, label)}</td>
                          </tr>`,
                        )}`
                    })}
                  </tbody>
                </table>
              </dc-card>`}`
  }

  /** The chosen form's report: the month to count, the counts, and what they are made of. */
  private formDocument(title: string) {
    const store = this.store
    const busy = store.busy
    return html`<dp-page-header heading=${title}></dp-page-header>
      <div class="toolbar no-print">
        ${chosenPeriodFields(store)}
        <dc-button variant="primary" ?disabled=${busy} @click=${() => void this.runReport()}>${strings.runReport}</dc-button>
        ${this.result ? html`<dc-button variant="secondary" data-role="print" ?disabled=${busy} @click=${() => window.print()}>${strings.print}</dc-button>` : nothing}
      </div>
      ${raiseFormatCallout(store)}
      ${formBehind(store.summary?.reports ?? [], store.reportKey, (s) => store.schemeName(s))}
      ${noticeLine(store)}
      ${this.result ? this.reportTable(this.result) : nothing}`
  }

  private reportTable(result: RunRecord) {
    const store = this.store
    const form = formOf(store, result)
    const layout = layOut(result, axesOf(store, form, result), strings.allSections)
    const titles = dimensionTitles(store, form)
    const measures: Measure[] = form?.measures.length ? form.measures : ['records', 'people']
    const [first, ...others] = measures
    // The numbers beside the foremost one, in words; none for no records, or when the run did not record people.
    const note = (records: string[]) => {
      if (records.length === 0) return nothing
      const parts = others.flatMap((m) => {
        const n = measureOf(result, records, m)
        return n === null ? [] : [strings.measurePart[m](n)]
      })
      // Each field the form adds up: its sum, and how many records hold no number there.
      for (const field of form?.sums ?? []) {
        const s = sumOf(result, records, field)
        if (s) parts.push(strings.sumPart(labelOfField(store.sessionFields, field), s.sum, s.missing))
      }
      return parts.length === 0 ? nothing : html`<span class="people" data-role="measures">${strings.measureNote(parts)}</span>`
    }
    const foremost = (records: string[]) => measureOf(result, records, first) ?? records.length
    // A sum's cell: its number and the others beside it, nought in the quiet text.
    const sumCell = (records: string[], role?: string) =>
      html`<td class=${records.length === 0 ? 'num zero' : 'num'} data-role=${role ?? nothing}>${foremost(records)}${note(records)}</td>`
    const metric = (group: 'pending' | 'unmapped' | 'blank' | 'conflicted' | 'total', label: string, g: Group, open: () => void, accent: '' | '1' | '2' = '') => {
      const n = g.records.length === 0 ? null : headCount(result, g.records)
      // The total always stands out; a count that asks for attention steps back at nought.
      const quiet = group !== 'total' && g.count === 0
      return html`<dc-metric data-group=${group} class=${quiet ? 'quiet' : ''} label=${label} value=${String(g.count)} unit=${strings.countUnit} accent=${accent}>
        ${n === null ? nothing : html`<span data-role="people">${strings.headCount(n)}</span>`}
        ${g.count === 0 ? nothing : html`<button class="cell" @click=${open}>${strings.showRecords}</button>`}
        ${group === 'pending' && g.count > 0 ? html`<dc-badge slot="label-extra" variant="warning">${g.count}</dc-badge>` : nothing}
      </dc-metric>`
    }
    const total = layout.total.records
    const peopleTotal = total.length === 0 || !measures.includes('people') ? null : headCount(result, total)
    const visitsTotal = total.length === 0 || !measures.includes('visits') ? null : visitCount(result, total)
    const blank = blankLabel(store, form)
    const unmapped = unmappedWording(store, form)
    const filters = filterParts(store, form, result)
    const sectioned = layout.sections.length > 1
    const active = Math.min(this.section, layout.sections.length - 1)
    const corner = titles.length >= 2 ? strings.reportCorner(titles[0], titles[1]) : (titles[0] ?? strings.reportRow)
    const grid = (section: Section, index: number) => {
      const table = section.table
      const where = (place: string) => (sectioned ? `${section.label} · ${place}` : place)
      const count = (place: string, group: Group) =>
        group.count === 0
          ? html`<td class="num zero">0</td>`
          : html`<td class="num"><button class="cell" aria-pressed=${this.evidence?.title === where(place) ? 'true' : 'false'} @click=${() => void this.showEvidence(where(place), group)}>${foremost(group.records)}</button>${note(group.records)}</td>`
      return html`<div class="section" data-section=${index} ?hidden=${index !== active}>
        ${sectioned ? html`<p class="print-only section-label">${section.label}</p>` : nothing}
        <table class="report">
          <thead>
            <tr>
              <th>${corner}</th>
              ${table.columns.map((c) => html`<th class="num">${c.label}</th>`)}
              <th class="num">${strings.reportTotal}</th>
            </tr>
          </thead>
          <tbody>
            ${table.rows.map(
              (r) => html`<tr data-row=${r.code ?? nothing} class=${r.records.length === 0 ? 'empty' : ''} ?hidden=${this.hideEmpty && r.records.length === 0}>
                <th>${r.label}</th>
                ${r.cells.map((cell, i) => count(`${r.label} · ${table.columns[i].label}`, cell))}
                ${sumCell(r.records)}
              </tr>`,
            )}
          </tbody>
          <tfoot>
            <tr>
              <th>${strings.reportTotal}</th>
              ${table.columnRecords.map((records) => sumCell(records))}
              ${sumCell(table.placedRecords, 'placed')}
            </tr>
          </tfoot>
        </table>
      </div>`
    }
    return html`
      <p class="muted" data-role="period">${strings.reportPeriod(result.period.from, result.period.to)}</p>
      <div class="metrics">
        ${peopleTotal === null ? nothing : html`<dc-metric accent="1" label=${strings.metricPeople} value=${String(peopleTotal)} unit=${strings.peopleUnit}></dc-metric>`}
        ${visitsTotal === null ? nothing : html`<dc-metric data-role="visits" label=${strings.metricVisits} value=${String(visitsTotal)} unit=${strings.peopleUnit}></dc-metric>`}
        ${metric('total', strings.grandTotal, layout.total, () => void this.showEvidence(strings.grandTotal, layout.total), '2')}
        ${metric('pending', strings.pending, layout.pending, () => void this.showPending(result))}
        ${metric('unmapped', unmapped.label, layout.unmapped, () => void this.showEvidence(unmapped.label, layout.unmapped))}
        ${layout.blank.count === 0 ? nothing : metric('blank', blank, layout.blank, () => void this.showEvidence(blank, layout.blank))}
        ${layout.conflicted.count === 0 ? nothing : metric('conflicted', strings.conflict, layout.conflicted, () => void this.showEvidence(strings.conflict, layout.conflicted))}
      </div>
      ${layout.pending.count + layout.unmapped.count + layout.blank.count + layout.conflicted.count === 0
        ? nothing
        : html`<dl class="legend">
            ${layout.pending.count > 0 ? html`<div><dt>${strings.pending}</dt><dd>${strings.pendingHint}</dd></div>` : nothing}
            ${layout.unmapped.count > 0 ? html`<div><dt>${unmapped.label}</dt><dd>${unmapped.hint}</dd></div>` : nothing}
            ${layout.blank.count > 0 ? html`<div><dt>${blank}</dt><dd>${strings.blankHint}</dd></div>` : nothing}
            ${layout.conflicted.count > 0 ? html`<div><dt>${strings.conflict}</dt><dd>${strings.conflictedHint}</dd></div>` : nothing}
          </dl>`}
      <div class="report-body">
        <section>
          ${filters.length === 0 ? nothing : html`<p class="muted" data-role="filters">${strings.reportFilters(filters)}</p>`}
          <dc-checkbox
            class="no-print"
            data-role="hide-empty"
            .checked=${this.hideEmpty}
            @change=${(e: Event) => (this.hideEmpty = (e.target as DcCheckbox).checked)}
            >${strings.hideEmptyRows}</dc-checkbox
          >
          ${sectioned
            ? html`<dc-tab-bar
                class="no-print"
                aria-label=${titles[2] ?? ''}
                .items=${layout.sections.map((s, i) => ({ id: String(i), label: s.label }))}
                activeId=${String(active)}
                @dc-tab-change=${(e: Event) => (this.section = Number((e as Event & { tabId: string }).tabId))}
              ></dc-tab-bar>`
            : nothing}
          <dc-card><div class="scroll bounded">${layout.sections.map(grid)}</div></dc-card>
          ${result.people ? html`<p class="detail" data-role="head-count-hint">${strings.headCountHint}</p>` : nothing}
        </section>
        <aside class="report-aside">
          ${this.comparison
            ? comparisonView(store, this.comparison)
            : this.pendingChoices
              ? pendingList(store, result, this.pendingChoices, this.reclassified, (c, code) => void this.reclassify(c, code))
              : this.evidence
                ? evidenceList(store, result, this.evidence.title, this.evidence.group, (record) => this.dispatchEvent(openSessionEvent(record)))
                : html`<p class="muted no-print">${strings.pickCell}</p>`}
          ${this.compareControls(result)}
        </aside>
      </div>
    `
  }

  private compareControls(result: RunRecord) {
    const offered = comparable(this.keptRuns, result)
    if (offered.length === 0) return html`<p class="muted no-print">${strings.noEarlierRun}</p>`
    return html`<div class="row no-print">
      <dc-field label=${strings.compareWith}>
        <dc-select
          aria-label=${strings.compareWith}
          .options=${offered.map((k) => ({ value: k.id, label: strings.runOption(k.at, k.report.version, k.total) }))}
          .value=${this.compareWith}
          ?disabled=${this.store.busy}
          @change=${(e: Event) => (this.compareWith = (e.target as HTMLSelectElement).value)}
        ></dc-select>
      </dc-field>
      <dc-button variant="secondary" ?disabled=${this.store.busy} @click=${() => void this.compareRuns()}>${strings.compare}</dc-button>
    </div>`
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

/** The statistics list's entry for the scale scores of closed cases. */
const SCALE_SUMMARY = 'scales:summary'

/** The heading a form is listed under: the span it counts — a month, a year (or one from another month), a day, a range. */
function unitGroup(form: ReportEntry): string {
  if (form.unit === 'year') return form.startMonth === 1 ? strings.formsBy.year : strings.formsBy.schoolYear
  return strings.formsBy[form.unit ?? 'month']
}

/** The forms by the span they count — months first, then years (from January, then from another month), days and ranges — each span's in the order given. */
function byUnit(forms: readonly ReportEntry[]): ReportEntry[] {
  const order = [strings.formsBy.month, strings.formsBy.year, strings.formsBy.schoolYear, strings.formsBy.day, strings.formsBy.range]
  return forms
    .map((form, i) => ({ form, i, at: order.indexOf(unitGroup(form)) }))
    .sort((a, b) => a.at - b.at || a.i - b.i)
    .map(({ form }) => form)
}

/** The period to run a form over, by its unit: a day in it, or the first and last day of a range — undefined while a range is not picked. */
function periodOf(store: VaultStore, form: ReportEntry): { from: string; to?: string } | undefined {
  switch (form.unit) {
    case 'day':
      return store.day ? { from: store.day } : undefined
    case 'year':
      return { from: `${store.year}-${pad(form.startMonth)}-01` }
    case 'range':
      return store.rangeFrom && store.rangeTo && store.rangeFrom <= store.rangeTo ? { from: store.rangeFrom, to: store.rangeTo } : undefined
    default:
      return { from: `${store.year}-${pad(store.month)}-01` }
  }
}

/** What a person picks the period by, for the chosen form's unit. */
function chosenPeriodFields(store: VaultStore) {
  const form = store.summary?.reports.find((r) => `${r.name}@${r.version}` === store.reportKey)
  const date = (label: string, value: string, set: (v: string) => void) => html`<dc-field label=${label}>
    <dc-input type="date" aria-label=${label} .value=${value} ?disabled=${store.busy} @input=${(e: Event) => set((e.target as HTMLInputElement).value)}></dc-input>
  </dc-field>`
  switch (form?.unit) {
    case 'day':
      return date(strings.periodDay, store.day, (day) => store.set({ day }))
    case 'range':
      return rangeFields(store)
    case 'year': {
      return form.startMonth === 1 ? yearSelect(store, strings.year) : yearSelect(store, strings.schoolYear, strings.schoolYearOption)
    }
    default:
      return periodFields(store)
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'oc-report': OcReport
  }
}
