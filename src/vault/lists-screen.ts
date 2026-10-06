import { html, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { isCommandError } from '../errors.js'
import { choices, extensionsOf, latest, today, type Scheme } from '../records.js'
import { shell } from '../shell.js'
import { strings } from '../strings.js'
import { formatDevices, listDetail, nameField, noticeLine } from './parts.js'
import { VaultScreen } from './screen.js'

/**
 * The lists the vault's input fields pick from, and the items a person adds to one: kept in this
 * records folder only, beside the list the packs give, each counted as an item of that list in
 * every statistic — so what the packs count stays as it was.
 */
@customElement('oc-lists')
export class OcLists extends VaultScreen {
  @state() private selected?: string
  @state() private documentOpen = false
  @state() private itemName = ''
  @state() private countedAs = ''
  /** The version of the selected list in force today, whose items an added one may count as. */
  @state() private inForce?: Scheme
  /** Adding needs the folder raised to a newer format: a person says so first. */
  @state() private raiseFormat = false

  /** Every scheme an input field takes, by the label of the first field that takes it. */
  private lists(): { scheme: string; label: string }[] {
    const store = this.store
    const fields = [store.sessionFields, store.subjectFields, store.practitionerFields, ...store.kinds.map((k) => store.fieldsOf(k.type))].flat()
    const seen = new Map<string, string>()
    for (const f of fields) if (f.kind === 'coded' && f.scheme && !f.hidden && !seen.has(f.scheme)) seen.set(f.scheme, store.schemeName(f.scheme))
    return [...seen].map(([scheme, label]) => ({ scheme, label }))
  }

  private async pick(scheme: string) {
    this.selected = scheme
    this.documentOpen = true
    this.itemName = ''
    this.countedAs = ''
    this.raiseFormat = false
    const version = await shell.inForce(scheme, today())
    if (this.selected !== scheme) return
    this.inForce = this.store.schemes.find((s) => s.scheme === scheme && s.version === version) ?? latest(this.store.schemes, scheme)
  }

  private async add(raiseFormat = false) {
    const store = this.store
    const scheme = this.selected
    const label = this.itemName.trim()
    if (!scheme) return
    if (!label) return store.missing(strings.listItemName)
    if (!this.countedAs) return store.missing(strings.listCountedAs)
    store.set({ notice: '' })
    await store.run(async () => {
      try {
        await shell.addLocalItem(scheme, today(), label, this.countedAs, store.localFormSuffix(), raiseFormat)
      } catch (e) {
        // The list needs a newer format of the folder, which earlier versions of the app cannot open.
        if (isCommandError(e) && e.code === 'needs-new-format') {
          this.raiseFormat = true
          return
        }
        throw e
      }
      this.raiseFormat = false
      this.itemName = ''
      this.countedAs = ''
      await store.load()
      store.notice = strings.listAdded(label)
    })
  }

  protected screen() {
    const lists = this.lists()
    const ours = (scheme: string) => extensionsOf(this.store.schemes, scheme).reduce((n, s) => n + s.items.length, 0)
    const chosen = lists.find((l) => l.scheme === this.selected)
    return listDetail({
      store: this.store,
      label: strings.lists,
      entries: lists.map((l) => ({ id: l.scheme, label: l.label, meta: ours(l.scheme) > 0 ? strings.listOursCount(ours(l.scheme)) : '' })),
      selected: this.selected,
      select: (id) => void this.pick(id),
      empty: strings.noLists,
      document: chosen ? this.detail(chosen.scheme, chosen.label) : html`<p class="muted">${strings.pickList}</p>`,
      open: this.documentOpen,
      back: () => (this.documentOpen = false),
    })
  }

  private detail(scheme: string, label: string) {
    const store = this.store
    const busy = store.busy
    const base = this.inForce?.scheme === scheme ? this.inForce : undefined
    const anchors = base ? choices(base).filter((c) => !c.disabled) : []
    const labelIn = (code: string) => anchors.find((c) => c.value === code)?.label ?? code
    const added = extensionsOf(store.schemes, scheme).flatMap((s) => s.items)
    const add = () => void this.add()
    const devices = formatDevices(store.summary)
    return html`<dp-page-header heading=${label} description=${strings.listsIntro}></dp-page-header>
      <section data-list=${scheme}>
        <dc-section-heading marker size="lg" heading=${strings.listOurs}></dc-section-heading>
        ${added.length === 0
          ? html`<dc-empty-state description=${strings.listNone}></dc-empty-state>`
          : html`<dc-card
              ><div class="scroll">
                <table>
                  <thead>
                    <tr>
                      <th>${strings.listColumnItem}</th>
                      <th>${strings.listCountedAs}</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${added.map((i) => html`<tr data-local-item=${i.code}><td>${i.label}</td><td>${i.anchor ? labelIn(i.anchor) : ''}</td></tr>`)}
                  </tbody>
                </table>
              </div></dc-card
            >`}
      </section>
      <dc-card>
        ${nameField(busy, strings.listItemName, this.itemName, (v) => (this.itemName = v), add)}
        <dc-field label=${strings.listCountedAs} hint=${strings.listCountedAsHint} required>
          <dc-select
            aria-label=${strings.listCountedAs}
            .options=${anchors}
            .value=${this.countedAs}
            placeholder=${strings.listCountedAs}
            ?disabled=${busy}
            @change=${(e: Event) => (this.countedAs = (e.target as HTMLSelectElement).value)}
          ></dc-select>
        </dc-field>
        <dc-button slot="footer" variant="primary" data-role="list-add" ?disabled=${busy} @click=${add}>${strings.listAdd}</dc-button>
      </dc-card>
      ${this.raiseFormat
        ? html`<dc-callout variant="warning" data-role="raise-format">
            <p>${strings.listRaiseFormatAsk}</p>
            ${devices.length === 0 ? nothing : html`<p data-role="raise-format-devices">${strings.raiseFormatDevices(devices)}</p>`}
            <dc-button slot="actions" variant="primary" ?disabled=${busy} data-role="raise-format-confirm" @click=${() => void this.add(true)}>${strings.listRaiseFormatConfirm}</dc-button>
            <dc-button slot="actions" variant="secondary" ?disabled=${busy} @click=${() => (this.raiseFormat = false)}>${strings.cancel}</dc-button>
          </dc-callout>`
        : nothing}
      ${noticeLine(store)}`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'oc-lists': OcLists
  }
}
