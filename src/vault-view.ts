import { LitElement, css, html, nothing } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { desktopMinWidth } from '@iyulab/desktop-patterns/breakpoints'
import type { DpSidebarSelectEvent } from '@iyulab/desktop-patterns/sidebar'
import { ICONS, menuIcon } from './icons.js'
import { shortcutOf, typingIn } from './shortcuts.js'
import { text } from './records.js'
import { setSidebarRail, sidebarRail } from './sidebar-rail.js'
import { showScreen } from './screen-time.js'
import type { FeedbackStatus, VaultFileKind } from './shell.js'
import { strings } from './strings.js'
import { errorCallout, packsWaitingCallout } from './vault/parts.js'
import { StoreController, VaultStore } from './vault/store.js'
import { vaultStyles } from './vault/styles.js'
import type { OcSubjects } from './vault/subjects-screen.js'
import './vault/subjects-screen.js'
import type { OcGroups } from './vault/groups-screen.js'
import type { OcReport } from './vault/report-screen.js'
import type { OcExport } from './vault/export-screen.js'
import './vault/groups-screen.js'
import type { OpenSession } from './vault/parts.js'
import './vault/search-screen.js'
import './vault/report-screen.js'
import './vault/export-screen.js'
import './vault/practitioners-screen.js'
import './vault/lists-screen.js'
import type { DeviceSection, OcDevices } from './vault/devices-screen.js'
import './vault/devices-screen.js'
import './feedback.js'

type View = 'subjects' | 'groups' | 'practitioners' | 'search' | 'report' | 'export' | 'lists' | 'devices' | 'feedback'

/**
 * An open vault: the frame around its screens — the sidebar that switches between them, the
 * toolbar, and the lines every screen shares (unreadable files, hints, the error). The screens
 * draw from one store holding what was read from the vault.
 */
@customElement('oc-vault')
export class OcVault extends LitElement {
  static styles = [
    vaultStyles,
    css`
      :host {
        display: block;
        height: 100%;
      }
      dp-shell {
        height: 100%;
      }
      oc-feedback {
        max-width: 44rem;
        padding: var(--dc-space-5, 20px) var(--dc-space-6, 24px);
      }
      oc-feedback[hidden] {
        display: none;
      }
      dp-page > dc-callout {
        margin: var(--dc-space-3, 12px) var(--dc-space-6, 24px) 0;
      }
    `,
  ]

  /** The folder the vault is in, shown under the heading. */
  @property() folder = ''
  /** Opened with the recovery key: the person may have forgotten the passphrase. */
  @property({ type: Boolean }) openedWithKey = false
  /** Opened with the recovery key while the key file is missing or damaged: a new passphrase is the next step, not a choice. */
  @property({ type: Boolean }) keyFileLost = false
  /** The folder is a backup this app keeps of another vault, opened in its place. */
  @property({ type: Boolean }) backupCopy = false
  /** The packs the vault took on as it opened, by label: said once, on the first screen. */
  @property({ attribute: false }) adopted: string[] = []
  /** Opening brought the vault's packs up to the newer version this app carries. */
  @property({ attribute: false }) packsUpdated = false
  /** Opening found a newer version of the vault's packs in this app that needs the vault raised to a newer format first. */
  @property({ attribute: false }) packsWaiting = false
  /** What feedback sends along, when this installation can send any; absent, it is not offered. */
  @property({ attribute: false }) feedback?: FeedbackStatus

  @state() private view: View = 'subjects'
  /** The sidebar as a drawer, while the window is narrow: closed until asked for. */
  @state() private sidebarOpen = false
  /** The sidebar folded to its icon rail, while the window is wide; kept on this computer. */
  @state() private rail = sidebarRail()
  @state() private wide = false
  /** Where the folder's menu opens, while it is open: under its button. */
  @state() private folderMenu?: { x: number; y: number }
  /** The list of keys the vault answers to is on screen. */
  @state() private shortcutsOpen = false

  private readonly wideQuery = matchMedia(`(min-width: ${desktopMinWidth}px)`)
  private readonly onWidth = () => (this.wide = this.wideQuery.matches)

  private readonly store = new VaultStore()

  constructor() {
    super()
    new StoreController(this, () => this.store)
  }

  connectedCallback() {
    super.connectedCallback()
    this.store.folder = this.folder
    this.store.connect()
    void this.store.resumeBackup()
    if (this.adopted.length > 0) this.store.notice = strings.adopted(this.adopted)
    else if (this.packsUpdated) this.store.notice = strings.packsUpdated
    this.store.packsWaiting = this.packsWaiting
    window.addEventListener('focus', this.onFocus)
    window.addEventListener('keydown', this.onKey)
    this.wideQuery.addEventListener('change', this.onWidth)
    this.onWidth()
  }

  /** The vault's screen, by its fixed name, for the time kept on each screen. */
  protected updated(changed: Map<PropertyKey, unknown>) {
    if (changed.has('view')) showScreen(`vault:${this.view}`)
  }

  disconnectedCallback() {
    window.removeEventListener('focus', this.onFocus)
    window.removeEventListener('keydown', this.onKey)
    this.wideQuery.removeEventListener('change', this.onWidth)
    this.store.disconnect()
    super.disconnectedCallback()
  }

  /** The keys the vault answers to; each is left to the page where it means nothing here. */
  private onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || this.shortcutsOpen) return
    const shortcut = shortcutOf(e, typingIn(e.composedPath()[0]))
    if (!shortcut) return
    const screen = <T extends Element>(tag: string) => this.renderRoot.querySelector<T>(tag)
    switch (shortcut) {
      case 'find':
        e.preventDefault()
        this.view = 'subjects'
        void this.updateComplete.then(() => screen<OcSubjects>('oc-subjects')?.focusFind())
        return
      case 'new-record':
        e.preventDefault()
        this.view = 'subjects'
        void this.updateComplete.then(() => screen<OcSubjects>('oc-subjects')?.focusNewSession())
        return
      case 'previous-month':
      case 'next-month': {
        const by = shortcut === 'next-month' ? 1 : -1
        const stepped = this.view === 'report' ? screen<OcReport>('oc-report')?.stepPeriod(by) : this.view === 'export' ? screen<OcExport>('oc-export')?.stepPeriod(by) : false
        if (stepped) e.preventDefault()
        return
      }
      case 'help':
        e.preventDefault()
        this.shortcutsOpen = true
    }
  }

  /** Coming back to the window is when another device's records are most likely waiting. */
  private onFocus = () => void this.store.takeIn()

  /** Reads the vault folder again: records other devices sharing it wrote come in. */
  async refresh() {
    await this.store.refresh()
  }

  /** Keeps this vault's backup in `folder` on this computer (what the folder picker answers); null stops it. */
  async setBackup(folder: string | null) {
    await this.store.setBackup(folder)
  }

  /** Applies the data pack in `folder` (what the folder picker answers). */
  async applyPack(folder: string) {
    await this.store.applyPack(folder)
  }

  private close() {
    this.dispatchEvent(new Event('oc-close', { bubbles: true, composed: true }))
  }

  /** The toolbar's toggle: folds the sidebar to its rail in a wide window, opens the drawer in a narrow one. */
  private toggleSidebar() {
    if (!this.wide) {
      this.sidebarOpen = !this.sidebarOpen
      return
    }
    this.rail = !this.rail
    setSidebarRail(this.rail)
  }

  /** Goes to the devices screen, with one of its settings open. */
  protected firstUpdated() {
    // With the key file lost, setting a new passphrase is where the vault opens.
    if (this.keyFileLost) this.goToDevices('passphrase')
  }

  /** Opens a session found by searching where it is kept: its subject's records, or its group's. */
  private async openSession(found: OpenSession) {
    this.view = found.holder === 'group' ? 'groups' : 'subjects'
    await this.updateComplete
    const screen = this.renderRoot.querySelector<OcSubjects | OcGroups>(found.holder === 'group' ? 'oc-groups' : 'oc-subjects')
    await screen?.showSession(found.id, found.session)
  }

  private goToDevices(section: DeviceSection) {
    this.view = 'devices'
    this.renderRoot.querySelector<OcDevices>('oc-devices')?.show(section)
  }

  private lockNow() {
    this.dispatchEvent(new Event('oc-lock', { bubbles: true, composed: true }))
  }

  render() {
    const store = this.store
    const view = this.view
    const heading = { subjects: strings.subjects, groups: strings.groups, search: strings.searchTitle, report: strings.report, export: strings.exportTitle, practitioners: strings.practitioners, lists: strings.lists, devices: strings.devices, feedback: strings.feedbackTitle }[view]
    return html`
      <dp-shell ?sidebar-open=${this.sidebarOpen} @dp-shell-sidebar-close=${() => (this.sidebarOpen = false)}>
        <dp-sidebar
          slot="sidebar"
          ?collapsed=${this.rail && this.wide}
          header=${this.folder.split(/[\\/]/).filter(Boolean).at(-1) ?? strings.appName}
          nav-label=${strings.navLabel}
          active-id=${view}
          .items=${[
            { id: 'records', label: strings.navGroupRecords, items: [
              { id: 'subjects', icon: '', label: strings.navSubjects },
              { id: 'groups', icon: '', label: strings.navGroups },
              { id: 'practitioners', icon: '', label: strings.navPractitioners },
              { id: 'search', icon: '', label: strings.navSearch },
            ] },
            { id: 'reports', label: strings.navGroupReports, items: [
              { id: 'report', icon: '', label: strings.navReport },
              { id: 'export', icon: '', label: strings.navExport },
            ] },
            { id: 'settings', label: strings.navGroupSettings, items: [
              { id: 'lists', icon: '', label: strings.navLists },
              { id: 'devices', icon: '', label: strings.navDevices },
              ...(this.feedback ? [{ id: 'feedback', icon: '', label: strings.feedbackOpen }] : []),
            ] },
          ]}
          @dp-sidebar-select=${(e: DpSidebarSelectEvent) => {
            this.view = e.itemId as View
            store.set({ error: undefined, notice: '' })
          }}
          @dp-sidebar-activate=${() => (this.sidebarOpen = false)}
          >${ICONS.map(menuIcon)}</dp-sidebar
        >
        <dp-toolbar
          slot="toolbar"
          heading=${heading}
          show-toggle
          toggle-label=${strings.toggleSidebar}
          ?expanded=${this.wide ? !this.rail : this.sidebarOpen}
          @dp-toolbar-toggle=${() => this.toggleSidebar()}
        >
          <dc-button slot="actions" variant="ghost" size="sm" ?disabled=${store.busy} @click=${() => this.lockNow()}>${strings.lockNow}</dc-button>
          <dc-button
            slot="actions"
            variant="secondary"
            size="sm"
            data-role="folder-menu"
            aria-haspopup="menu"
            aria-expanded=${this.folderMenu ? 'true' : 'false'}
            @click=${(e: Event) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
              this.folderMenu = this.folderMenu ? undefined : { x: Math.max(0, r.right - 200), y: r.bottom + 4 }
            }}
            >${strings.folderMenu} ▾</dc-button
          >
        </dp-toolbar>
        <dp-page fill max-width="full">
          ${this.unreadableView()} ${this.backupCopyHint()} ${packsWaitingCallout(store)} ${this.keyHint()} ${this.nameHint()} ${this.errorLine()}
          <oc-subjects .store=${store} ?active=${view === 'subjects'}></oc-subjects>
          <oc-groups .store=${store} ?active=${view === 'groups'}></oc-groups>
          <oc-report .store=${store} ?active=${view === 'report'} @oc-open-session=${(e: CustomEvent<OpenSession>) => void this.openSession(e.detail)}></oc-report>
          <oc-export .store=${store} ?active=${view === 'export'}></oc-export>
          <oc-practitioners .store=${store} ?active=${view === 'practitioners'}></oc-practitioners>
          <oc-lists .store=${store} ?active=${view === 'lists'}></oc-lists>
          <oc-search .store=${store} ?active=${view === 'search'} @oc-open-session=${(e: CustomEvent<OpenSession>) => void this.openSession(e.detail)}></oc-search>
          <oc-devices
            .store=${store}
            ?active=${view === 'devices'}
            .openedWithKey=${this.openedWithKey}
            .keyFileLost=${this.keyFileLost}
            @oc-passphrase-changed=${() => ((this.openedWithKey = false), (this.keyFileLost = false))}
          ></oc-devices>
          ${this.feedback ? html`<oc-feedback .status=${this.feedback} ?hidden=${view !== 'feedback'}></oc-feedback>` : nothing}
        </dp-page>
      </dp-shell>
      ${this.folderMenuView()}
      <dp-shortcut-overlay
        ?open=${this.shortcutsOpen}
        heading=${strings.shortcutsTitle}
        close-label=${strings.closeShortcuts}
        .shortcuts=${[
          { combo: 'Ctrl+K', description: strings.shortcutFind },
          { combo: 'Ctrl+N', description: strings.shortcutNewSession },
          { combo: 'Ctrl+Enter', description: strings.shortcutSave },
          { combo: '← →', description: strings.shortcutMonth },
          { combo: '?', description: strings.shortcutHelp },
        ]}
        @dp-shortcut-overlay-dismiss=${() => (this.shortcutsOpen = false)}
      ></dp-shortcut-overlay>
    `
  }

  /** The folder's rarer actions, apart from the page: read it again, close it. Locking stays one press away. */
  private folderMenuView() {
    const at = this.folderMenu
    if (!at) return nothing
    return html`<dc-context-menu
      data-role="folder-menu-items"
      open
      .x=${at.x}
      .y=${at.y}
      .items=${[
        { value: 'refresh', label: strings.refresh, disabled: this.store.busy },
        { separator: true },
        { value: 'close', label: strings.closeVault },
      ]}
      @close=${() => (this.folderMenu = undefined)}
      @select=${(e: CustomEvent<{ item: { value?: string } }>) => {
        this.folderMenu = undefined
        if (e.detail.item.value === 'refresh') void this.refresh()
        else if (e.detail.item.value === 'close') this.close()
      }}
    ></dc-context-menu>`
  }

  /** A backup opened in place of the vault it copies: what is written here stays here. */
  private backupCopyHint() {
    if (!this.backupCopy) return nothing
    return html`<dc-callout role="status" data-role="backup-copy"><p>${strings.backupCopyHint}</p></dc-callout>`
  }

  /** Opened with the recovery key: offer a new passphrase, in case the old one is forgotten — or, with
   * the key file lost, ask for one on every screen until it is set. */
  private keyHint() {
    if (this.keyFileLost && this.view !== 'devices') {
      return html`<dc-callout variant="danger" role="alert" data-role="key-hint">
        <p>${strings.keyFileLost}</p>
        <dc-button slot="actions" variant="secondary" size="sm" @click=${() => this.goToDevices('passphrase')}>${strings.goChangePassphrase}</dc-button>
      </dc-callout>`
    }
    if (!this.openedWithKey || this.view === 'devices') return nothing
    return html`<dc-callout role="status" data-role="key-hint">
      <p>${strings.openedWithKey}</p>
      <dc-button slot="actions" variant="ghost" size="sm" @click=${() => this.goToDevices('passphrase')}>${strings.goChangePassphrase}</dc-button>
    </dc-callout>`
  }

  /** Other devices already named themselves in this vault, but this one has no name yet. */
  private nameHint() {
    const s = this.store.summary
    if (!s || this.view === 'devices' || Object.keys(s.devices).length === 0 || s.device in s.devices) return nothing
    return html`<dc-callout role="status" data-role="name-hint">
      <p>${strings.nameThisDevice}</p>
      <dc-button slot="actions" variant="ghost" size="sm" @click=${() => this.goToDevices('name')}>${strings.goNameThisDevice}</dc-button>
    </dc-callout>`
  }

  private errorLine() {
    return errorCallout(this.store.error)
  }

  /** The files that could not be read, each with why — folded under the count. */
  private unreadableView() {
    const { summary, subjects, groups } = this.store
    const files = summary?.unreadable ?? []
    if (files.length === 0) return nothing
    const holders = {
      subject: new Map(subjects.map((s) => [s.id, text(s, 'name')])),
      group: new Map(groups.map((g) => [g.id, text(g, 'name')])),
    }
    // What the file belongs to, in the words a person knows it by: a subject's or group's name, the
    // field a scheme classifies, a form's title.
    const formLabel = (forms: { name: string; label: string }[] | undefined, name: string) => forms?.find((f) => f.name === name)?.label
    const holder = (k: VaultFileKind): string | undefined => {
      if ((k.kind === 'subject' || k.kind === 'group') && k.id) return holders[k.kind].get(k.id) || undefined
      if ((k.kind === 'scheme' || k.kind === 'crosswalk') && k.name) return this.store.schemeName(k.name)
      if (k.kind === 'report' && k.name) return formLabel(summary?.reports, k.name)
      if (k.kind === 'export' && k.name) return formLabel(summary?.exports, k.name)
      return undefined
    }
    return html`<dc-callout variant="warning" data-role="unreadable"><details class="unreadable">
      <summary>${strings.unreadable(files.length)}</summary>
      <ul>
        ${files.map((f) => {
          const what = strings.unreadableWhat(f.kind, holder(f.kind))
          return html`<li data-reason=${f.reason}>
            ${what ? html`<span data-role="what">${what}</span> — ` : nothing}${strings.unreadableReason[f.reason] ?? f.detail}
            <br /><code class="muted">${f.path}</code>
          </li>`
        })}
      </ul>
    </details></dc-callout>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'oc-vault': OcVault
  }
}
