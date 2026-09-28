import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { Classified, Entity, Resolution, Scheme } from './records.js'
import type { Comparison, KeptRun, RunRecord } from './report.js'

/** What the engine reports when a vault opens. */
export interface VaultSummary {
  unreadable: unknown[]
  reports: { name: string; version: number; label: string }[]
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
  closeVault: () => invoke<void>('close_vault'),
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
}
