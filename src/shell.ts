import { invoke } from '@tauri-apps/api/core'
import type { Entity, Scheme } from './records.js'
import type { RunRecord } from './report.js'

/** What the engine reports when a vault opens. */
export interface VaultSummary {
  unreadable: unknown[]
  reports: { name: string; version: number; label: string }[]
  [key: string]: unknown
}

/** The shell's commands, typed. Every failure rejects with a `CommandError`. */
export const shell = {
  createVault: (folder: string, passphrase: string) => invoke<string>('create_vault', { folder, passphrase }),
  confirmRecoveryKit: (typed: string) => invoke<void>('confirm_recovery_kit', { typed }),
  openVault: (folder: string, passphrase: string) => invoke<VaultSummary>('open_vault', { folder, passphrase }),
  closeVault: () => invoke<void>('close_vault'),
  /** Records a change through one of the engine's `/changes/…` routes; returns the file's path. */
  record: (route: string, request: object) => invoke<string>('record', { route, request }),
  entities: (entityType: string) => invoke<Entity[]>('entities', { entityType }),
  schemes: () => invoke<Scheme[]>('schemes'),
  summary: () => invoke<VaultSummary>('vault_summary'),
  /** Runs a monthly report; the engine keeps its run record in the vault. */
  runReport: (report: string, version: number, year: number, month: number) =>
    invoke<RunRecord>('run_report', { report, version, year, month }),
}
