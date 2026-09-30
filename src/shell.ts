import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { Entity, PendingChoice, Scheme } from './records.js'
import type { ExportTable } from './export.js'
import type { Comparison, KeptRun, RunRecord } from './report.js'
import type { FormEntry } from './forms.js'

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
  label: string
  /** Other names the field goes by, matched when data is taken in. */
  aliases: string[]
}

/** What the engine reports when a vault opens. */
export interface VaultSummary {
  /** Files the engine could not use or the vault could not decrypt; the rest is still read. */
  unreadable: { path: string; reason: string; detail: string; kind: VaultFileKind }[]
  reports: FormEntry[]
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
  [key: string]: unknown
}

/** The shell's commands, typed. Every failure rejects with a `CommandError`. */
export const shell = {
  createVault: (folder: string, passphrase: string) => invoke<string>('create_vault', { folder, passphrase }),
  confirmRecoveryKit: (typed: string) => invoke<void>('confirm_recovery_kit', { typed }),
  openVault: (folder: string, passphrase: string) => invoke<VaultSummary>('open_vault', { folder, passphrase }),
  /** Opens with the recovery key from the kit, for a forgotten passphrase. */
  openVaultWithKey: (folder: string, recoveryKey: string) => invoke<VaultSummary>('open_vault_with_key', { folder, recoveryKey }),
  /** Sets a new passphrase for the open vault; the old one stops opening it on every device. */
  changePassphrase: (passphrase: string) => invoke<void>('change_passphrase', { passphrase }),
  closeVault: () => invoke<void>('close_vault'),
  /** The app's language as a language tag: the system's display language, or `OPENQUOTE_UI_LOCALE` when set. */
  uiLocale: () => invoke<string>('ui_locale'),
  /** Whether this installation reports the app's own errors (content-free; see docs/privacy.md). */
  diagnosticsEnabled: () => invoke<boolean>('diagnostics_enabled'),
  /** Records a change through one of the engine's `/changes/…` routes; returns the file's path. */
  record: (route: string, request: object) => invoke<string>('record', { route, request }),
  entities: (entityType: string) => invoke<Entity[]>('entities', { entityType }),
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
  applyPack: (folder: string) => invoke<string[]>('apply_pack', { folder }),
  runs: () => invoke<KeptRun[]>('runs'),
  compareRuns: (earlier: string, later: string) => invoke<Comparison>('compare_runs', { earlier, later }),
  /** Which of a form run's pending records still wait for a person, with the codes each may take. */
  pending: (report: string, version: number, records: string[]) => invoke<PendingChoice[]>('pending', { report, version, records }),
  /** Runs a monthly report; the engine keeps its run record in the vault. */
  runReport: (report: string, version: number, year: number, month: number) =>
    invoke<RunRecord>('run_report', { report, version, year, month }),
  /** Lays a month's records out as an export form's rows; nothing is kept in the vault. */
  runExport: (exportName: string, version: number, year: number, month: number) =>
    invoke<ExportTable>('run_export', { export: exportName, version, year, month }),
}
