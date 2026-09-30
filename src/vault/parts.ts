import { html, nothing } from 'lit'
import { open } from '@tauri-apps/plugin-dialog'
import type { FormEntry } from '../forms.js'
import type { VaultSummary } from '../shell.js'
import { strings } from '../strings.js'
import type { VaultStore } from './store.js'

/** A text field that submits on Enter. */
export function nameField(busy: boolean, label: string, value: string, set: (v: string) => void, submit: () => void) {
  return html`<label>
    ${label}
    <dc-input
      aria-label=${label}
      .value=${value}
      ?disabled=${busy}
      @input=${(e: Event) => set((e.target as HTMLInputElement).value)}
      @keydown=${(e: KeyboardEvent) => e.key === 'Enter' && !busy && submit()}
    ></dc-input>
  </label>`
}

/** The year and month the report and export screens work on. */
export function periodFields(store: VaultStore) {
  return html`<label>
      ${strings.year}
      <dc-input
        type="number"
        aria-label=${strings.year}
        min="2000"
        max="2100"
        .value=${String(store.year)}
        ?disabled=${store.busy}
        @input=${(e: Event) => store.set({ year: Number((e.target as HTMLInputElement).value) })}
      ></dc-input>
    </label>
    <label>
      ${strings.month}
      <dc-select
        aria-label=${strings.month}
        .options=${Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: strings.monthOption(i + 1) }))}
        .value=${String(store.month)}
        ?disabled=${store.busy}
        @change=${(e: Event) => store.set({ month: Number((e.target as HTMLSelectElement).value) })}
      ></dc-select>
    </label>`
}

/** The store's message, when there is one. */
export function noticeLine(store: VaultStore) {
  return store.notice ? html`<p role="status" class="muted">${store.notice}</p>` : nothing
}

/** Says so when the chosen form classifies by a scheme version older than the vault's latest. */
export function formBehind(forms: FormEntry[], key: string) {
  const chosen = forms.find((f) => `${f.name}@${f.version}` === key)
  if (!chosen || chosen.behind.length === 0) return nothing
  return html`<p class="muted" data-form-behind>${strings.formBehind(chosen.behind)}</p>`
}

/** Offers a folder picker and applies the data pack in the folder chosen. */
export function applyPackButton(store: VaultStore) {
  const pick = async () => {
    const folder = await open({ directory: true, title: strings.applyPackTitle })
    if (typeof folder === 'string') await store.applyPack(folder)
  }
  return html`<dc-button variant="secondary" ?disabled=${store.busy} @click=${() => void pick()}>${strings.applyPack}</dc-button>`
}

/** How a device reads to a person: its name, and which one is this computer. */
export function deviceLabel(summary: VaultSummary | undefined, device: string) {
  const name = summary?.devices[device]
  if (device === summary?.device) return name ? strings.thisDeviceNamed(name) : strings.thisDevice
  return name ?? strings.unnamedDevice(device)
}
