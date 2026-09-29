import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { Classified, Entity, Resolution, Scheme } from './records.js'
import type { ExportTable } from './export.js'
import type { Comparison, KeptRun, RunRecord } from './report.js'
import type { FormEntry } from './forms.js'

/** What the engine reports when a vault opens. */
export interface VaultSummary {
  /** Files the engine could not use or the vault could not decrypt; the rest is still read. */
  unreadable: { path: string; reason: string; detail: string }[]
  reports: FormEntry[]
  exports: FormEntry[]
  /** Scheme versions no crosswalk leads to from an earlier version. */
  unlinked: { scheme: string; version: number }[]
  /** This computer's device id. */
  device: string
  /** Names people gave the devices writing to this vault, by device id. */
  devices: Record<string, string>
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
  /** Whether this installation reports the app's own errors (content-free; see docs/privacy.md). */
  diagnosticsEnabled: () => invoke<boolean>('diagnostics_enabled'),
  /** Records a change through one of the engine's `/changes/…` routes; returns the file's path. */
  record: (route: string, request: object) => invoke<string>('record', { route, request }),
  entities: (entityType: string) => invoke<Entity[]>('entities', { entityType }),
  schemes: () => invoke<Scheme[]>('schemes'),
  summary: () => invoke<VaultSummary>('vault_summary'),
  /** Reads the vault again, taking in what other devices sharing its folder wrote. */
  refresh: () => invoke<VaultSummary>('refresh'),
  /** Calls `f` when another device (or a sync client) changed the open vault's files. */
  onVaultChanged: (f: () => void): Promise<UnlistenFn> => listen('vault-changed', () => f()),
  /** Adds a data pack's new schemes, crosswalks and report forms; returns the paths added. */
  applyPack: (folder: string) => invoke<string[]>('apply_pack', { folder }),
  runs: () => invoke<KeptRun[]>('runs'),
  compareRuns: (earlier: string, later: string) => invoke<Comparison>('compare_runs', { earlier, later }),
  /** Where each value lands in `targetVersion` of its scheme, through the vault's crosswalks. */
  resolve: (targetVersion: number, values: Classified[]) => invoke<Resolution[]>('resolve', { targetVersion, values }),
  /** Runs a monthly report; the engine keeps its run record in the vault. */
  runReport: (report: string, version: number, year: number, month: number) =>
    invoke<RunRecord>('run_report', { report, version, year, month }),
  /** Lays a month's records out as an export form's rows; nothing is kept in the vault. */
  runExport: (exportName: string, version: number, year: number, month: number) =>
    invoke<ExportTable>('run_export', { export: exportName, version, year, month }),
}
