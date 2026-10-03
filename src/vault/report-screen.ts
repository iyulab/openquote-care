import { html, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { comparable, headCount, layOut, measureOf, visitCount, type Comparison, type Group, type KeptRun, type Measure, type RunRecord, type Section } from '../report.js'
import { shell } from '../shell.js'
import { strings } from '../strings.js'
import { applyPackButton, formBehind, listDetail, noticeLine, periodFields, rangeFields } from './parts.js'
import type { ReportEntry } from '../forms.js'
import { axesOf, blankLabel, comparisonView, dimensionTitles, evidenceList, filterParts, formOf, pendingList, type PendingEntry } from './report-parts.js'
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

  /** Picks the form to report on; a report of another form leaves the document with what goes with it. */
  private pick(key: string) {
    this.documentOpen = true
    if (key === this.store.reportKey) return
    this.store.set({ reportKey: key })
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
      label: strings.reportForms,
      entries: reports.map((r) => ({ id: `${r.name}@${r.version}`, label: strings.reportFormOption(r.label, r.version) })),
      selected: store.reportKey,
      select: (key) => this.pick(key),
      empty: strings.noReports,
      document: chosen
        ? this.formDocument(strings.reportFormOption(chosen.label, chosen.version))
        : html`${reports.length > 0 ? html`<p class="muted">${strings.pickReportForm}</p>` : nothing} ${applyPackButton(store)} ${noticeLine(store)}`,
      open: this.documentOpen,
      back: () => (this.documentOpen = false),
    })
  }

  /** The chosen form's report: the month to count, the counts, and what they are made of. */
  private formDocument(title: string) {
    const store = this.store
    const busy = store.busy
    return html`<dp-page-header eyebrow=${strings.report} heading=${title}>
        <div slot="actions" class="row no-print">
          ${chosenPeriodFields(store)}
          ${applyPackButton(store)}
          <dc-button variant="primary" ?disabled=${busy} @click=${() => void this.runReport()}>${strings.runReport}</dc-button>
          ${this.result ? html`<dc-button variant="secondary" data-role="print" ?disabled=${busy} @click=${() => window.print()}>${strings.print}</dc-button>` : nothing}
        </div>
      </dp-page-header>
      ${formBehind(store.summary?.reports ?? [], store.reportKey, (s) => store.schemeName(s))}
      ${noticeLine(store)}
      ${this.result ? this.reportTable(this.result, title) : nothing}`
  }

  private reportTable(result: RunRecord, title: string) {
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
      return parts.length === 0 ? nothing : html`<span class="people" data-role="measures">${strings.measureNote(parts)}</span>`
    }
    const foremost = (records: string[]) => measureOf(result, records, first) ?? records.length
    const metric = (group: 'pending' | 'unmapped' | 'blank' | 'conflicted' | 'total', label: string, g: Group, open: () => void, accent: '' | '1' | '2' = '') => {
      const n = g.records.length === 0 ? null : headCount(result, g.records)
      return html`<dc-metric data-group=${group} label=${label} value=${String(g.count)} unit=${strings.countUnit} accent=${accent}>
        ${n === null ? nothing : html`<span data-role="people">${strings.headCount(n)}</span>`}
        ${g.count === 0 ? nothing : html`<button class="cell" @click=${open}>${strings.showRecords}</button>`}
        ${group === 'pending' && g.count > 0 ? html`<dc-badge slot="label-extra" variant="warning">${g.count}</dc-badge>` : nothing}
      </dc-metric>`
    }
    const total = layout.total.records
    const peopleTotal = total.length === 0 || !measures.includes('people') ? null : headCount(result, total)
    const visitsTotal = total.length === 0 || !measures.includes('visits') ? null : visitCount(result, total)
    const blank = blankLabel(store, form)
    const filters = filterParts(store, form, result)
    const sectioned = layout.sections.length > 1
    const active = Math.min(this.section, layout.sections.length - 1)
    const corner = titles.length >= 2 ? strings.reportCorner(titles[0], titles[1]) : (titles[0] ?? strings.reportRow)
    const grid = (section: Section, index: number) => {
      const table = section.table
      const where = (place: string) => (sectioned ? `${section.label} · ${place}` : place)
      const count = (place: string, group: Group) =>
        group.count === 0
          ? html`<td class="num">0</td>`
          : html`<td class="num"><button class="cell" @click=${() => void this.showEvidence(where(place), group)}>${foremost(group.records)}</button>${note(group.records)}</td>`
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
              (r) => html`<tr data-row=${r.code ?? nothing}>
                <th>${r.label}</th>
                ${r.cells.map((cell, i) => count(`${r.label} · ${table.columns[i].label}`, cell))}
                <td class="num">${foremost(r.records)}${note(r.records)}</td>
              </tr>`,
            )}
          </tbody>
          <tfoot>
            <tr>
              <th>${strings.reportTotal}</th>
              ${table.columnRecords.map((records) => html`<td class="num">${foremost(records)}${note(records)}</td>`)}
              <td class="num" data-role="placed">${foremost(table.placedRecords)}${note(table.placedRecords)}</td>
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
        ${metric('unmapped', strings.unmapped, layout.unmapped, () => void this.showEvidence(strings.unmapped, layout.unmapped))}
        ${layout.blank.count === 0 ? nothing : metric('blank', blank, layout.blank, () => void this.showEvidence(blank, layout.blank))}
        ${layout.conflicted.count === 0 ? nothing : metric('conflicted', strings.conflict, layout.conflicted, () => void this.showEvidence(strings.conflict, layout.conflicted))}
      </div>
      <dl class="legend">
        ${layout.pending.count > 0 ? html`<div><dt>${strings.pending}</dt><dd>${strings.pendingHint}</dd></div>` : nothing}
        ${layout.unmapped.count > 0 ? html`<div><dt>${strings.unmapped}</dt><dd>${strings.unmappedHint}</dd></div>` : nothing}
        ${layout.blank.count > 0 ? html`<div><dt>${blank}</dt><dd>${strings.blankHint}</dd></div>` : nothing}
        ${layout.conflicted.count > 0 ? html`<div><dt>${strings.conflict}</dt><dd>${strings.conflictedHint}</dd></div>` : nothing}
      </dl>
      <section>
        <dc-section-heading marker size="lg" heading=${title}></dc-section-heading>
        ${filters.length === 0 ? nothing : html`<p class="muted" data-role="filters">${strings.reportFilters(filters)}</p>`}
        ${sectioned
          ? html`<dc-tab-bar
              class="no-print"
              aria-label=${titles[2] ?? ''}
              .items=${layout.sections.map((s, i) => ({ id: String(i), label: s.label }))}
              activeId=${String(active)}
              @dc-tab-change=${(e: Event) => (this.section = Number((e as Event & { tabId: string }).tabId))}
            ></dc-tab-bar>`
          : nothing}
        <dc-card><div class="scroll">${layout.sections.map(grid)}</div></dc-card>
      </section>
      ${result.people ? html`<p class="muted" data-role="head-count-hint">${strings.headCountHint}</p>` : nothing}
      ${this.compareControls(result)}
      ${this.comparison
        ? comparisonView(store, this.comparison)
        : this.pendingChoices
          ? pendingList(store, result, this.pendingChoices, this.reclassified, (c, code) => void this.reclassify(c, code))
          : this.evidence
            ? evidenceList(store, result, this.evidence.title, this.evidence.group)
            : html`<p class="muted no-print">${strings.pickCell}</p>`}
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
      const label = form.startMonth === 1 ? strings.year : strings.schoolYear
      return html`<dc-field label=${label}>
        <dc-input type="number" aria-label=${label} min="2000" max="2100" .value=${String(store.year)} ?disabled=${store.busy}
          @input=${(e: Event) => store.set({ year: Number((e.target as HTMLInputElement).value) })}></dc-input>
      </dc-field>`
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
