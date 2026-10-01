import { html, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { toTsv, type ExportTable } from '../export.js'
import { shell } from '../shell.js'
import { strings } from '../strings.js'
import { applyPackButton, formBehind, listDetail, noticeLine, periodFields } from './parts.js'
import { VaultScreen } from './screen.js'

/** A month's records laid out as an export form's rows, to copy into another system. */
@customElement('oc-export')
export class OcExport extends VaultScreen {
  @state() private exportTable?: ExportTable
  /** While the window is narrow: the document shows instead of the list. */
  @state() private documentOpen = false

  private async runExport() {
    const store = this.store
    const [name, version] = store.exportKey.split('@')
    if (!name) return
    store.set({ notice: '' })
    await store.run(async () => {
      this.exportTable = await shell.runExport(name, Number(version), store.year, store.month)
    })
  }

  private async copyExport(table: ExportTable) {
    const store = this.store
    store.set({ notice: '' })
    await store.run(async () => {
      await navigator.clipboard.writeText(toTsv(table))
      store.notice = strings.exportCopied(table.rows.length)
    })
  }

  /** Picks the form to list by; a list made by another form goes. */
  private pick(key: string) {
    this.documentOpen = true
    if (key === this.store.exportKey) return
    this.store.set({ exportKey: key, notice: '' })
    this.exportTable = undefined
  }

  protected screen() {
    const store = this.store
    const forms = store.summary?.exports ?? []
    const chosen = forms.find((f) => `${f.name}@${f.version}` === store.exportKey)
    return listDetail({
      label: strings.exportForms,
      entries: forms.map((f) => ({ id: `${f.name}@${f.version}`, label: strings.reportFormOption(f.label, f.version) })),
      selected: store.exportKey,
      select: (key) => this.pick(key),
      empty: strings.noExports,
      document: chosen
        ? this.formDocument(strings.reportFormOption(chosen.label, chosen.version))
        : html`${forms.length > 0 ? html`<p class="muted">${strings.pickExportForm}</p>` : nothing} ${applyPackButton(store)} ${noticeLine(store)}`,
      open: this.documentOpen,
      back: () => (this.documentOpen = false),
    })
  }

  /** The chosen form's list for a month, ready to copy. */
  private formDocument(title: string) {
    const store = this.store
    const busy = store.busy
    const table = this.exportTable
    return html`<h2>${title}</h2>
      <p class="muted">${strings.exportLead}</p>
      <div class="row">
        ${periodFields(store)}
        <dc-button variant="primary" ?disabled=${busy} @click=${() => void this.runExport()}>${strings.makeExport}</dc-button>
        ${table && table.rows.length > 0
          ? html`<dc-button variant="secondary" ?disabled=${busy} @click=${() => void this.copyExport(table)}>${strings.copyExport}</dc-button>`
          : nothing}
      </div>
      ${formBehind(store.summary?.exports ?? [], store.exportKey)}
      ${noticeLine(store)}
      ${table ? this.tableView(table) : nothing}`
  }

  private tableView(table: ExportTable) {
    const gaps = table.pending.length + table.unmapped.length
    return html`
      <p class="muted" data-role="export-period">${strings.exportPeriod(table.from, table.to, table.rows.length)}</p>
      ${gaps > 0 ? html`<p class="error" data-role="export-gaps">${strings.exportGaps(table.pending.length, table.unmapped.length)}</p>` : nothing}
      ${table.withheld.length > 0 ? html`<p class="muted" data-role="export-withheld">${strings.exportWithheld(table.withheld)}</p>` : nothing}
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
}

declare global {
  interface HTMLElementTagNameMap {
    'oc-export': OcExport
  }
}
