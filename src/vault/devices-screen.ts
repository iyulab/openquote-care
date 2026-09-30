import { html, nothing, type PropertyValues } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { MIN_PASSPHRASE, passphraseProblem } from '../flow.js'
import { IDLE_CHOICES, idleMinutes, setIdleMinutes } from '../idle.js'
import { shell, type VaultSummary } from '../shell.js'
import { strings } from '../strings.js'
import { deviceLabel, nameField, noticeLine } from './parts.js'
import { VaultScreen } from './screen.js'

/** This computer in the vault: its name, the devices writing to the vault, the idle lock and the passphrase. */
@customElement('oc-devices')
export class OcDevices extends VaultScreen {
  /** Opened with the recovery key: the person may have forgotten the passphrase. */
  @property({ type: Boolean }) openedWithKey = false

  @state() private deviceName = ''
  @state() private idleChoice = idleMinutes()
  @state() private newPassphrase = ''
  @state() private newPassphraseAgain = ''
  @state() private passphraseNotice = ''
  /** The summary the device name last followed. */
  private seen?: VaultSummary

  protected willUpdate(changed: PropertyValues<this>) {
    super.willUpdate(changed)
    const summary = this.store.summary
    if (summary === this.seen) return
    // Keep a name the person is typing; follow the saved one otherwise.
    const savedName = this.seen?.devices[this.seen.device] ?? ''
    if (summary && this.deviceName === savedName) this.deviceName = summary.devices[summary.device] ?? ''
    this.seen = summary
  }

  private async saveDeviceName() {
    const store = this.store
    store.set({ notice: '' })
    await store.run(async () => {
      await shell.record('/changes/device-name', { name: this.deviceName.trim() })
      await store.load()
      store.notice = strings.deviceNameSaved
    })
  }

  private async changePassphrase() {
    this.passphraseNotice = ''
    const problem = passphraseProblem(this.newPassphrase, this.newPassphraseAgain)
    if (problem) return this.store.problem(problem, MIN_PASSPHRASE)
    await this.store.run(async () => {
      await shell.changePassphrase(this.newPassphrase)
      this.newPassphrase = ''
      this.newPassphraseAgain = ''
      // The frame stops offering a new passphrase once one is set.
      this.dispatchEvent(new Event('oc-passphrase-changed'))
      this.passphraseNotice = strings.passphraseChanged
    })
  }

  private chooseIdle(minutes: number) {
    setIdleMinutes(minutes)
    this.idleChoice = minutes
    this.dispatchEvent(new Event('oc-idle-changed', { bubbles: true, composed: true }))
  }

  private passphraseInput(label: string, value: string, set: (v: string) => void, submit: () => void) {
    const busy = this.store.busy
    return html`<label>
      ${label}
      <dc-input
        type="password"
        aria-label=${label}
        .value=${value}
        ?disabled=${busy}
        @input=${(e: Event) => set((e.target as HTMLInputElement).value)}
        @keydown=${(e: KeyboardEvent) => e.key === 'Enter' && !busy && submit()}
      ></dc-input>
    </label>`
  }

  protected screen() {
    const { busy, summary } = this.store
    const save = () => void this.saveDeviceName()
    const change = () => void this.changePassphrase()
    const label = (d: string) => deviceLabel(summary, d)
    const named = Object.keys(summary?.devices ?? {}).sort((a, b) => this.store.names.compare(label(a), label(b)))
    return html`<section>
      <p class="muted">${strings.devicesLead}</p>
      <div class="row">
        ${nameField(busy, strings.deviceName, this.deviceName, (v) => (this.deviceName = v), save)}
        <dc-button variant="secondary" ?disabled=${busy} @click=${save}>${strings.saveDeviceName}</dc-button>
      </div>
      ${noticeLine(this.store)}
      <h3>${strings.knownDevices}</h3>
      ${named.length === 0
        ? html`<p class="muted">${strings.noNamedDevices}</p>`
        : html`<ul class="plain" aria-label=${strings.knownDevices}>
            ${named.map((d) => html`<li data-device=${d}>${label(d)}</li>`)}
          </ul>`}
      <h3>${strings.idleLock}</h3>
      <div class="row" data-role="idle-lock">
        <label>
          ${strings.idleLock}
          <dc-select
            aria-label=${strings.idleLock}
            .options=${IDLE_CHOICES.map((m) => ({ value: String(m), label: strings.idleOption(m) }))}
            .value=${String(this.idleChoice)}
            @change=${(e: Event) => this.chooseIdle(Number((e.target as HTMLSelectElement).value))}
          ></dc-select>
        </label>
      </div>
      <p class="muted">${strings.idleLockLead}</p>
      <h3>${strings.changePassphrase}</h3>
      ${this.openedWithKey ? html`<p class="muted" role="status">${strings.openedWithKey}</p>` : nothing}
      <p class="muted">${strings.changePassphraseLead}</p>
      <div class="row" data-role="change-passphrase">
        ${this.passphraseInput(strings.newPassphrase, this.newPassphrase, (v) => (this.newPassphrase = v), change)}
        ${this.passphraseInput(strings.newPassphraseAgain, this.newPassphraseAgain, (v) => (this.newPassphraseAgain = v), change)}
        <dc-button variant="secondary" ?disabled=${busy} @click=${change}>${strings.changePassphrase}</dc-button>
      </div>
      <p class="muted">${strings.passphraseHint(MIN_PASSPHRASE)}</p>
      ${this.passphraseNotice ? html`<p role="status" class="muted" data-role="passphrase-changed">${this.passphraseNotice}</p>` : nothing}
    </section>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'oc-devices': OcDevices
  }
}
