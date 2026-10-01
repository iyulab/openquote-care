import { LitElement, css, html, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { open } from '@tauri-apps/plugin-dialog'
import { describeError, isCommandError } from './errors.js'
import { IdleWatch, idleMinutes } from './idle.js'
import { createProblem, groupKey, KIT_TAIL, MIN_PASSPHRASE } from './flow.js'
import { shell, type TrackView } from './shell.js'
import { inAppLanguage, strings } from './strings.js'
import { dialogueMark, quoteMark } from './brand-mark.js'
import { errorCallout } from './vault/parts.js'
import './vault-view.js'

/**
 * Where the window is. A new vault passes through `kit` before it can be used: the shell keeps it
 * locked until the end of its key is typed back, and the window offers no way around that screen.
 */
type Screen =
  | { name: 'welcome' }
  | { name: 'create' }
  | { name: 'open'; locked?: boolean }
  | { name: 'kit'; key: string; folder: string }
  | { name: 'vault'; folder: string; withKey?: boolean; keyFileLost?: boolean; adopted?: string[]; backupCopy?: boolean }

@customElement('oc-app')
export class OcApp extends LitElement {
  static styles = css`
    :host {
      display: block;
      height: 100%;
    }
    h1,
    h2 {
      margin: 0;
      font-weight: 600;
    }
    p {
      margin: 0;
    }
    .muted {
      color: var(--dc-color-text-secondary, #5e5c57);
    }
    .row {
      display: flex;
      gap: var(--dc-space-2, 8px);
      align-items: center;
      flex-wrap: wrap;
    }
    .folder {
      font-family: var(--dc-font-mono, ui-monospace, monospace);
      font-size: 12px;
      word-break: break-all;
    }
    .key {
      font-family: var(--dc-font-mono, ui-monospace, monospace);
      font-size: 15px;
      line-height: 1.8;
      padding: var(--dc-space-3, 12px) var(--dc-space-4, 16px);
      border-radius: var(--dc-radius-md, 6px);
      background: var(--dc-color-secondary-subtle, #eef2ff);
      color: var(--dc-color-text, #1a1a1e);
      user-select: all;
      word-spacing: 0.4em;
    }
    .stack {
      display: flex;
      flex-direction: column;
      gap: var(--dc-space-4, 16px);
    }
    .center {
      max-width: 560px;
      margin: 0 auto;
      padding: 56px var(--dc-space-4, 16px);
      display: flex;
      flex-direction: column;
      gap: var(--dc-space-4, 16px);
    }
    .center dc-card {
      --dc-card-elevation: var(--dc-elevation-2);
    }
    .welcome {
      display: grid;
      grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
      min-height: 100%;
    }
    .hero {
      display: flex;
      flex-direction: column;
      gap: var(--dc-space-5, 20px);
      padding: 56px;
    }
    .product {
      display: flex;
      align-items: center;
      gap: var(--dc-space-2, 8px);
    }
    .product h1 {
      margin: 0;
      font-size: var(--dc-font-size-lg, 15px);
      font-weight: var(--dc-font-weight-semibold, 600);
    }
    .lead-title {
      font-size: 30px;
      font-weight: var(--dc-font-weight-bold, 700);
      line-height: var(--dc-line-height-tight, 1.3);
      letter-spacing: -0.02em;
      text-wrap: balance;
    }
    .lead {
      max-width: 34em;
      font-size: var(--dc-font-size-lg, 15px);
      color: var(--dc-color-text-secondary, #55555c);
    }
    .facts {
      display: flex;
      flex-wrap: wrap;
      gap: var(--dc-space-2, 8px);
      margin-top: auto;
    }
    .side {
      display: grid;
      align-content: center;
      gap: var(--dc-space-4, 16px);
      padding: 40px;
      background: var(--oq-sidebar, var(--dc-color-surface, #f7f7f8));
      border-left: 1px solid var(--dc-color-rule, #e2e2e4);
    }
    .side dc-card {
      --dc-card-elevation: var(--dc-elevation-2);
    }
    @media (max-width: 1023px) {
      .welcome {
        grid-template-columns: 1fr;
      }
      .side {
        border-left: 0;
        border-top: 1px solid var(--dc-color-rule, #e2e2e4);
      }
    }
    ul {
      margin: 0;
      padding-left: 1.2em;
      display: flex;
      flex-direction: column;
      gap: var(--dc-space-1, 4px);
    }
    .detail {
      font-size: 12px;
    }
    /* A space to write on once printed: where the backup folder is, chosen after the kit. */
    .write-in-line {
      height: 2.5em;
      border-bottom: 1px solid currentColor;
    }
    @media print {
      .no-print,
      [slot='footer'] {
        display: none;
      }
      .key {
        background: none;
        border: 1px solid #000;
      }
    }
  `

  @state() private screen: Screen = { name: 'welcome' }
  @state() private folder?: string
  @state() private passphrase = ''
  @state() private again = ''
  /** The tracks a new vault can be made on, and the one chosen. */
  @state() private tracks: TrackView[] = []
  @state() private track = ''
  @state() private tail = ''
  /** Whether the open screen takes the recovery key instead of the passphrase. */
  @state() private withKey = false
  @state() private recoveryKey = ''
  /** The folder chosen to open lost its vault declaration but still holds its key file. */
  @state() private declarationMissing = false
  @state() private busy = false
  @state() private error?: { text: string; detail?: string }
  /** Whether this installation reports the app's own errors; the first screen says so. */
  @state() private diagnostics = false
  private idle?: IdleWatch
  private readonly touch = () => this.idle?.touch()

  connectedCallback() {
    super.connectedCallback()
    shell.diagnosticsEnabled().then(
      (on) => (this.diagnostics = on),
      () => {},
    )
    for (const type of ['pointerdown', 'keydown', 'wheel', 'pointermove']) window.addEventListener(type, this.touch, { passive: true })
  }

  disconnectedCallback() {
    for (const type of ['pointerdown', 'keydown', 'wheel', 'pointermove']) window.removeEventListener(type, this.touch)
    this.idle?.stop()
    super.disconnectedCallback()
  }

  /** Watches for an idle window while a vault is open, with this computer's idle lock. */
  private armIdle() {
    this.idle?.stop()
    this.idle = this.screen.name === 'vault' ? new IdleWatch(idleMinutes(), () => void this.lock()) : undefined
  }

  /**
   * Locks the open vault: the shell drops its key and the engine's copy of every record, as when
   * closing, and the window asks for the passphrase again for the same folder. Whatever was being
   * typed and not yet recorded is lost, as it would be on closing.
   */
  private async lock() {
    if (this.screen.name !== 'vault') return
    const folder = this.screen.folder
    await this.run(async () => {
      await shell.closeVault()
      this.go({ name: 'open', locked: true })
      this.folder = folder
    })
  }

  private go(screen: Screen) {
    if (screen.name === 'create') void this.loadTracks()
    this.screen = screen
    this.folder = undefined
    this.passphrase = ''
    this.again = ''
    this.tail = ''
    this.withKey = false
    this.recoveryKey = ''
    this.declarationMissing = false
    this.error = undefined
    this.armIdle()
  }

  private async pickFolder(title: string) {
    const path = await open({ directory: true, title })
    if (typeof path === 'string') {
      this.folder = path
      this.declarationMissing = false
    }
  }

  /** Runs one shell call with the busy flag up, showing its failure instead of throwing. */
  private async run(action: () => Promise<void>) {
    this.busy = true
    this.error = undefined
    try {
      await action()
    } catch (e) {
      this.error = describeError(e)
    } finally {
      this.busy = false
    }
  }

  /** The tracks to offer, the suggested one chosen; a bundle that cannot be read leaves the choice to the shell. */
  private async loadTracks() {
    this.tracks = await shell.tracks().catch(() => [])
    this.track = this.tracks[0]?.id ?? ''
  }

  private async create() {
    const problem = createProblem(this.folder, this.passphrase, this.again)
    if (problem) {
      const words = strings.problems[problem]
      this.error = { text: typeof words === 'function' ? words(MIN_PASSPHRASE) : words }
      return
    }
    const folder = this.folder!
    await this.run(async () => {
      const key = await shell.createVault(folder, this.passphrase, this.track || undefined)
      this.go({ name: 'kit', key, folder })
    })
  }

  private async confirmKit(folder: string) {
    await this.run(async () => {
      await shell.confirmRecoveryKit(this.tail)
      // The key leaves the window's state here; only the printed kit keeps it.
      this.go({ name: 'vault', folder })
    })
  }

  private async openVault() {
    if (!this.folder) {
      this.error = { text: strings.problems['no-folder'] }
      return
    }
    const folder = this.folder
    await this.run(async () => {
      const withKey = this.withKey
      const summary = await (withKey ? shell.openVaultWithKey(folder, this.recoveryKey) : shell.openVault(folder, this.passphrase)).catch((e: unknown) => {
        // With the key file damaged or gone, the passphrase cannot open the vault: the recovery key is what is asked next.
        if (!withKey && isCommandError(e) && e.code === 'damaged-key-file') this.withKey = true
        this.declarationMissing = isCommandError(e) && e.code === 'declaration-missing'
        throw e
      })
      const adopted = summary.adopted ? [inAppLanguage(summary.adopted.label, summary.adopted.track)] : undefined
      this.go({ name: 'vault', folder, withKey, keyFileLost: summary.keyFileLost === true, adopted, backupCopy: summary.backupCopy === true })
    })
  }

  /** Writes back the declaration the chosen folder lost, then opens it as asked. */
  private async restoreDeclarationAndOpen() {
    const folder = this.folder
    if (!folder) return
    await this.run(async () => {
      await shell.restoreDeclaration(folder)
      this.declarationMissing = false
    })
    if (!this.declarationMissing && !this.error) await this.openVault()
  }

  /** Closes the vault, or drops a new one still waiting on its kit: nothing of it was written. */
  private async closeVault() {
    await this.run(async () => {
      await shell.closeVault()
      this.go({ name: 'welcome' })
    })
  }

  private onEnter(e: KeyboardEvent, action: () => void) {
    if (e.key === 'Enter' && !this.busy) action()
  }

  render() {
    const s = this.screen
    if (s.name === 'vault') {
      return html`<oc-vault
        .folder=${s.folder}
        .openedWithKey=${s.withKey ?? false}
        .keyFileLost=${s.keyFileLost ?? false}
        .adopted=${s.adopted ?? []}
        .backupCopy=${s.backupCopy ?? false}
        @oc-close=${() => void this.closeVault()}
        @oc-lock=${() => void this.lock()}
        @oc-idle-changed=${() => this.armIdle()}
      ></oc-vault>`
    }
    if (s.name === 'welcome') return html`<div class="welcome">${this.welcome()}</div>`
    return html`<dp-page><div class="center">${this.body()}${errorCallout(this.error)}</div></dp-page>`
  }

  private body() {
    const s = this.screen
    switch (s.name) {
      case 'create':
        return this.createForm()
      case 'open':
        return this.openForm()
      case 'kit':
        return this.kit(s.key, s.folder)
      case 'welcome':
      case 'vault':
        return nothing
    }
  }

  private welcome() {
    return html`
      <div class="hero">
        <div class="product">${quoteMark(18)}<h1>${strings.appName}</h1></div>
        <span class="mark">${dialogueMark(132)}</span>
        <p class="lead-title">${strings.tagline}</p>
        <p class="lead">${strings.welcomeLead}</p>
        <div class="facts">${strings.welcomeFacts.map((f) => html`<dc-badge>${f}</dc-badge>`)}</div>
      </div>
      <div class="side">
        ${errorCallout(this.error)}
        <dc-card>
          <span slot="header">${strings.openVault}</span>
          <p class="muted">${strings.welcomeOpenLead}</p>
          <dc-button slot="footer" variant="primary" @click=${() => this.go({ name: 'open' })}>${strings.openVault}</dc-button>
        </dc-card>
        <dc-button variant="secondary" @click=${() => this.go({ name: 'create' })}>${strings.createVault}</dc-button>
        ${this.diagnostics ? html`<p class="muted detail" data-role="diagnostics">${strings.diagnosticsNotice}</p>` : nothing}
      </div>
    `
  }

  private folderField(title: string) {
    return html`
      <div class="row">
        <dc-button variant="secondary" ?disabled=${this.busy} @click=${() => this.pickFolder(title)}>${strings.pickFolder}</dc-button>
        <span class="folder ${this.folder ? '' : 'muted'}" data-role="folder">${this.folder ?? strings.noFolder}</span>
      </div>
    `
  }

  private passphraseField(label: string, value: string, set: (v: string) => void, submit: () => void, hint?: string) {
    return html`<dc-field label=${label} hint=${hint ?? ''}>
      <dc-input
        type="password"
        aria-label=${label}
        .value=${value}
        ?disabled=${this.busy}
        @input=${(e: Event) => set((e.target as HTMLInputElement).value)}
        @keydown=${(e: KeyboardEvent) => this.onEnter(e, submit)}
      ></dc-input>
    </dc-field>`
  }

  private actions(label: string, action: () => void) {
    return html`
      <dc-button slot="footer" variant="ghost" ?disabled=${this.busy} @click=${() => this.go({ name: 'welcome' })}>${strings.back}</dc-button>
      <dc-button slot="footer" variant="primary" ?disabled=${this.busy} @click=${action}>${this.busy ? strings.working : label}</dc-button>
    `
  }

  private createForm() {
    const submit = () => void this.create()
    return html`<dc-card>
      <h2 slot="header">${strings.createVault}</h2>
      <div class="stack">
        ${this.folderField(strings.pickCreateFolderTitle)}
        ${this.passphraseField(strings.passphrase, this.passphrase, (v) => (this.passphrase = v), submit)}
        ${this.passphraseField(strings.passphraseAgain, this.again, (v) => (this.again = v), submit, strings.passphraseHint(MIN_PASSPHRASE))}
        ${this.tracks.length > 1
          ? html`<dc-field label=${strings.track} hint=${strings.trackHint}>
              <dc-select
                aria-label=${strings.track}
                .options=${this.tracks.map((t) => ({ value: t.id, label: t.label }))}
                .value=${this.track}
                ?disabled=${this.busy}
                @change=${(e: Event) => (this.track = (e.target as HTMLSelectElement).value)}
              ></dc-select>
            </dc-field>`
          : nothing}
      </div>
      ${this.actions(strings.create, submit)}
    </dc-card>`
  }

  private openForm() {
    const submit = () => void this.openVault()
    return html`<dc-card>
      <h2 slot="header">${strings.openVault}</h2>
      <div class="stack">
        ${this.screen.name === 'open' && this.screen.locked ? html`<dc-callout role="status" data-role="locked"><p>${strings.locked}</p></dc-callout>` : nothing}
        ${this.folderField(strings.pickOpenFolderTitle)}
        ${this.withKey
          ? html`<dc-field label=${strings.recoveryKey} hint=${strings.recoveryKeyHint}>
              <dc-input
                aria-label=${strings.recoveryKey}
                .value=${this.recoveryKey}
                ?disabled=${this.busy}
                @input=${(e: Event) => (this.recoveryKey = (e.target as HTMLInputElement).value)}
                @keydown=${(e: KeyboardEvent) => this.onEnter(e, submit)}
              ></dc-input>
            </dc-field>`
          : this.passphraseField(strings.passphrase, this.passphrase, (v) => (this.passphrase = v), submit)}
        ${this.declarationMissing
          ? html`<div class="row" data-role="restore-declaration">
              <dc-button variant="secondary" ?disabled=${this.busy} @click=${() => void this.restoreDeclarationAndOpen()}>${strings.restoreDeclaration}</dc-button>
            </div>`
          : nothing}
        <div class="row">
          <dc-button variant="ghost" ?disabled=${this.busy} @click=${() => (this.withKey = !this.withKey)}
            >${this.withKey ? strings.openWithPassphrase : strings.openWithKey}</dc-button
          >
        </div>
      </div>
      ${this.actions(strings.open, submit)}
    </dc-card>`
  }

  private kit(key: string, folder: string) {
    const submit = () => void this.confirmKit(folder)
    return html`<dc-card>
      <h2 slot="header">${strings.kitTitle}</h2>
      <div class="stack">
        <p>${strings.kitLead}</p>
        <p class="folder">${folder}</p>
        <div>
          <p class="muted">${strings.kitKey}</p>
          <div class="key" data-role="key">${groupKey(key).join(' ')}</div>
        </div>
        <dc-callout variant="warning">
          <ul>
            ${strings.kitWarnings.map((w) => html`<li>${w}</li>`)}
          </ul>
        </dc-callout>
        <p class="muted">${strings.kitWithoutApp}</p>
        <p class="muted">${strings.kitPassphraseChange}</p>
        <div class="write-in" data-role="kit-backup">
          <p class="muted">${strings.kitBackupWriteIn}</p>
          <div class="write-in-line"></div>
        </div>
        <div class="row no-print">
          <dc-button variant="secondary" @click=${() => window.print()}>${strings.print}</dc-button>
        </div>
        <dc-field class="no-print" label=${strings.kitConfirmLabel(KIT_TAIL)}>
          <dc-input
            aria-label=${strings.kitConfirmLabel(KIT_TAIL)}
            .value=${this.tail}
            ?disabled=${this.busy}
            @input=${(e: Event) => (this.tail = (e.target as HTMLInputElement).value)}
            @keydown=${(e: KeyboardEvent) => this.onEnter(e, submit)}
          ></dc-input>
        </dc-field>
      </div>
      <dc-button slot="footer" class="no-print" variant="ghost" ?disabled=${this.busy} @click=${() => void this.closeVault()}>${strings.cancel}</dc-button>
      <dc-button slot="footer" class="no-print" variant="primary" ?disabled=${this.busy} @click=${submit}>${strings.kitConfirm}</dc-button>
    </dc-card>`
  }

}

declare global {
  interface HTMLElementTagNameMap {
    'oc-app': OcApp
  }
}
