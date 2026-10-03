import { html, nothing } from 'lit'
import { open } from '@tauri-apps/plugin-dialog'
import { yearStart, type FormEntry } from '../forms.js'
import { today, yearAround, type Entity } from '../records.js'
import type { VaultSummary } from '../shell.js'
import { strings } from '../strings.js'
import type { VaultStore } from './store.js'

/** A text field that submits on Enter. */
export function nameField(busy: boolean, label: string, value: string, set: (v: string) => void, submit: () => void) {
  return html`<dc-field label=${label}>
    <dc-input
      aria-label=${label}
      .value=${value}
      ?disabled=${busy}
      @input=${(e: Event) => set((e.target as HTMLInputElement).value)}
      @keydown=${(e: KeyboardEvent) => e.key === 'Enter' && !busy && submit()}
    ></dc-input>
  </dc-field>`
}

/** How many sessions each id appears in, by the ids a session names. */
export function countBy(sessions: Entity[], ids: (s: Entity) => readonly string[]) {
  const counts = new Map<string, number>()
  for (const s of sessions) for (const id of ids(s)) counts.set(id, (counts.get(id) ?? 0) + 1)
  return counts
}

/** One entry of a screen's list: what it picks (also its `data-entry`), what it reads as, and a line about it. */
export interface ListEntry {
  id: string
  label: string
  meta?: string
}

/** One entry of a list: its name, and a line about it under the name when there is one. */
export function listEntry(e: ListEntry, selected: string | undefined, select: (id: string) => void) {
  return html`<li>
    <button data-entry=${e.id} aria-current=${e.id === selected ? 'true' : 'false'} @click=${() => select(e.id)}
      ><span class="label">${e.label}</span>${e.meta ? html`<span class="meta">${e.meta}</span>` : nothing}</button
    >
  </li>`
}

/**
 * A screen as a list beside the document of the one picked from it: the list only picks (anything
 * that adds to it is a button above it, opening its form as the document), and each side scrolls on
 * its own. While the window is narrow one side shows at a time, and the document has a way back.
 */
export function listDetail(o: {
  label: string
  head?: unknown
  entries: ListEntry[]
  selected?: string
  select: (id: string) => void
  empty: string
  document: unknown
  open: boolean
  back: () => void
}) {
  return html`<dp-list-detail ?detail-open=${o.open}>
    <nav slot="list" class="pane list" aria-label=${o.label}>
      ${o.head ? html`<div class="list-head">${o.head}</div>` : nothing}
      ${o.entries.length === 0
        ? html`<dc-empty-state description=${o.empty}></dc-empty-state>`
        : html`<ul>
            ${o.entries.map((e) => listEntry(e, o.selected, o.select))}
          </ul>`}
    </nav>
    <section class="pane document">
      <div class="back"><dc-button variant="ghost" size="sm" @click=${o.back}>${strings.backToList}</dc-button></div>
      ${o.document}
    </section>
  </dp-list-detail>`
}

/** The year and month the report and export screens work on. */
export function periodFields(store: VaultStore) {
  return html`<dc-field label=${strings.year}>
      <dc-input
        type="number"
        aria-label=${strings.year}
        min="2000"
        max="2100"
        .value=${String(store.year)}
        ?disabled=${store.busy}
        @input=${(e: Event) => store.set({ year: Number((e.target as HTMLInputElement).value) })}
      ></dc-input>
    </dc-field>
    <dc-field label=${strings.month}>
      <dc-select
        aria-label=${strings.month}
        .options=${Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: strings.monthOption(i + 1) }))}
        .value=${String(store.month)}
        ?disabled=${store.busy}
        @change=${(e: Event) => store.set({ month: Number((e.target as HTMLSelectElement).value) })}
      ></dc-select>
    </dc-field>`
}

/**
 * The first and last day of a period a person picks, and a quick pick of this year or the last one —
 * named apart when the vault's year forms start in another month than January.
 */
export function rangeFields(store: VaultStore) {
  const date = (label: string, value: string, set: (v: string) => void) => html`<dc-field label=${label}>
    <dc-input type="date" aria-label=${label} .value=${value} ?disabled=${store.busy} @input=${(e: Event) => set((e.target as HTMLInputElement).value)}></dc-input>
  </dc-field>`
  const start = yearStart(store.summary?.reports ?? [])
  const quick = (role: string, label: string, back: boolean) => html`<dc-button
    variant="ghost"
    size="sm"
    data-role=${role}
    ?disabled=${store.busy}
    @click=${() => {
      const { from, to } = yearAround(start, today(), back)
      store.set({ rangeFrom: from, rangeTo: to })
    }}
    >${label}</dc-button
  >`
  return html`${date(strings.rangeFrom, store.rangeFrom, (rangeFrom) => store.set({ rangeFrom }))}
    ${date(strings.rangeTo, store.rangeTo, (rangeTo) => store.set({ rangeTo }))}
    ${quick('this-year', strings.thisYear(start !== 1), false)} ${quick('last-year', strings.lastYear(start !== 1), true)}`
}

/** The store's message, when there is one. */
export function noticeLine(store: VaultStore) {
  return store.notice ? html`<dc-callout role="status"><p>${store.notice}</p></dc-callout>` : nothing
}

/** A failure, said where it happened: a danger callout the screen reader announces. */
export function errorCallout(error: { text: string; detail?: string } | undefined) {
  if (!error) return nothing
  return html`<dc-callout variant="danger" role="alert">
    <p>${error.text}</p>
    ${error.detail ? html`<p class="detail">${strings.errorDetail(error.detail)}</p>` : nothing}
  </dc-callout>`
}

/** Says so when the chosen form classifies by a scheme version older than the vault's latest. */
export function formBehind(forms: FormEntry[], key: string, schemeName: (scheme: string) => string) {
  const chosen = forms.find((f) => `${f.name}@${f.version}` === key)
  if (!chosen || chosen.behind.length === 0) return nothing
  const lags = chosen.behind.map((l) => ({ name: schemeName(l.scheme), version: l.version, latest: l.latest }))
  return html`<p class="muted" data-form-behind>${strings.formBehind(lags)}</p>`
}

/** Offers a folder picker and applies the data pack in the folder chosen. */
export function applyPackButton(store: VaultStore) {
  const pick = async () => {
    const folder = await open({ directory: true, title: strings.applyPackTitle })
    if (typeof folder === 'string') await store.applyPack(folder)
  }
  const folder = store.raiseFormatFor
  // This device and every other the vault names, this one first: each must run a version that reads the newer format.
  const summary = store.summary
  const others = Object.keys(summary?.devices ?? {}).filter((d) => d !== summary?.device)
  const devices = summary ? [summary.device, ...others].map((d) => deviceLabel(summary, d)) : []
  return html`<dc-button variant="secondary" ?disabled=${store.busy} @click=${() => void pick()}>${strings.applyPack}</dc-button>
    ${folder === undefined
      ? nothing
      : html`<dc-callout variant="warning" data-role="raise-format">
          <p>${strings.raiseFormatAsk}</p>
          ${devices.length === 0 ? nothing : html`<p data-role="raise-format-devices">${strings.raiseFormatDevices(devices)}</p>`}
          <dc-button slot="actions" variant="primary" ?disabled=${store.busy} data-role="raise-format-confirm" @click=${() => void store.applyPack(folder, true)}>${strings.raiseFormatConfirm}</dc-button>
          <dc-button slot="actions" variant="secondary" ?disabled=${store.busy} @click=${() => store.set({ raiseFormatFor: undefined })}>${strings.cancel}</dc-button>
        </dc-callout>`}`
}

/** How a device reads to a person: its name, and which one is this computer. */
export function deviceLabel(summary: VaultSummary | undefined, device: string) {
  const name = summary?.devices[device]
  if (device === summary?.device) return name ? strings.thisDeviceNamed(name) : strings.thisDevice
  return name ?? strings.unnamedDevice(device)
}
