import { open } from '@tauri-apps/plugin-dialog'
import type { DcCheckbox } from '@iyulab/desktop-compact/checkbox'
import { html, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { toTsv, type ExportTable } from '../export.js'
import { storeCopy, storedCopy, type LastCopy } from '../last-copy.js'
import { plainCopy } from '../plain-copy.js'
import { shell } from '../shell.js'
import { strings } from '../strings.js'
import { applyPackButton, deviceLabel, formBehind, listDetail, noticeLine, periodFields, rangeFields } from './parts.js'
import { valueText } from './session-parts.js'
import { VaultScreen } from './screen.js'

/** The list entry for the copy of every record that reads without the app, beside the forms. */
const PLAIN_COPY = 'plain-copy'

/** A period's records laid out as an export form's rows — a month, or any days such as a school year — to copy into another system; or every record, to read without the app. */
@customElement('oc-export')
export class OcExport extends VaultScreen {
  @state() private exportTable?: ExportTable
  /** While the window is narrow: the document shows instead of the list. */
  @state() private documentOpen = false
  /** The copy that reads without the app is picked, rather than a form. */
  @state() private plainPicked = false
  /** Whether written content goes into that copy: left out unless asked for. */
  @state() private withNarrative = false
  /** The last copy this computer made of the vault, and how many changes the records have now. */
  @state() private lastCopy: LastCopy | null = null
  @state() private changesNow?: number
  /** The rows cover any days a person picks rather than a month. */
  @state() private byRange = false

  /** Every change the records a copy holds were built from: subjects, sessions, groups and practitioners. */
  private async changes() {
    const kinds = ['subject', 'session', 'group', 'practitioner'] as const
    return new Map((await Promise.all(kinds.map((k) => shell.history(k)))).flat().map((h) => [h.id, h.changes]))
  }

  /** Reads what the screen says about the last copy: when it was made, and whether records changed since. */
  private async readLastCopy() {
    this.lastCopy = storedCopy(this.store.folder)
    this.changesNow = undefined
    if (!this.lastCopy) return
    const history = await this.changes().catch(() => undefined)
    if (history) this.changesNow = [...history.values()].reduce((n, c) => n + c.length, 0)
  }

  private async runExport() {
    const store = this.store
    const [name, version] = store.exportKey.split('@')
    if (!name) return
    const pad = (n: number) => String(n).padStart(2, '0')
    const month = `${store.year}-${pad(store.month)}`
    const [from, to] = this.byRange
      ? [store.rangeFrom, store.rangeTo]
      : [`${month}-01`, `${month}-${pad(new Date(store.year, store.month, 0).getDate())}`]
    if (!from || !to || to < from) {
      store.set({ error: { text: strings.rangeMissing } })
      return
    }
    store.set({ notice: '' })
    await store.run(async () => {
      this.exportTable = await shell.runExport(name, Number(version), from, to)
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
      const history = await this.changes()
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
      const changes = [...history.values()].reduce((n, c) => n + c.length, 0)
      this.lastCopy = { at: at.getTime(), folder: made, withNarrative: this.withNarrative, changes }
      this.changesNow = changes
      storeCopy(store.folder, this.lastCopy)
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
    if (this.plainPicked) {
      void this.readLastCopy()
      return this.store.set({ notice: '' })
    }
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
    return html`<dp-page-header eyebrow=${strings.exportTitle} heading=${strings.plainCopyEntry} description=${strings.plainCopyLead}></dp-page-header>
      <dc-callout variant="warning" data-role="plain-copy-warning"><p>${strings.plainCopyWarning}</p></dc-callout>
      <dc-checkbox
        data-role="plain-copy-narrative"
        .checked=${this.withNarrative}
        ?disabled=${busy}
        @change=${(e: Event) => (this.withNarrative = (e.target as DcCheckbox).checked)}
        >${strings.plainCopyNarrative}</dc-checkbox
      >
      <p class="muted">${strings.plainCopyNarrativeLead}</p>
      ${this.lastCopyLine()}
      <div class="row">
        <dc-button variant="primary" ?disabled=${busy} @click=${() => void this.choosePlainCopyFolder()}>${strings.plainCopyMake}</dc-button>
      </div>
      ${noticeLine(this.store)}`
  }

  /** When this computer last made a copy, and whether records changed after it. */
  private lastCopyLine() {
    const last = this.lastCopy
    if (!last) return html`<p class="muted" data-role="plain-copy-last">${strings.plainCopyNever}</p>`
    const after = this.changesNow === undefined ? 0 : this.changesNow - last.changes
    return html`<p class="muted" data-role="plain-copy-last">${strings.plainCopyLast(last.at, last.folder, last.withNarrative)}</p>
      ${this.changesNow === undefined
        ? nothing
        : after > 0
          ? html`<dc-callout variant="warning" data-role="plain-copy-stale"><p>${strings.plainCopyStale(after)}</p></dc-callout>`
          : html`<p class="muted" data-role="plain-copy-fresh">${strings.plainCopyFresh}</p>`}`
  }

  /** The chosen form's list for a month, ready to copy. */
  private formDocument(title: string) {
    const store = this.store
    const busy = store.busy
    const table = this.exportTable
    return html`<dp-page-header eyebrow=${strings.exportTitle} heading=${title} description=${strings.exportLead}>
        <div slot="actions" class="row no-print">
          <dc-segmented-control
            size="sm"
            aria-label=${strings.periodKind}
            .options=${[{ value: 'month', label: strings.periodMonth }, { value: 'range', label: strings.periodRange }]}
            .value=${this.byRange ? 'range' : 'month'}
            ?disabled=${busy}
            @change=${(e: Event) => (this.byRange = (e.target as HTMLInputElement).value === 'range')}
          ></dc-segmented-control>
          ${this.byRange ? rangeFields(store) : periodFields(store)}
          <dc-button variant="primary" ?disabled=${busy} @click=${() => void this.runExport()}>${strings.makeExport}</dc-button>
          ${table && table.rows.length > 0
            ? html`<dc-button variant="secondary" ?disabled=${busy} @click=${() => void this.copyExport(table)}>${strings.copyExport}</dc-button>
                <dc-button variant="secondary" data-role="print" ?disabled=${busy} @click=${() => window.print()}>${strings.print}</dc-button>`
            : nothing}
        </div>
      </dp-page-header>
      ${formBehind(store.summary?.exports ?? [], store.exportKey)}
      ${noticeLine(store)}
      ${table ? this.tableView(table) : nothing}`
  }

  private tableView(table: ExportTable) {
    const gaps = table.pending.length + table.unmapped.length + table.conflicted.length
    return html`
      <p class="muted" data-role="export-period">${strings.exportPeriod(table.from, table.to, table.rows.length)}</p>
      ${gaps > 0 ? html`<dc-callout variant="warning" data-role="export-gaps"><p>${strings.exportGaps(table.pending.length, table.unmapped.length, table.conflicted.length)}</p></dc-callout>` : nothing}
      ${table.withheld.length > 0 ? html`<p class="muted" data-role="export-withheld">${strings.exportWithheld(table.withheld)}</p>` : nothing}
      ${table.rows.length === 0
        ? html`<p class="muted">${strings.exportEmpty}</p>`
        : html`<dc-card><div class="scroll">
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
          </div></dc-card>`}
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'oc-export': OcExport
  }
}
