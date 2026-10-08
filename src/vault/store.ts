import type { ReactiveController, ReactiveControllerHost } from 'lit'
import { nameCollator } from '../collation.js'
import { describeError, isCommandError } from '../errors.js'
import { leftBehind } from '../forms.js'
import { Latest } from '../latest.js'
import { definitionOf, text, today, type Entity, type Scheme } from '../records.js'
import { lastMonth } from '../report.js'
import { fixedDefaults, schemeLabel, type FieldView } from '../fields.js'
import { storeBackup, storedBackup } from '../backup.js'
import { storeReportForm, storedReportForm } from '../report-form.js'
import { shell, type BackupStatus, type CaseScales, type RecordKind, type ScaleView, type SubjectCases, type VaultSummary } from '../shell.js'
import { strings } from '../strings.js'
import { pickLocale, tables } from '../locales/index.js'

export type Problem = keyof typeof strings.problems

/** A failure in words, with the shell's own words for the detail line. */
export type ErrorText = { text: string; detail?: string }

/**
 * A record form as being filled in, by field name: a code for a classification, an id for a
 * reference, the text otherwise. The subject and group screens share it, one per kind of record.
 */
export type SessionDraft = Record<string, string>

/** A kind of record's form as being filled in, and the fields whose value a person took from a suggestion. */
type Draft = { values: SessionDraft; suggested: ReadonlySet<string> }

/** What the screens may set directly; everything else changes through the store's actions. */
type Settable = Pick<VaultStore, 'listFolded' | 'notice' | 'raiseFormatFor' | 'packsWaiting' | 'error' | 'reportKey' | 'exportKey' | 'year' | 'month' | 'day' | 'rangeFrom' | 'rangeTo'>

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
  practitionerFields: FieldView[] = []
  /** The kinds of record the vault's packs declare under subjects and groups, sessions among them. */
  kinds: RecordKind[] = []
  /** Each subject's cases, as the engine reads them from its records, by subject id. */
  cases = new Map<string, SubjectCases>()
  /** Each subject's scale scores over each of its cases, in the order of its cases, by subject id. */
  scaleCases = new Map<string, CaseScales[]>()
  /** The scales the vault's packs give, by code; none when they give none. */
  scaleCodes: string[] = []
  /** The scales the packs give, with their ranges. */
  scales: ScaleView[] = []
  /** The kind of record a scale score is kept in, and its scale and score fields; none when the packs give no scale. */
  scaleResponses?: { type: string; scale: string; score: string }
  /** Records of every kind but sessions, and the fields declared for them, by kind. */
  private others = new Map<string, Entity[]>()
  private otherFields = new Map<string, FieldView[]>()
  /** The forms of every kind but sessions as being filled in, by kind. */
  private otherDrafts = new Map<string, Draft>()
  summary?: VaultSummary
  /** How names are ordered in this vault: by the locales its packs label things in. */
  names = nameCollator()
  busy = false
  /** Every screen's list folded away while wide, for the document to take the whole width; while the folder is open. */
  listFolded = false
  error?: ErrorText
  notice = ''
  /** A data pack folder that needs the vault raised to a newer format: applied only once a person chooses to. */
  raiseFormatFor: string | undefined
  /** A newer version of the vault's packs, carried by this app, waits for the vault to be raised to a newer format. */
  packsWaiting = false
  /** The report form chosen: loading picks the newest when none is, and a pack offers its new version. */
  reportKey = ''
  /** The export form chosen: loading picks the first when none is. */
  exportKey = ''
  /** The month the report and export screens work on; its year is also the year a yearly form counts. */
  year = lastMonth().year
  month = lastMonth().month
  /** The day a daily form counts, and the first and last day a form over a range counts (`YYYY-MM-DD`; empty until picked). */
  day = today()
  rangeFrom = ''
  rangeTo = ''
  draft: SessionDraft = {}
  /** The draft's fields whose value a person took from a suggestion, and has not changed since. */
  suggested: ReadonlySet<string> = new Set()
  /** The folder the vault is in: this computer keeps a backup setting per vault. */
  folder = ''
  /** The backup this computer keeps of the vault, as the shell last reported it. */
  backup: BackupStatus = { folder: null }
  /** Records corrected after they were first written, by id: each correction is a change of its own. */
  corrected: ReadonlySet<string> = new Set()
  /** Why the backup remembered for this vault could not be taken up when it opened, as an error code. */
  backupProblem?: string

  private readonly loads = new Latest()
  private unlisten?: Promise<() => void>
  private outsideChangeWaiting = false
  /** A change from outside is being taken in. */
  private takingIn = false

  /** Tells the screens something changed. */
  changed() {
    this.dispatchEvent(new Event('change'))
  }

  set(patch: Partial<Settable>) {
    Object.assign(this, patch)
    this.changed()
  }

  /** The form of a kind of record as being filled in. */
  draftOf(type: string): SessionDraft {
    return type === 'session' ? this.draft : (this.otherDrafts.get(type)?.values ?? {})
  }

  /** The fields of a kind of record's form whose value a person took from a suggestion, and has not changed since. */
  suggestedOf(type: string): ReadonlySet<string> {
    return type === 'session' ? this.suggested : (this.otherDrafts.get(type)?.suggested ?? new Set())
  }

  /** Fills in a kind of record's form; `from` says whether a person typed or picked the values, or took a suggestion. */
  editDraft(patch: SessionDraft, from: 'person' | 'suggestion' = 'person', type = 'session') {
    const suggested = new Set(this.suggestedOf(type))
    for (const name of Object.keys(patch)) {
      if (from === 'suggestion') suggested.add(name)
      else suggested.delete(name)
    }
    this.setDraft(type, { values: { ...this.draftOf(type), ...patch }, suggested })
    this.changed()
  }

  private setDraft(type: string, draft: Draft) {
    if (type !== 'session') this.otherDrafts.set(type, draft)
    else {
      this.draft = draft.values
      this.suggested = draft.suggested
    }
  }

  /** The records of a kind kept under subjects or groups. */
  recordsOf(type: string): Entity[] {
    return type === 'session' ? this.sessions : (this.others.get(type) ?? [])
  }

  /** A record kept under subjects or groups, of any kind, by id. */
  recordById(id: string): Entity | undefined {
    return this.sessions.find((r) => r.id === id) ?? [...this.others.values()].flat().find((r) => r.id === id)
  }

  /** The kind whose records open a case, and the kind whose records close it, when the packs give those roles. */
  caseKinds(): { opens?: RecordKind; closes?: RecordKind } {
    return { opens: this.kinds.find((k) => k.role === 'opens'), closes: this.kinds.find((k) => k.role === 'closes') }
  }

  /** What people call a kind of record: the packs' name for it, sessions by the app's own word when the packs give none. */
  labelOf(kind: RecordKind): string {
    return kind.label ?? (kind.type === 'session' ? strings.sessionKind : kind.type)
  }

  /** The date field that says when a record of `type` happened: the one its packs name, or `date`. */
  datedOf(type: string): string {
    return this.kinds.find((k) => k.type === type)?.dated ?? 'date'
  }

  /** When a record happened, by the date field its kind is dated by. */
  readonly dayOf = (record: Entity): string => text(record, this.datedOf(record.type))

  /** The kinds of record kept under a subject's folder, or a group's. */
  kindsUnder(holder: 'subject' | 'group'): RecordKind[] {
    return this.kinds.filter((k) => k.under.includes(holder))
  }

  /** Reads the vault and starts taking in what other devices write to it. */
  connect() {
    void this.run(async () => {
      await this.load()
      if (await this.writeLocalForms()) await this.load()
    })
    this.unlisten = shell.onVaultChanged(() => void this.takeIn())
  }

  disconnect() {
    void this.unlisten?.then((stop) => stop())
    this.unlisten = undefined
  }

  /**
   * Reads the vault again without getting in the way — when another device wrote to it, or when the
   * person comes back to the window: no busy state (a click that brings the window back still lands
   * on what it was aimed at), no cleared message, and not in the middle of the person's own action
   * (it waits for that to end).
   */
  async takeIn() {
    // One reading at a time: a change that arrives while the vault is being read (by the person's
    // action or an earlier change) is taken in once that reading ends, so an older reading never
    // finishes after a newer one and leaves the window behind.
    if (this.busy || this.takingIn) {
      this.outsideChangeWaiting = true
      return
    }
    this.outsideChangeWaiting = false
    this.takingIn = true
    try {
      await shell.refresh()
      await this.load()
    } catch {
      // Coming back to the window, or the refresh button, reads the vault again.
    } finally {
      this.takingIn = false
      if (this.outsideChangeWaiting && !this.busy) void this.takeIn()
    }
  }

  /** The fields the vault declares for an entity type; none for a type this app does not read fields of. */
  fieldsOf(type: string): FieldView[] {
    return type === 'session'
      ? this.sessionFields
      : type === 'subject'
        ? this.subjectFields
        : type === 'practitioner'
          ? this.practitionerFields
          : (this.otherFields.get(type) ?? [])
  }

  /** What a person calls `scheme`: the label of a field that takes its values, whichever record holds it. */
  schemeName(scheme: string): string {
    return schemeLabel([...this.sessionFields, ...this.subjectFields, ...this.practitionerFields, ...[...this.otherFields.values()].flat()], scheme)
  }

  /** The entities a reference field of `type` may point at. */
  entitiesOf(type: string | null): Entity[] {
    return type === 'practitioner' ? this.practitioners : type === 'subject' ? this.subjects : type === 'group' ? this.groups : []
  }

  /**
   * What a kind of record's form holds after one is written: the date and who was there stay, the fields the
   * vault gives a fixed value start from it again, and the rest is cleared.
   */
  clearDraft(type = 'session') {
    const fields = this.fieldsOf(type)
    const draft = this.draftOf(type)
    this.setDraft(type, {
      values: {
        ...fixedDefaults(fields),
        ...Object.fromEntries(fields.filter((f) => f.kind === 'date' || f.kind === 'reference').map((f) => [f.name, draft[f.name] ?? ''])),
      },
      suggested: new Set(),
    })
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
    const [subjects, sessions, groups, practitioners, schemes, summary, sessionFields, subjectFields, practitionerFields, backup, sessionHistory, cases, scales] = await Promise.all([
      shell.entities('subject'),
      shell.entities('session'),
      shell.entities('group'),
      shell.entities('practitioner'),
      shell.schemes(),
      shell.summary(),
      shell.fields('session'),
      shell.fields('subject'),
      shell.fields('practitioner'),
      // Every write is followed by a backup: its outcome is read with the rest.
      shell.backupStatus(),
      shell.history('session'),
      shell.cases(),
      shell.scales(),
    ])
    if (!current()) return
    // The kinds of record besides sessions come from the packs: what the summary names is read next.
    const kinds = summary.kinds ?? []
    const others = await Promise.all(
      kinds
        .filter((k) => k.type !== 'session')
        .map(async (k) => {
          const [records, fields, history] = await Promise.all([shell.entities(k.type), shell.fields(k.type), shell.history(k.type)])
          return { type: k.type, records, fields, history }
        }),
    )
    if (!current()) return
    this.backup = backup
    this.corrected = new Set(
      [...sessionHistory, ...others.flatMap((o) => o.history)].filter((h) => h.changes.some((c) => c.op === 'update')).map((h) => h.id),
    )
    // In the order the packs place them, the kinds they place none for after, as the packs list them.
    this.kinds = kinds
      .map((k, i) => ({ k, i }))
      .sort((a, b) => (a.k.order ?? Infinity) - (b.k.order ?? Infinity) || a.i - b.i)
      .map(({ k }) => k)
    this.others = new Map(others.map((o) => [o.type, o.records]))
    this.otherFields = new Map(others.map((o) => [o.type, o.fields]))
    // A form standing on a hidden field is never shown; the sidecar decides which those are. Forms counting
    // sessions, the record every vault keeps, are listed before forms of other kinds of record.
    const { reports, exports } = (this.summary = {
      ...summary,
      reports: summary.reports.filter((f) => f.offered).sort((a, b) => Number(b.counts === 'session') - Number(a.counts === 'session')),
      exports: summary.exports.filter((f) => f.offered),
    })
    if (!this.exportKey && exports.length > 0) this.exportKey = `${exports[0].name}@${exports[0].version}`
    if (!this.reportKey && reports.length > 0) {
      // The newest version of the form last chosen on this computer, while the vault offers it; else the
      // newest form counting sessions, the record every vault keeps, before forms of other kinds of record.
      const remembered = storedReportForm(this.folder)
      const byVersion = [...reports].sort((a, b) => Number(b.counts === 'session') - Number(a.counts === 'session') || b.version - a.version)
      const chosen = byVersion.find((r) => r.name === remembered) ?? byVersion[0]
      this.reportKey = `${chosen.name}@${chosen.version}`
    }
    this.names = nameCollator(summary.locales)
    const byName = (a: Entity, b: Entity) => this.names.compare(text(a, 'name'), text(b, 'name'))
    this.subjects = [...subjects].sort(byName)
    this.sessions = sessions
    this.cases = new Map(cases.map((c) => [c.subject, c]))
    this.scaleCases = new Map((scales?.subjects ?? []).map((s) => [s.subject, s.cases]))
    this.scaleCodes = (scales?.scales ?? []).map((s) => s.code)
    this.scales = scales?.scales ?? []
    this.scaleResponses = scales?.responses?.[0]
    this.groups = [...groups].sort(byName)
    this.practitioners = practitioners
    this.schemes = schemes
    this.sessionFields = sessionFields
    this.subjectFields = subjectFields
    this.practitionerFields = practitionerFields
    this.draft = { ...startingValues(this, sessionFields), ...this.draft }
    for (const o of others) this.setDraft(o.type, { values: { ...startingValues(this, o.fields), ...this.draftOf(o.type) }, suggested: this.suggestedOf(o.type) })
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
      if (this.outsideChangeWaiting) void this.takeIn()
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
  /** Keeps this vault's backup in `folder` on this computer from now on (null: stops), and remembers it. */
  async setBackup(folder: string | null) {
    this.set({ notice: '' })
    await this.run(async () => {
      this.backup = await shell.setBackup(folder)
      this.backupProblem = undefined
      storeBackup(this.folder, folder)
    })
  }

  /** Copies the record files the vault lost back from its backup, and says how many came back. */
  async restoreFromBackup() {
    this.set({ notice: '' })
    await this.run(async () => {
      const { restored } = await shell.restoreFromBackup()
      await this.load()
      this.notice = strings.backupRestored(restored)
    })
  }

  /** Puts the backup's sound copies in place of the damaged record files, on the person's word. */
  async replaceDamagedFromBackup() {
    this.set({ notice: '' })
    await this.run(async () => {
      const { replaced } = await shell.replaceDamagedFromBackup()
      await this.load()
      this.notice = strings.backupReplaced(replaced)
    })
  }

  /** Takes up the backup this computer keeps for the vault. A folder it cannot use is said, and kept for next time. */
  async resumeBackup() {
    const folder = storedBackup(this.folder)
    if (!folder) return
    try {
      this.backup = await shell.setBackup(folder)
    } catch (e) {
      this.backup = { folder }
      this.backupProblem = typeof e === 'object' && e !== null && typeof (e as { code?: unknown }).code === 'string' ? (e as { code: string }).code : 'unknown'
    }
    this.changed()
  }

  /**
   * Writes the forms counting by the folder's own lists that it does not hold yet: a list kept
   * before such forms came with one, or a form a pack added since. A folder that cannot be written
   * to now is left as it is; the forms come at the next opening that can.
   */
  private async writeLocalForms(): Promise<boolean> {
    try {
      return (await shell.writeLocalForms(this.localFormSuffix())).length > 0
    } catch {
      // Nothing the person asked for failed: the forms follow when the folder takes writes again.
      return false
    }
  }

  /**
   * What follows a form's name in the name of the form counting a list's added items — in the
   * vault's language, as the name of the form it follows is, whatever language this window speaks.
   */
  localFormSuffix(): string {
    return tables[pickLocale(this.summary?.locales ?? [])].localFormSuffix
  }

  /** Picks the report form to work on, and remembers it for this vault on this computer. */
  chooseReport(key: string) {
    storeReportForm(this.folder, key.split('@')[0])
    this.set({ reportKey: key })
  }

  /** Raises the vault's format — a person chose to — and takes on the pack versions this app carries that waited for it. */
  async updateBundledPacks() {
    this.set({ notice: '' })
    await this.run(async () => {
      const updated = await shell.updateBundledPacks()
      this.packsWaiting = false
      await this.load()
      if (await this.writeLocalForms()) await this.load()
      if (updated.length > 0) this.notice = strings.packsUpdated
    })
  }

  async applyPack(folder: string, raiseFormat = false) {
    this.set({ notice: '', raiseFormatFor: undefined })
    await this.run(async () => {
      let added: string[]
      try {
        added = await shell.applyPack(folder, raiseFormat)
      } catch (e) {
        // Raising the vault's format shuts out earlier versions of the app: a person says so first.
        if (isCommandError(e) && e.code === 'needs-new-format') {
          this.raiseFormatFor = folder
          return
        }
        throw e
      }
      await this.load()
      if (await this.writeLocalForms()) await this.load()
      this.notice = packNotice(added, this.summary, (scheme) => this.schemeName(scheme))
      // A new form version is what the person came for: offer it, if this screen shows it.
      const offered = new Set((this.summary?.reports ?? []).map((r) => `${r.name}@${r.version}`))
      const report = added
        .map(definitionOf)
        .map((d) => (d?.kind === 'report' ? `${d.name}@${d.version}` : ''))
        .find((key) => offered.has(key))
      if (report) this.reportKey = report
    })
  }
}

/** What a pack brought, in words, and what the vault still lacks after it. */
function packNotice(added: string[], summary: VaultSummary | undefined, schemeName: (scheme: string) => string): string {
  if (added.length === 0) return strings.packNothingNew
  let notice: string
  // A pack that brings its manifest is named once; a folder of loose definitions, file by file.
  const manifests = added.map(definitionOf).filter((d) => d?.kind === 'pack')
  const packs = summary?.packs ?? []
  const named = manifests.map((m) => packs.find((p) => p.id === m!.name && p.version === m!.version)).filter((p) => !!p)
  if (named.length > 0) {
    notice = named.map((p) => strings.packApplied(p!.label, p!.version)).join(' ')
  } else {
    const formLabel = (forms: { name: string; version: number; label: string }[] | undefined, name: string, version: number) =>
      forms?.find((f) => f.name === name && f.version === version)?.label ?? name
    const names = added.map((p) => {
      const d = definitionOf(p)
      if (!d) return p
      switch (d.kind) {
        case 'scheme': return strings.definition.scheme(schemeName(d.name), d.version)
        case 'crosswalk': return strings.definition.crosswalk(schemeName(d.name), d.from, d.to)
        case 'report': return strings.definition.report(formLabel(summary?.reports, d.name, d.version), d.version)
        case 'export': return strings.definition.export(formLabel(summary?.exports, d.name, d.version), d.version)
        case 'labels': return strings.definition.labels(d.name, d.version, d.locale)
        case 'fields': return strings.definition.fields(d.name, d.version, d.type)
        default: return strings.definition[d.kind](d.name, d.version)
      }
    })
    notice = strings.packAdded(names)
  }
  // A listed file the vault holds but could not read is not a disagreement: the files that could not
  // be read are said, each with why, where the vault shows them.
  const issues = (summary?.packIssues ?? []).filter((i) => i.kind !== 'FileNotRead')
  if (issues.length > 0) notice += ' ' + strings.packIssues(issues.length)
  const behind = leftBehind([...(summary?.reports ?? []), ...(summary?.exports ?? [])])
  if (behind.length > 0) notice += ' ' + strings.packFormsBehind(behind.map((f) => strings.reportFormOption(f.label, f.version)))
  const unlinked = summary?.unlinked ?? []
  if (unlinked.length > 0) notice += ' ' + strings.packSchemeUnlinked(unlinked.map((u) => strings.definition.scheme(schemeName(u.scheme), u.version)))
  return notice
}

/**
 * What an empty form starts with: today in a required date, and the one entity a reference can point
 * at when there is only one (a vault kept by a single practitioner) — required or not, as a default a
 * person can clear, so every kind of record starts with the practitioner a session does.
 */
function startingValues(store: VaultStore, fields: FieldView[]): SessionDraft {
  const values: SessionDraft = fixedDefaults(fields)
  for (const f of fields) {
    if (f.hidden) continue
    if (f.kind === 'date' && f.required) values[f.name] = today()
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
