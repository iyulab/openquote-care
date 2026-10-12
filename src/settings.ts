import { LitElement, css, html, nothing } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { describeError } from './errors.js'
import { IDLE_CHOICES, idleMinutes, setIdleMinutes } from './idle.js'
import { languageNames, pickLocale, tables, type Locale } from './locales/index.js'
import {
  shell,
  type DiagnosticsLines,
  type DiagnosticsStatus,
  type FeedbackStatus,
  type Looked,
  type Settings,
  type Theme,
  type UpdateStatus,
} from './shell.js'
import { locale, strings } from './strings.js'
import { errorCallout } from './vault/parts.js'
import './quote-state.js'

/** The languages a person can choose, each in its own words; `system` follows the system's display language. */
export function languageChoices(systemLocale: string): { value: string; label: string }[] {
  const system = pickLocale([systemLocale])
  return [
    { value: 'system', label: strings.languageSystem(languageNames[system]) },
    ...(Object.keys(tables) as Locale[]).map((l) => ({ value: l, label: languageNames[l] })),
  ]
}

/**
 * The app's settings on this computer — its colours, its language, new versions, the idle lock,
 * what it sends, and what it is. The same screen from the first screen and from an open vault; it
 * tells its host what the host keeps (`oc-update-changed`, `oc-update-apply`, `oc-idle-changed`,
 * `oc-feedback-open`).
 */
@customElement('oc-settings')
export class OcSettings extends LitElement {
  static styles = css`
    :host {
      display: block;
      max-width: 46rem;
      margin: 0 auto;
      padding: var(--dc-space-6, 24px) var(--dc-space-5, 20px);
    }
    h2,
    h3,
    p {
      margin: 0;
    }
    h2 {
      font-size: var(--dc-font-size-xl, 20px);
      font-weight: var(--dc-font-weight-semibold, 600);
    }
    header {
      display: flex;
      gap: var(--dc-space-4, 16px);
      align-items: flex-start;
      justify-content: space-between;
      margin-bottom: var(--dc-space-6, 24px);
    }
    header > div {
      display: grid;
      gap: var(--dc-space-1, 4px);
    }
    .muted {
      color: var(--dc-color-text-muted);
    }
    section + section {
      margin-top: var(--dc-space-6, 24px);
    }
    h3 {
      font-size: var(--dc-font-size-sm, 12px);
      font-weight: var(--dc-font-weight-semibold, 600);
      color: var(--dc-color-text-secondary);
      margin: 0 0 var(--dc-space-2, 8px) var(--dc-space-1, 4px);
    }
    /* One card per section, its settings as rows: what it is on the left, the control on the right. */
    .group {
      background: var(--dc-color-surface-raised);
      border: 1px solid var(--dc-color-border);
      border-radius: var(--dc-radius-lg, 8px);
    }
    .item {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--dc-space-4, 16px);
      align-items: center;
      padding: var(--dc-space-4, 16px) var(--dc-space-5, 20px);
    }
    .item + .item {
      border-top: 1px solid var(--dc-color-rule);
    }
    .item.wide {
      grid-template-columns: minmax(0, 1fr);
    }
    .item.note {
      background: var(--dc-color-accent-subtle);
    }
    .item:last-child.note {
      border-radius: 0 0 var(--dc-radius-lg, 8px) var(--dc-radius-lg, 8px);
    }
    .text {
      display: grid;
      gap: 2px;
      min-width: 0;
    }
    .name {
      font-weight: var(--dc-font-weight-medium, 500);
    }
    .hint {
      color: var(--dc-color-text-muted);
      font-size: var(--dc-font-size-sm, 12px);
      line-height: var(--dc-line-height-normal, 1.5);
    }
    .controls {
      display: flex;
      gap: var(--dc-space-2, 8px);
      align-items: center;
      justify-content: flex-end;
    }
    .language dc-select {
      min-width: 14rem;
    }
    oq-quote-state {
      color: var(--dc-color-text-secondary);
    }
    h4 {
      margin: 0 0 var(--dc-space-1, 4px);
      font-size: var(--dc-font-size-sm, 12px);
      font-weight: var(--dc-font-weight-semibold, 600);
    }
    /* The lines as written: one per line, scrolled sideways rather than wrapped. */
    pre {
      margin: 0;
      max-height: 18rem;
      overflow: auto;
      font-family: var(--dc-font-mono, ui-monospace, monospace);
      font-size: var(--dc-font-size-xs, 11px);
      padding: var(--dc-space-3, 12px);
      border-radius: var(--dc-radius-md, 6px);
      background: var(--dc-color-surface);
      border: 1px solid var(--dc-color-rule);
    }
    .lines {
      display: grid;
      gap: var(--dc-space-3, 12px);
    }
    @media (max-width: 640px) {
      .item {
        grid-template-columns: minmax(0, 1fr);
      }
      .controls {
        justify-content: flex-start;
      }
    }
  `

  /** Whether the screen names itself; an open vault's toolbar already does. */
  @property({ type: Boolean }) titled = true

  @state() private settings?: Settings
  @state() private updates: UpdateStatus = { configured: false, checking: false, available: null, ready: false }
  @state() private looking = false
  @state() private looked?: Looked
  @state() private diagnostics: DiagnosticsStatus = { configured: false }
  /** What has been written to send, while shown. */
  @state() private lines?: DiagnosticsLines
  @state() private feedback?: FeedbackStatus
  /** The third-party notices while shown; null when the file is not there. */
  @state() private notices?: string | null
  @state() private idle = idleMinutes()
  @state() private busy = false
  @state() private error?: { text: string; detail?: string }

  connectedCallback() {
    super.connectedCallback()
    void this.load()
  }

  private async load() {
    const [settings, updates, diagnostics, feedback] = await Promise.all([
      shell.settings().catch(() => undefined),
      shell.updateStatus().catch(() => this.updates),
      shell.diagnosticsStatus().catch(() => this.diagnostics),
      shell.feedbackStatus().catch(() => undefined),
    ])
    this.settings = settings
    this.updates = updates
    this.diagnostics = diagnostics
    this.feedback = feedback?.configured ? feedback : undefined
  }

  private tell(name: string) {
    this.dispatchEvent(new Event(name, { bubbles: true, composed: true }))
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

  private async setTheme(theme: Theme) {
    if (!this.settings || theme === this.settings.theme) return
    const settings = this.settings
    await this.run(async () => {
      await shell.setTheme(theme)
      this.settings = { ...settings, theme }
    })
  }

  private async setLanguage(value: string) {
    const language = value === 'system' ? null : value
    await this.run(async () => {
      await shell.setLanguage(language)
      this.settings = await shell.settings()
    })
  }

  private async restart() {
    await this.run(() => shell.restart())
  }

  private async setChecking(on: boolean) {
    await this.run(async () => {
      await shell.setUpdateChecking(on)
      this.updates = await shell.updateStatus()
      this.tell('oc-update-changed')
    })
  }

  private async lookNow() {
    this.looking = true
    this.looked = undefined
    try {
      this.looked = (await shell.lookForUpdate().catch(() => ({ outcome: 'unreachable' }) as const)) ?? undefined
      this.updates = await shell.updateStatus().catch(() => this.updates)
      this.tell('oc-update-changed')
    } finally {
      this.looking = false
    }
  }

  private chooseIdle(minutes: number) {
    this.idle = minutes
    setIdleMinutes(minutes)
    this.tell('oc-idle-changed')
  }

  private async toggleLines() {
    if (this.lines) {
      this.lines = undefined
      return
    }
    await this.run(async () => {
      this.lines = await shell.diagnosticsReports()
    })
  }

  private async toggleNotices() {
    if (this.notices !== undefined) {
      this.notices = undefined
      return
    }
    await this.run(async () => {
      this.notices = await shell.notices()
    })
  }

  render() {
    return html`<header>
        <div>
          ${this.titled ? html`<h2>${strings.settingsTitle}</h2>` : nothing}
          <p class="muted">${strings.settingsLead}</p>
        </div>
        <slot name="actions"></slot>
      </header>
      ${errorCallout(this.error)} ${this.look()} ${this.versions()} ${this.lock()} ${this.sending()} ${this.about()}`
  }

  private item(name: string, hint: unknown, controls: unknown, role?: string) {
    return html`<div class="item" data-role=${role ?? nothing}>
      <div class="text">
        <span class="name">${name}</span>
        ${hint ? html`<span class="hint">${hint}</span>` : nothing}
      </div>
      <div class="controls">${controls}</div>
    </div>`
  }

  /** The window's colours and its language. */
  private look() {
    const s = this.settings
    // Starting again changes what the app speaks: what is set now (a fixed language included) says so.
    const restart = s !== undefined && pickLocale([s.nextLocale]) !== locale
    return html`<section aria-labelledby="look">
      <h3 id="look">${strings.settingsLook}</h3>
      <div class="group">
        ${this.item(
          strings.themeLabel,
          strings.themeHint,
          html`<dc-segmented-control
            size="sm"
            aria-label=${strings.themeLabel}
            .options=${[
              { value: 'system', label: strings.themeSystem },
              { value: 'light', label: strings.themeLight },
              { value: 'dark', label: strings.themeDark },
            ]}
            .value=${s?.theme ?? 'system'}
            ?disabled=${!s || this.busy}
            @change=${(e: Event) => void this.setTheme((e.target as HTMLInputElement).value as Theme)}
          ></dc-segmented-control>`,
          'theme',
        )}
        <div class="item language" data-role="language">
          <div class="text">
            <span class="name">${strings.languageLabel}</span>
            <span class="hint">${strings.languageHint}</span>
          </div>
          <div class="controls">
            <dc-select
              size="sm"
              aria-label=${strings.languageLabel}
              .options=${languageChoices(s?.systemLocale ?? locale)}
              .value=${s ? (s.language ?? 'system') : ''}
              ?disabled=${!s || this.busy}
              @change=${(e: Event) => void this.setLanguage((e.target as HTMLSelectElement).value)}
            ></dc-select>
          </div>
        </div>
        ${restart
          ? html`<div class="item note" data-role="language-restart" role="status">
              <div class="text">
                <span class="name">${strings.languageRestart}</span>
                <span class="hint">${strings.languageRestartVault}</span>
              </div>
              <div class="controls">
                <dc-button variant="primary" size="sm" ?disabled=${this.busy} @click=${() => void this.restart()}>${strings.languageRestartNow}</dc-button>
              </div>
            </div>`
          : nothing}
      </div>
    </section>`
  }

  /** This version, and new ones: looking by itself, and looking now. */
  private versions() {
    const u = this.updates
    const version = this.settings?.version ?? ''
    if (!u.configured) {
      return html`<section aria-labelledby="versions">
        <h3 id="versions">${strings.settingsUpdates}</h3>
        <div class="group">${this.item(strings.versionNow(version), strings.updateNotHere, nothing, 'version')}</div>
      </section>`
    }
    const looked = this.looked
    const found = u.available ?? (looked?.outcome === 'found' ? looked.version : null)
    const said = this.looking
      ? html`<oq-quote-state state="ongoing" size="14">${strings.updateLooking}</oq-quote-state>`
      : found
        ? strings.updateFound(found)
        : looked?.outcome === 'latest'
          ? strings.updateLatest
          : looked?.outcome === 'unreachable'
            ? strings.updateUnreachable
            : ''
    return html`<section aria-labelledby="versions">
      <h3 id="versions">${strings.settingsUpdates}</h3>
      <div class="group">
        ${this.item(
          strings.versionNow(version),
          said,
          found
            ? html`<dc-button variant="primary" size="sm" @click=${() => this.tell('oc-update-apply')}>${strings.updateApply}</dc-button>`
            : html`<dc-button variant="secondary" size="sm" ?disabled=${this.looking} @click=${() => void this.lookNow()}>${strings.updateLookNow}</dc-button>`,
          'version',
        )}
        ${this.item(
          strings.updateAuto,
          u.checking ? strings.updateCheckNotice : strings.updateAutoOffHint,
          html`<dc-checkbox
            aria-label=${strings.updateAuto}
            .checked=${u.checking}
            ?disabled=${this.busy}
            @change=${(e: Event) => void this.setChecking((e.target as HTMLInputElement).checked)}
          ></dc-checkbox>`,
          'update-check',
        )}
      </div>
    </section>`
  }

  /** The idle lock: a setting of this computer, not of a vault. */
  private lock() {
    return html`<section aria-labelledby="lock">
      <h3 id="lock">${strings.settingsLock}</h3>
      <div class="group">
        ${this.item(
          strings.idleLock,
          strings.idleLockLead,
          html`<dc-select
            size="sm"
            aria-label=${strings.idleLock}
            .options=${IDLE_CHOICES.map((m) => ({ value: String(m), label: strings.idleOption(m) }))}
            .value=${String(this.idle)}
            @change=${(e: Event) => this.chooseIdle(Number((e.target as HTMLSelectElement).value))}
          ></dc-select>`,
          'idle-lock',
        )}
      </div>
    </section>`
  }

  /** What this installation sends about itself, every line of it on request, and feedback. */
  private sending() {
    const lines = this.lines
    const part = (role: string, heading: string, text: string, none: string) =>
      html`<div>
        <h4>${heading}</h4>
        ${text.trim() ? html`<pre data-role=${role} tabindex="0">${text}</pre>` : html`<p class="hint" data-role=${`no-${role}`}>${none}</p>`}
      </div>`
    return html`<section aria-labelledby="sending">
      <h3 id="sending">${strings.settingsSending}</h3>
      <div class="group">
        ${this.diagnostics.configured
          ? html`${this.item(
              strings.diagnosticsTitle,
              strings.diagnosticsNotice,
              html`<dc-button variant="secondary" size="sm" aria-expanded=${lines ? 'true' : 'false'} ?disabled=${this.busy} @click=${() => void this.toggleLines()}
                >${lines ? strings.diagnosticsHide : strings.diagnosticsView}</dc-button
              >`,
              'diagnostics',
            )}
            ${lines
              ? html`<div class="item wide" data-role="reports">
                  <div class="lines">
                    <p class="hint">${strings.diagnosticsLead}</p>
                    ${part('report-lines', strings.diagnosticsReportsHeading, lines.reports, strings.diagnosticsNone)}
                    ${part('session-lines', strings.diagnosticsSessionsHeading, lines.sessions, strings.diagnosticsNoSessions)}
                  </div>
                </div>`
              : nothing}`
          : this.item(strings.diagnosticsTitle, strings.diagnosticsNotHere, nothing, 'diagnostics-off')}
        ${this.feedback
          ? this.item(
              strings.feedbackOpen,
              strings.feedbackLead,
              html`<dc-button variant="secondary" size="sm" @click=${() => this.tell('oc-feedback-open')}>${strings.feedbackOpen}</dc-button>`,
              'feedback-open',
            )
          : nothing}
      </div>
    </section>`
  }

  /** What the app is: its name and version, its licence, where it lives, and the software it includes. */
  private about() {
    const notices = this.notices
    return html`<section aria-labelledby="about">
      <h3 id="about">${strings.settingsAbout}</h3>
      <div class="group">
        ${this.item(
          `${strings.appName} ${this.settings?.version ?? ''}`,
          html`${strings.aboutLicense}<br />${strings.aboutHomepage}`,
          html`<dc-button variant="secondary" size="sm" aria-expanded=${notices !== undefined ? 'true' : 'false'} ?disabled=${this.busy} @click=${() => void this.toggleNotices()}
            >${notices !== undefined ? strings.noticesHide : strings.noticesView}</dc-button
          >`,
          'about',
        )}
        ${notices !== undefined
          ? html`<div class="item wide" data-role="notices">
              ${notices === null ? html`<p class="hint">${strings.noticesMissing}</p>` : html`<pre tabindex="0">${notices}</pre>`}
            </div>`
          : nothing}
      </div>
    </section>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'oc-settings': OcSettings
  }
}
