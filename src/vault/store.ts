import type { ReactiveController, ReactiveControllerHost } from 'lit'
import { nameCollator } from '../collation.js'
import { describeError } from '../errors.js'
import { leftBehind } from '../forms.js'
import { Latest } from '../latest.js'
import { definitionOf, text, today, type Entity, type Scheme } from '../records.js'
import { lastMonth } from '../report.js'
import type { FieldView } from '../fields.js'
import { shell, type VaultSummary } from '../shell.js'
import { strings } from '../strings.js'

export type Problem = keyof typeof strings.problems

/** A failure in words, with the shell's own words for the detail line. */
export type ErrorText = { text: string; detail?: string }

/**
 * The new-session form as being filled in, by field name: a code for a classification, an id for a
 * reference, the text otherwise. The subject and group screens share it.
 */
export type SessionDraft = Record<string, string>

/** What the screens may set directly; everything else changes through the store's actions. */
type Settable = Pick<VaultStore, 'notice' | 'error' | 'reportKey' | 'exportKey' | 'year' | 'month'>

/**
 * An open vault as the screens see it: what was read from it, the action in progress and its
 * outcome, and the few choices several screens share. Tells its listeners with a `change` event.
 */
export class VaultStore extends EventTarget {
  subjects: Entity[] = []
  sessions: Entity[] = []
  groups: Entity[] = []
  practitioners: Entity[] = []
  schemes: Scheme[] = []
  /** The fields the vault's packs declare for sessions and for subjects. */
  sessionFields: FieldView[] = []
  subjectFields: FieldView[] = []
  summary?: VaultSummary
  /** How names are ordered in this vault: by the locales its packs label things in. */
  names = nameCollator()
  busy = false
  error?: ErrorText
  notice = ''
  /** The report form chosen: loading picks the newest when none is, and a pack offers its new version. */
  reportKey = ''
  /** The export form chosen: loading picks the first when none is. */
  exportKey = ''
  /** The month the report and export screens work on. */
  year = lastMonth().year
  month = lastMonth().month
  draft: SessionDraft = {}

  private readonly loads = new Latest()
  private unlisten?: Promise<() => void>
  private outsideChangeWaiting = false

  /** Tells the screens something changed. */
  changed() {
    this.dispatchEvent(new Event('change'))
  }

  set(patch: Partial<Settable>) {
    Object.assign(this, patch)
    this.changed()
  }

  editDraft(patch: SessionDraft) {
    this.draft = { ...this.draft, ...patch }
    this.changed()
  }

  /** Reads the vault and starts taking in what other devices write to it. */
  connect() {
    void this.run(() => this.load())
    this.unlisten = shell.onVaultChanged(() => void this.onOutsideChange())
  }

  disconnect() {
    void this.unlisten?.then((stop) => stop())
    this.unlisten = undefined
  }

  /**
   * Another device wrote to the vault: take it in without getting in the way — no busy state, no
   * cleared message, and not in the middle of the person's own action (it waits for that to end).
   */
  private async onOutsideChange() {
    if (this.busy) {
      this.outsideChangeWaiting = true
      return
    }
    this.outsideChangeWaiting = false
    try {
      await shell.refresh()
      await this.load()
    } catch {
      // Coming back to the window, or the refresh button, reads the vault again.
    }
  }

  /** The entities a reference field of `type` may point at. */
  entitiesOf(type: string | null): Entity[] {
    return type === 'practitioner' ? this.practitioners : type === 'subject' ? this.subjects : type === 'group' ? this.groups : []
  }

  /** What the form holds after a session is written: the date and who was there stay; the rest is cleared. */
  clearDraft() {
    this.draft = Object.fromEntries(
      this.sessionFields.filter((f) => f.kind === 'date' || f.kind === 'reference').map((f) => [f.name, this.draft[f.name] ?? '']),
    )
    this.changed()
  }

  /** Reads the vault folder again: records other devices sharing it wrote come in. */
  async refresh() {
    await this.run(async () => {
      await shell.refresh()
      await this.load()
    })
  }

  /** Reads everything the screens show. A read overtaken by a newer one is dropped, not applied. */
  async load() {
    const current = this.loads.begin()
    const [subjects, sessions, groups, practitioners, schemes, summary, sessionFields, subjectFields] = await Promise.all([
      shell.entities('subject'),
      shell.entities('session'),
      shell.entities('group'),
      shell.entities('practitioner'),
      shell.schemes(),
      shell.summary(),
      shell.fields('session'),
      shell.fields('subject'),
    ])
    if (!current()) return
    // A form standing on a hidden field is never shown; the sidecar decides which those are.
    const { reports, exports } = (this.summary = {
      ...summary,
      reports: summary.reports.filter((f) => f.offered),
      exports: summary.exports.filter((f) => f.offered),
    })
    if (!this.exportKey && exports.length > 0) this.exportKey = `${exports[0].name}@${exports[0].version}`
    if (!this.reportKey && reports.length > 0) {
      const newest = [...reports].sort((a, b) => b.version - a.version)[0]
      this.reportKey = `${newest.name}@${newest.version}`
    }
    this.names = nameCollator(summary.locales)
    const byName = (a: Entity, b: Entity) => this.names.compare(text(a, 'name'), text(b, 'name'))
    this.subjects = [...subjects].sort(byName)
    this.sessions = sessions
    this.groups = [...groups].sort(byName)
    this.practitioners = practitioners
    this.schemes = schemes
    this.sessionFields = sessionFields
    this.subjectFields = subjectFields
    this.draft = { ...startingValues(this, sessionFields), ...this.draft }
    this.changed()
  }

  /** Runs a person's action: busy until it ends, and its failure shown in words. */
  async run(action: () => Promise<void>) {
    this.busy = true
    this.error = undefined
    this.changed()
    try {
      await action()
    } catch (e) {
      this.error = describeError(e)
    } finally {
      this.busy = false
      this.changed()
      if (this.outsideChangeWaiting) void this.onOutsideChange()
    }
  }

  /** Says a field a person must fill in is empty, by its label. */
  missing(label: string) {
    this.set({ error: { text: strings.missing(label) } })
  }

  problem(p: Problem, min?: number) {
    const words = strings.problems[p]
    this.set({ error: { text: typeof words === 'function' ? words(min ?? 0) : words } })
  }

  /** Applies the data pack in `folder` and says what it brought. */
  async applyPack(folder: string) {
    this.set({ notice: '' })
    await this.run(async () => {
      const added = await shell.applyPack(folder)
      await this.load()
      this.notice = packNotice(added, this.summary)
      // A new form version is what the person came for: offer it.
      const report = added.map(definitionOf).find((d) => d?.kind === 'report')
      if (report?.kind === 'report') this.reportKey = `${report.name}@${report.version}`
    })
  }
}

/** What a pack brought, in words, and what the vault still lacks after it. */
function packNotice(added: string[], summary: VaultSummary | undefined): string {
  if (added.length === 0) return strings.packNothingNew
  let notice: string
  // A pack that brings its manifest is named once; a folder of loose definitions, file by file.
  const manifests = added.map(definitionOf).filter((d) => d?.kind === 'pack')
  const packs = summary?.packs ?? []
  const named = manifests.map((m) => packs.find((p) => p.id === m!.name && p.version === m!.version)).filter((p) => !!p)
  if (named.length > 0) {
    notice = named.map((p) => strings.packApplied(p!.label, p!.version)).join(' ')
  } else {
    const names = added.map((p) => {
      const d = definitionOf(p)
      if (!d) return p
      switch (d.kind) {
        case 'crosswalk': return strings.definition.crosswalk(d.name, d.from, d.to)
        case 'labels': return strings.definition.labels(d.name, d.version, d.locale)
        case 'fields': return strings.definition.fields(d.name, d.version, d.type)
        default: return strings.definition[d.kind](d.name, d.version)
      }
    })
    notice = strings.packAdded(names)
  }
  const issues = summary?.packIssues ?? []
  if (issues.length > 0) notice += ' ' + strings.packIssues(issues.length)
  const behind = leftBehind([...(summary?.reports ?? []), ...(summary?.exports ?? [])])
  if (behind.length > 0) notice += ' ' + strings.packFormsBehind(behind.map((f) => strings.reportFormOption(f.label, f.version)))
  const unlinked = summary?.unlinked ?? []
  if (unlinked.length > 0) notice += ' ' + strings.packSchemeUnlinked(unlinked.map((u) => strings.definition.scheme(u.scheme, u.version)))
  return notice
}

/**
 * What an empty form starts with: today in a required date, and the one entity a required reference
 * can point at when there is only one (a vault kept by a single practitioner).
 */
function startingValues(store: VaultStore, fields: FieldView[]): SessionDraft {
  const values: SessionDraft = {}
  for (const f of fields) {
    if (!f.required || f.hidden) continue
    if (f.kind === 'date') values[f.name] = today()
    const only = f.kind === 'reference' ? store.entitiesOf(f.refType) : []
    if (only.length === 1) values[f.name] = only[0].id
  }
  return values
}

/** Updates a Lit element whenever the store it shows changes. */
export class StoreController implements ReactiveController {
  private watched?: VaultStore
  private readonly update = () => this.host.requestUpdate()

  constructor(
    private readonly host: ReactiveControllerHost,
    private readonly store: () => VaultStore,
  ) {
    host.addController(this)
  }

  hostConnected() {
    this.watched = this.store()
    this.watched.addEventListener('change', this.update)
  }

  hostDisconnected() {
    this.watched?.removeEventListener('change', this.update)
    this.watched = undefined
  }
}
