import { open } from '@tauri-apps/plugin-dialog'
import { html, nothing, type PropertyValues } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { storedBackup } from '../backup.js'
import { MIN_PASSPHRASE, passphraseProblem } from '../flow.js'
import { IDLE_CHOICES, idleMinutes, setIdleMinutes } from '../idle.js'
import { shell, type VaultSummary } from '../shell.js'
import { strings } from '../strings.js'
import { deviceLabel, listDetail, nameField, noticeLine } from './parts.js'
import { VaultScreen } from './screen.js'

/** What the devices screen lists to pick from: its settings, each a document of its own. */
export type DeviceSection = 'name' | 'idle' | 'backup' | 'passphrase'

/** This computer in the vault: its name, the devices writing to the vault, the idle lock, the backup and the passphrase. */
@customElement('oc-devices')
export class OcDevices extends VaultScreen {
  /** Opened with the recovery key: the person may have forgotten the passphrase. */
  @property({ type: Boolean }) openedWithKey = false

  @state() private deviceName = ''
  @state() private idleChoice = idleMinutes()
  @state() private newPassphrase = ''
  @state() private newPassphraseAgain = ''
  @state() private passphraseNotice = ''
  @state() private section: DeviceSection = 'name'
  /** While the window is narrow: the document shows instead of the list. */
  @state() private documentOpen = false
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

  /** Opens one setting's document (what the frame's hints lead to). */
  show(section: DeviceSection) {
    this.section = section
    this.documentOpen = true
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

  private async chooseBackup() {
    const folder = await open({ directory: true, title: strings.backupPickTitle })
    if (typeof folder === 'string') await this.store.setBackup(folder)
  }

  /** Where the backup is kept and how the last one went, in words. */
  private backupSection() {
    const { busy, backup, backupProblem } = this.store
    const folder = backup.folder ?? (backupProblem ? storedBackup(this.store.folder) : null)
    const reason = (code: string) => (strings.errors as Record<string, string>)[code] ?? strings.errors.unknown
    const lines = !folder
      ? [html`<p class="muted" data-role="backup-status">${strings.backupOff}</p>`]
      : [
          html`<p data-role="backup-folder">${strings.backupTo(folder)}</p>`,
          backupProblem
            ? html`<p class="error" data-role="backup-status">${strings.backupFailed(reason(backupProblem))}</p>`
            : backup.error
              ? html`<p class="error" data-role="backup-status">${strings.backupFailed(reason(backup.error))}</p>`
              : backup.at !== undefined
                ? html`<p class="muted" data-role="backup-status">${strings.backupDone(new Date(backup.at).toLocaleString(), backup.copied ?? 0)}</p>`
                : nothing,
          backup.differs?.length ? html`<p class="error" data-role="backup-differs">${strings.backupDiffers(backup.differs.length)}</p>` : nothing,
        ]
    return html`<h2>${strings.backup}</h2>
      <p class="muted">${strings.backupLead}</p>
      ${lines}
      <div class="row" data-role="backup">
        <dc-button variant="secondary" ?disabled=${busy} @click=${() => void this.chooseBackup()}>${strings.backupChoose}</dc-button>
        ${folder ? html`<dc-button variant="secondary" ?disabled=${busy} @click=${() => void this.store.setBackup(null)}>${strings.backupStop}</dc-button>` : nothing}
      </div>`
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
    const sections: { id: DeviceSection; label: string }[] = [
      { id: 'name', label: strings.deviceName },
      { id: 'idle', label: strings.idleLock },
      { id: 'backup', label: strings.backup },
      { id: 'passphrase', label: strings.passphraseSection },
    ]
    const document = { name: () => this.nameSection(), idle: () => this.idleSection(), backup: () => this.backupSection(), passphrase: () => this.passphraseSection() }
    return listDetail({
      label: strings.settingsList,
      entries: sections,
      selected: this.section,
      select: (id) => this.show(id as DeviceSection),
      empty: '',
      document: document[this.section](),
      open: this.documentOpen,
      back: () => (this.documentOpen = false),
    })
  }

  /** This computer's name, and the names of every device writing to the vault. */
  private nameSection() {
    const { busy, summary } = this.store
    const save = () => void this.saveDeviceName()
    const label = (d: string) => deviceLabel(summary, d)
    const named = Object.keys(summary?.devices ?? {}).sort((a, b) => this.store.names.compare(label(a), label(b)))
    return html`<h2>${strings.deviceName}</h2>
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
          </ul>`}`
  }

  private idleSection() {
    return html`<h2>${strings.idleLock}</h2>
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
      <p class="muted">${strings.idleLockLead}</p>`
  }

  private passphraseSection() {
    const busy = this.store.busy
    const change = () => void this.changePassphrase()
    return html`<h2>${strings.changePassphrase}</h2>
      ${this.openedWithKey ? html`<p class="muted" role="status">${strings.openedWithKey}</p>` : nothing}
      <p class="muted">${strings.changePassphraseLead}</p>
      <div class="row" data-role="change-passphrase">
        ${this.passphraseInput(strings.newPassphrase, this.newPassphrase, (v) => (this.newPassphrase = v), change)}
        ${this.passphraseInput(strings.newPassphraseAgain, this.newPassphraseAgain, (v) => (this.newPassphraseAgain = v), change)}
        <dc-button variant="secondary" ?disabled=${busy} @click=${change}>${strings.changePassphrase}</dc-button>
      </div>
      <p class="muted">${strings.passphraseHint(MIN_PASSPHRASE)}</p>
      ${this.passphraseNotice ? html`<p role="status" class="muted" data-role="passphrase-changed">${this.passphraseNotice}</p>` : nothing}`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'oc-devices': OcDevices
  }
}
