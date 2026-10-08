import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { Entity, EntityHistory, PendingChoice, Scheme, Suggestions } from './records.js'
import type { ExportTable } from './export.js'
import type { Comparison, KeptRun, RunRecord } from './report.js'
import type { FormEntry, ReportEntry } from './forms.js'

/** New versions on this installation: whether it can update itself, and what it found. */
export interface UpdateStatus {
  /** This installation can update itself (a released installer). */
  configured: boolean
  /** It looks for new versions: configured and not turned off. */
  checking: boolean
  /** The newer version found, if any. */
  available: string | null
  /** Its installer is downloaded and checked: it is installed when the app closes. */
  ready: boolean
}

/**
 * A value a record about to be written takes from its subject (`subjectField`), as it stands for the record's date:
 * the subject's value, the day it was written, the years passed since, and what the record would take (null when
 * nothing can be offered). `stale` says the year it was written in is over: a person looks at it first.
 */
export interface CarryView {
  field: string
  subjectField: string
  label: string
  value: string | null
  writtenOn: string | null
  yearsPassed: number
  offer: string | null
  stale: boolean
}

/** Feedback on this installation: whether it can send any, and what goes along with a message. */
export interface FeedbackStatus {
  configured: boolean
  version: string
  os: string
  /** The most a message may hold, in characters. */
  maxMessage: number
}

/** Whether this installation sends its errors, starts and ends and time on each screen (content-free; see docs/privacy.md). */
export interface DiagnosticsStatus {
  configured: boolean
}

/** What the app has written to send, one JSON object per line — exactly what is sent; empty when none. */
export interface DiagnosticsLines {
  /** The app's own errors. */
  reports: string
  /** When the app started and ended, and the time on each screen. */
  sessions: string
}

/** What a vault file was for, as the engine reads it from the path; only the fields that apply are set. */
export interface VaultFileKind {
  kind: 'subject' | 'group' | 'practitioners' | 'devices' | 'scheme' | 'crosswalk' | 'report' | 'export' | 'pack' | 'labels' | 'fields' | 'run' | 'other'
  /** The subject's or group's id. */
  id?: string | null
  /** The scheme, report form, export form or pack. */
  name?: string | null
  /** The entity type a field definition file declares fields for. */
  type?: string | null
  version?: number | null
  from?: number | null
  to?: number | null
  year?: number | null
}

/** A field of an entity type as the vault's packs declare it, with its label and aliases in the vault's locale. */
export interface FieldView {
  name: string
  kind: 'text' | 'date' | 'number' | 'coded' | 'reference' | 'references'
  /** The scheme a coded field is bound to. */
  scheme: string | null
  /** The entity type a reference field points at. */
  refType: string | null
  required: boolean
  hidden: boolean
  /** `narrative` fields hold written content, which never leaves the record. */
  tier: 'structured' | 'narrative'
  /** The subject's field whose value the record takes when it is written. */
  defaultFromSubject: string | null
  /** The fixed value the field starts from — a text, a number as written, or a code — when the vault gives one. */
  defaultValue?: string | null
  label: string
  /** Other names the field goes by, matched when data is taken in. */
  aliases: string[]
  /** True for a coded field that takes several values, one of them primary. */
  many?: boolean
}

/** A track a vault can be made on: the packs it starts from, named in the app's language. */
export interface TrackView {
  id: string
  label: string
  /** The locale its packs label things in. */
  locale: string
}

/** What the engine reports when a vault opens. */
/**
 * A kind of record the vault's packs declare: what people call it in the vault's locale (null when no pack names
 * it) and where one is kept — under a subject, a group or either.
 */
export interface RecordKind {
  type: string
  label: string | null
  under: ('subject' | 'group')[]
  /** Its place among the kinds, a smaller number first; null when the packs give none. */
  order?: number | null
  /** The date field that says when a record of the kind happened (`date` unless the packs say). */
  dated?: string
  /** Whether a record of the kind opens or closes a subject's case; null when the packs give it no role. */
  role?: 'opens' | 'closes' | null
}

/** One of a subject's cases, as the engine reads it from the records: records by id, in time order. */
export interface CaseView {
  /** The record that opened it, or null when it began without one. */
  opening: string | null
  /** The record that closed it, or null when none has. */
  closing: string | null
  /** `YYYY-MM-DD` of its first record, and of the record that closed it. */
  start: string
  end: string | null
  records: string[]
  /** Records dated after the closing and before the next opening — a follow-up, say. */
  afterClosing: string[]
  /** Another opening came before any record closed it. */
  followedByOpening: boolean
  open: boolean
}

/** A subject's cases, oldest first, and its records with no date to place them by. */
export interface SubjectCases {
  subject: string
  cases: CaseView[]
  undated: string[]
}

export interface VaultSummary {
  /** Files the engine could not use or the vault could not decrypt; the rest is still read. */
  unreadable: { path: string; reason: string; detail: string; kind: VaultFileKind }[]
  reports: ReportEntry[]
  exports: FormEntry[]
  /** Scheme versions no crosswalk leads to from an earlier version. */
  unlinked: { scheme: string; version: number }[]
  /** This computer's device id. */
  device: string
  /** Names people gave the devices writing to this vault, by device id. */
  devices: Record<string, string>
  /** The data packs the vault holds, at their latest versions. */
  packs: { id: string; version: number; label: string; depends: Record<string, number> }[]
  /** How the vault's packs do not fit together (a missing dependency or file, a cycle). */
  packIssues: { kind: string; pack: string; detail: string }[]
  /** The locales the vault's packs label things in, the most specific pack's first; empty for a vault without labels. */
  locales: string[]
  /** The kinds of record the vault's packs declare under a subject or a group, in pack order. */
  kinds: RecordKind[]
  /** On opening: the track a vault made before packs named themselves was taken onto, with its names per language. */
  adopted?: { track: string; label: Record<string, string> }
  /** On opening: the packs the vault held an earlier version of, brought up to the version this app carries. */
  updatedPacks?: string[]
  /** On opening: the packs whose newer version this app carries needs the vault raised to `format` first — a person's choice. */
  waitingPacks?: { packs: string[]; format: number }
  /** On opening: the folder is a backup this app keeps of another vault. */
  backupCopy?: boolean
  /** Opened with the recovery key while the key file is missing or damaged: only a new passphrase mends it. */
  keyFileLost?: boolean
  [key: string]: unknown
}

/** Where this computer keeps the open vault's backup, and how the last backup went. */
export interface BackupStatus {
  folder: string | null
  /** When the last backup ran, in milliseconds since 1970. */
  at?: number
  copied?: number
  /** The key file followed a new passphrase. */
  keyReplaced?: boolean
  /** Files the backup holds with other content than the vault: named, never replaced. */
  differs?: string[]
  /** Record files the vault lost that the backup holds sound: what restoring copies back. */
  missing?: string[]
  /** Record files damaged in the vault, with a sound copy in the backup. */
  damaged?: string[]
  /** Record files damaged in the backup, sound in the vault. */
  damagedInBackup?: string[]
  /** Record files the two copies hold differently where which one is sound cannot be told. */
  unresolved?: string[]
  /** Why the last backup did not go through, as an error code. */
  error?: string
}

/** The shell's commands, typed. Every failure rejects with a `CommandError`. */
export const shell = {
  /** The tracks a vault can be made on, the one the app's language suggests first. */
  tracks: () => invoke<TrackView[]>('tracks'),
  /** Prepares a vault on `track` (the suggested one when not given) and returns its recovery key. */
  createVault: (folder: string, passphrase: string, track?: string) => invoke<string>('create_vault', { folder, passphrase, track }),
  confirmRecoveryKit: (typed: string) => invoke<void>('confirm_recovery_kit', { typed }),
  openVault: (folder: string, passphrase: string) => invoke<VaultSummary>('open_vault', { folder, passphrase }),
  /** Writes back the vault declaration a vault folder lost (it still holds its key file). */
  restoreDeclaration: (folder: string) => invoke<void>('restore_declaration', { folder }),
  /** Opens with the recovery key from the kit, for a forgotten passphrase. */
  openVaultWithKey: (folder: string, recoveryKey: string) => invoke<VaultSummary>('open_vault_with_key', { folder, recoveryKey }),
  /** Sets a new passphrase for the open vault; the old one stops opening it on every device. */
  changePassphrase: (passphrase: string) => invoke<void>('change_passphrase', { passphrase }),
  closeVault: () => invoke<void>('close_vault'),
  /** The app's language as a language tag: the system's display language, or `OPENQUOTE_UI_LOCALE` when set. */
  uiLocale: () => invoke<string>('ui_locale'),
  /** Whether this installation sends what it writes about itself (content-free; see docs/privacy.md). */
  diagnosticsStatus: () => invoke<DiagnosticsStatus>('diagnostics_status'),
  /** What has been written to send so far. */
  diagnosticsReports: () => invoke<DiagnosticsLines>('diagnostics_reports'),
  /** The screen shown now by its fixed name, or null while the window is hidden — only the name, for time on each screen. */
  screenShown: (name: string | null) => invoke<void>('screen_shown', { name }),
  /** Whether this installation can send feedback (see docs/privacy.md), and what goes along with a message. */
  feedbackStatus: () => invoke<FeedbackStatus>('feedback_status'),
  /** Sends what the person wrote, with a reply address when they gave one; resolves once the service took it. */
  sendFeedback: (message: string, email?: string) => invoke<void>('send_feedback', { message, email: email || null }),
  /** Whether this installation looks for new versions, and the newer one it found. */
  updateStatus: () => invoke<UpdateStatus>('update_status'),
  /** Turns looking for new versions on or off, remembered for the next launches. */
  setUpdateChecking: (on: boolean) => invoke<void>('set_update_checking', { on }),
  /** Downloads and installs the newer version found: the vault is closed and the app starts again. Returns only on failure. */
  applyUpdate: () => invoke<void>('apply_update'),
  /** Calls `f` with the version when a newer one is found. */
  onUpdateAvailable: (f: (version: string) => void): Promise<UnlistenFn> => listen<string>('update-available', (e) => f(e.payload)),
  /** Hands an error the window did not handle to the shell, which keeps only its type and the app's own frames. */
  reportWindowError: (kind: string, stack: string) => invoke<void>('report_window_error', { kind, stack }),
  /** Records a change through one of the engine's `/changes/…` routes; returns the file's path. */
  record: (route: string, request: object) => invoke<string>('record', { route, request }),
  entities: (entityType: string) => invoke<Entity[]>('entities', { entityType }),
  /** Every change each entity of a type was built from, oldest first. */
  history: (entityType: string) => invoke<EntityHistory[]>('history', { entityType }),
  /** Every subject's cases, read from its records by the roles the packs give its kinds of record. */
  cases: () => invoke<SubjectCases[]>('cases'),
  schemes: () => invoke<Scheme[]>('schemes'),
  /** The fields the vault's packs declare for an entity type, labelled in the vault's locale; none without field definitions. */
  fields: (entityType: string) => invoke<FieldView[]>('fields', { entityType }),
  /** The version of a scheme in force on a date (`YYYY-MM-DD`), or null when the vault holds none. */
  inForce: (scheme: string, date: string) => invoke<number | null>('in_force', { scheme, date }),
  summary: () => invoke<VaultSummary>('vault_summary'),
  /** Reads the vault again, taking in what other devices sharing its folder wrote. */
  refresh: () => invoke<VaultSummary>('refresh'),
  /** Calls `f` when another device (or a sync client) changed the open vault's files. */
  onVaultChanged: (f: () => void): Promise<UnlistenFn> => listen('vault-changed', () => f()),
  /** Adds a data pack's new schemes, crosswalks and report forms; returns the paths added. */
  /**
   * Applies the data pack in `folder`. One that needs the vault in a newer format fails with
   * `needs-new-format` unless `raiseFormat` says a person chose to raise it.
   */
  applyPack: (folder: string, raiseFormat = false) => invoke<string[]>('apply_pack', { folder, raiseFormat }),
  /**
   * Adds an item to the vault's own list beside `scheme`, counted as its item `anchor`; the paths
   * added — with the first item, the forms counting by the list, each named after the form it
   * follows with `formSuffix` after that name. Fails `needs-new-format` unless `raiseFormat`, as a
   * pack does.
   */
  addLocalItem: (scheme: string, date: string, label: string, anchor: string, formSuffix: string, raiseFormat = false) =>
    invoke<string[]>('add_local_item', { scheme, date, label, anchor, raiseFormat, formSuffix }),
  /** Writes the forms counting by the vault's own lists that it does not hold yet; the paths added. */
  writeLocalForms: (formSuffix: string) => invoke<string[]>('write_local_forms', { formSuffix }),
  /** Raises the open vault's format and takes on the bundled pack versions that waited for it; returns their ids. */
  updateBundledPacks: () => invoke<string[]>('update_bundled_packs'),
  /** Keeps the open vault's backup in `folder` from now on (null: stops); brings it up to date at once. */
  setBackup: (folder: string | null) => invoke<BackupStatus>('set_backup', { folder }),
  backupStatus: () => invoke<BackupStatus>('backup_status'),
  /** Copies the record files the vault lost back from its backup; the vault is read again with them. */
  restoreFromBackup: () => invoke<{ restored: number; backup: BackupStatus }>('restore_from_backup'),
  /** Puts the backup's sound copy in place of each damaged record file; the damaged one is moved aside. */
  replaceDamagedFromBackup: () => invoke<{ replaced: number; backup: BackupStatus }>('replace_damaged_from_backup'),
  /** Writes a copy that reads without the app into a new folder `name` inside `folder`; answers the new folder. */
  writePlainCopy: (folder: string, name: string, files: { name: string; content: string }[]) =>
    invoke<string>('write_plain_copy', { folder, name, files }),
  runs: () => invoke<KeptRun[]>('runs'),
  compareRuns: (earlier: string, later: string) => invoke<Comparison>('compare_runs', { earlier, later }),
  /** Which of a form run's pending records still wait for a person, with the codes each may take. */
  /** `to` is the last day of the run's period: a form counting in the version in force waits in that day's version. */
  pending: (report: string, version: number, records: string[], to: string) => invoke<PendingChoice[]>('pending', { report, version, records, to }),
  /**
   * Codes suggested for the coded fields a record being entered has no value for, given the values
   * it holds (as they are recorded) and the date it is for; nothing is kept.
   */
  /** What a record of `entityType` dated `date` would take from subject `subject`, field by field; nothing is written. */
  carry: (entityType: string, subject: string, date: string) => invoke<CarryView[]>('carry', { entityType, subject, date }),
  suggestions: (entityType: string, date: string, fields: Record<string, unknown>) =>
    invoke<Suggestions>('suggestions', { entityType, date, fields }),
  /**
   * Runs a report form from `from` to `to` (`YYYY-MM-DD`), or — without `to` — over the period of the
   * form's unit that holds `from` (its day, month or year; a range form needs both). The engine keeps
   * its run record in the vault.
   */
  runReport: (report: string, version: number, from: string, to?: string) =>
    invoke<RunRecord>('run_report', { report, version, from, to: to ?? null }),
  /** Lays the records from `from` to `to` (`YYYY-MM-DD`) out as an export form's rows; nothing is kept in the vault. */
  runExport: (exportName: string, version: number, from: string, to: string) =>
    invoke<ExportTable>('run_export', { export: exportName, version, from, to }),
}
