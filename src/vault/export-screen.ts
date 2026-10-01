import { open } from '@tauri-apps/plugin-dialog'
import type { DcCheckbox } from '@iyulab/desktop-compact/checkbox'
import { html, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { toTsv, type ExportTable } from '../export.js'
import { plainCopy } from '../plain-copy.js'
import { shell } from '../shell.js'
import { strings } from '../strings.js'
import { applyPackButton, deviceLabel, formBehind, listDetail, noticeLine, periodFields } from './parts.js'
import { valueText } from './session-parts.js'
import { VaultScreen } from './screen.js'

/** The list entry for the copy of every record that reads without the app, beside the forms. */
const PLAIN_COPY = 'plain-copy'

/** A month's records laid out as an export form's rows, to copy into another system; or every record, to read without the app. */
@customElement('oc-export')
export class OcExport extends VaultScreen {
  @state() private exportTable?: ExportTable
  /** While the window is narrow: the document shows instead of the list. */
  @state() private documentOpen = false
  /** The copy that reads without the app is picked, rather than a form. */
  @state() private plainPicked = false
  /** Whether written content goes into that copy: left out unless asked for. */
  @state() private withNarrative = false

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

  /**
   * Writes the copy that reads without the app into a new folder inside `folder` (what the folder
   * picker answers), and says where it went.
   */
  async makePlainCopy(folder: string) {
    const store = this.store
    const summary = store.summary
    store.set({ notice: '' })
    await store.run(async () => {
      const at = new Date()
      const words = strings.plainCopy
      const kinds = ['subject', 'session', 'group'] as const
      const history = new Map((await Promise.all(kinds.map((k) => shell.history(k)))).flat().map((h) => [h.id, h.changes]))
      const files = plainCopy(
        {
          vault: store.folder.split(/[\\/]/).filter(Boolean).at(-1) ?? '',
          device: summary ? deviceLabel(summary, summary.device) : '',
          at,
          subjects: store.subjects,
          groups: store.groups,
          practitioners: store.practitioners,
          sessions: store.sessions,
          subjectFields: store.subjectFields,
          sessionFields: store.sessionFields,
          valueText: (field, value) => valueText(store, field, value),
          withNarrative: this.withNarrative,
          history,
          deviceName: (device) => (summary ? deviceLabel(summary, device) : device),
        },
        words,
      )
      const pad = (n: number) => String(n).padStart(2, '0')
      const name = words.folder(`${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}${pad(at.getMinutes())}`)
      const made = await shell.writePlainCopy(folder, name, files)
      store.notice = strings.plainCopyDone(made)
    })
  }

  private async choosePlainCopyFolder() {
    const folder = await open({ directory: true, title: strings.plainCopyPickTitle })
    if (typeof folder === 'string') await this.makePlainCopy(folder)
  }

  /** Picks the form to list by; a list made by another form goes. */
  private pick(key: string) {
    this.documentOpen = true
    this.plainPicked = key === PLAIN_COPY
    if (this.plainPicked) return this.store.set({ notice: '' })
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
      entries: [
        ...forms.map((f) => ({ id: `${f.name}@${f.version}`, label: strings.reportFormOption(f.label, f.version) })),
        { id: PLAIN_COPY, label: strings.plainCopyEntry },
      ],
      selected: this.plainPicked ? PLAIN_COPY : store.exportKey,
      select: (key) => this.pick(key),
      empty: strings.noExports,
      document: this.plainPicked
        ? this.plainCopyDocument()
        : chosen
        ? this.formDocument(strings.reportFormOption(chosen.label, chosen.version))
        : html`${forms.length > 0 ? html`<p class="muted">${strings.pickExportForm}</p>` : nothing} ${applyPackButton(store)} ${noticeLine(store)}`,
      open: this.documentOpen,
      back: () => (this.documentOpen = false),
    })
  }

  /** The copy of every record that reads without the app: what it is, that it is unprotected, and where it goes. */
  private plainCopyDocument() {
    const busy = this.store.busy
    return html`<h2>${strings.plainCopyEntry}</h2>
      <p class="muted">${strings.plainCopyLead}</p>
      <p class="error" data-role="plain-copy-warning">${strings.plainCopyWarning}</p>
      <dc-checkbox
        data-role="plain-copy-narrative"
        .checked=${this.withNarrative}
        ?disabled=${busy}
        @change=${(e: Event) => (this.withNarrative = (e.target as DcCheckbox).checked)}
        >${strings.plainCopyNarrative}</dc-checkbox
      >
      <p class="muted">${strings.plainCopyNarrativeLead}</p>
      <div class="row">
        <dc-button variant="primary" ?disabled=${busy} @click=${() => void this.choosePlainCopyFolder()}>${strings.plainCopyMake}</dc-button>
      </div>
      ${noticeLine(this.store)}`
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
