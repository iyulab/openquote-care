import { LitElement, css, html, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { open } from '@tauri-apps/plugin-dialog'
import { describeError } from './errors.js'
import { createProblem, groupKey, KIT_TAIL, MIN_PASSPHRASE } from './flow.js'
import { shell } from './shell.js'
import { strings } from './strings.js'
import './vault-view.js'

/**
 * Where the window is. A new vault passes through `kit` before it can be used: the shell keeps it
 * locked until the end of its key is typed back, and the window offers no way around that screen.
 */
type Screen =
  | { name: 'welcome' }
  | { name: 'create' }
  | { name: 'open' }
  | { name: 'kit'; key: string; folder: string }
  | { name: 'vault'; folder: string }

@customElement('oc-app')
export class OcApp extends LitElement {
  static styles = css`
    :host {
      display: block;
      height: 100%;
    }
    .center {
      max-width: 560px;
      margin: 0 auto;
      padding: var(--dc-space-6, 32px) var(--dc-space-4, 16px);
      display: flex;
      flex-direction: column;
      gap: var(--dc-space-4, 16px);
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
    label {
      display: flex;
      flex-direction: column;
      gap: var(--dc-space-1, 4px);
      font-size: 13px;
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
      padding: var(--dc-space-3, 12px);
      border: 1px solid var(--dc-color-border, #ddd);
      border-radius: var(--dc-radius-md, 6px);
      user-select: all;
      word-spacing: 0.4em;
    }
    ul {
      margin: 0;
      padding-left: 1.2em;
      display: flex;
      flex-direction: column;
      gap: var(--dc-space-1, 4px);
    }
    .error {
      color: var(--dc-color-danger, #b00020);
    }
    .detail {
      font-size: 12px;
    }
    @media print {
      .no-print {
        display: none;
      }
    }
  `

  @state() private screen: Screen = { name: 'welcome' }
  @state() private folder?: string
  @state() private passphrase = ''
  @state() private again = ''
  @state() private tail = ''
  @state() private busy = false
  @state() private error?: { text: string; detail?: string }

  private go(screen: Screen) {
    this.screen = screen
    this.folder = undefined
    this.passphrase = ''
    this.again = ''
    this.tail = ''
    this.error = undefined
  }

  private async pickFolder(title: string) {
    const path = await open({ directory: true, title })
    if (typeof path === 'string') this.folder = path
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

  private async create() {
    const problem = createProblem(this.folder, this.passphrase, this.again)
    if (problem) {
      const words = strings.problems[problem]
      this.error = { text: typeof words === 'function' ? words(MIN_PASSPHRASE) : words }
      return
    }
    const folder = this.folder!
    await this.run(async () => {
      const key = await shell.createVault(folder, this.passphrase)
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
      await shell.openVault(folder, this.passphrase)
      this.go({ name: 'vault', folder })
    })
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
        @oc-close=${() => void this.closeVault()}
      ></oc-vault>`
    }
    return html`<dp-page><div class="center">${this.body()}${this.errorLine()}</div></dp-page>`
  }

  private errorLine() {
    if (!this.error) return nothing
    return html`<div class="error" role="alert">
      <p>${this.error.text}</p>
      ${this.error.detail ? html`<p class="detail muted">${strings.errorDetail(this.error.detail)}</p>` : nothing}
    </div>`
  }

  private body() {
    const s = this.screen
    switch (s.name) {
      case 'welcome':
        return this.welcome()
      case 'create':
        return this.createForm()
      case 'open':
        return this.openForm()
      case 'kit':
        return this.kit(s.key, s.folder)
      case 'vault':
        return nothing
    }
  }

  private welcome() {
    return html`
      <h1>${strings.appName}</h1>
      <p class="muted">${strings.tagline}</p>
      <div class="row">
        <dc-button variant="primary" @click=${() => this.go({ name: 'create' })}>${strings.createVault}</dc-button>
        <dc-button variant="secondary" @click=${() => this.go({ name: 'open' })}>${strings.openVault}</dc-button>
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

  private passphraseField(label: string, value: string, set: (v: string) => void, submit: () => void) {
    return html`<label>
      ${label}
      <dc-input
        type="password"
        aria-label=${label}
        .value=${value}
        ?disabled=${this.busy}
        @input=${(e: Event) => set((e.target as HTMLInputElement).value)}
        @keydown=${(e: KeyboardEvent) => this.onEnter(e, submit)}
      ></dc-input>
    </label>`
  }

  private actions(label: string, action: () => void) {
    return html`<div class="row">
      <dc-button variant="primary" ?disabled=${this.busy} @click=${action}>${this.busy ? strings.working : label}</dc-button>
      <dc-button variant="ghost" ?disabled=${this.busy} @click=${() => this.go({ name: 'welcome' })}>${strings.back}</dc-button>
    </div>`
  }

  private createForm() {
    const submit = () => void this.create()
    return html`
      <h2>${strings.createVault}</h2>
      ${this.folderField(strings.pickCreateFolderTitle)}
      ${this.passphraseField(strings.passphrase, this.passphrase, (v) => (this.passphrase = v), submit)}
      ${this.passphraseField(strings.passphraseAgain, this.again, (v) => (this.again = v), submit)}
      <p class="muted">${strings.passphraseHint(MIN_PASSPHRASE)}</p>
      ${this.actions(strings.create, submit)}
    `
  }

  private openForm() {
    const submit = () => void this.openVault()
    return html`
      <h2>${strings.openVault}</h2>
      ${this.folderField(strings.pickOpenFolderTitle)}
      ${this.passphraseField(strings.passphrase, this.passphrase, (v) => (this.passphrase = v), submit)}
      ${this.actions(strings.open, submit)}
    `
  }

  private kit(key: string, folder: string) {
    const submit = () => void this.confirmKit(folder)
    return html`
      <h2>${strings.kitTitle}</h2>
      <p>${strings.kitLead}</p>
      <p class="folder">${folder}</p>
      <div>
        <p class="muted">${strings.kitKey}</p>
        <div class="key" data-role="key">${groupKey(key).join(' ')}</div>
      </div>
      <ul>
        ${strings.kitWarnings.map((w) => html`<li>${w}</li>`)}
      </ul>
      <p class="muted">${strings.kitWithoutApp}</p>
      <p class="muted">${strings.kitPassphraseChange}</p>
      <div class="row no-print">
        <dc-button variant="secondary" @click=${() => window.print()}>${strings.print}</dc-button>
      </div>
      <label class="no-print">
        ${strings.kitConfirmLabel(KIT_TAIL)}
        <dc-input
          aria-label=${strings.kitConfirmLabel(KIT_TAIL)}
          .value=${this.tail}
          ?disabled=${this.busy}
          @input=${(e: Event) => (this.tail = (e.target as HTMLInputElement).value)}
          @keydown=${(e: KeyboardEvent) => this.onEnter(e, submit)}
        ></dc-input>
      </label>
      <div class="row no-print">
        <dc-button variant="primary" ?disabled=${this.busy} @click=${submit}>${strings.kitConfirm}</dc-button>
        <dc-button variant="ghost" ?disabled=${this.busy} @click=${() => void this.closeVault()}>${strings.cancel}</dc-button>
      </div>
    `
  }

}

declare global {
  interface HTMLElementTagNameMap {
    'oc-app': OcApp
  }
}
