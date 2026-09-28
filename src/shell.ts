import { invoke } from '@tauri-apps/api/core'

/** What the engine reports when a vault opens. */
export interface VaultSummary {
  unreadable: unknown[]
  [key: string]: unknown
}

/** The shell's commands, typed. Every failure rejects with a `CommandError`. */
export const shell = {
  createVault: (folder: string, passphrase: string) => invoke<string>('create_vault', { folder, passphrase }),
  confirmRecoveryKit: (typed: string) => invoke<void>('confirm_recovery_kit', { typed }),
  openVault: (folder: string, passphrase: string) => invoke<VaultSummary>('open_vault', { folder, passphrase }),
  closeVault: () => invoke<void>('close_vault'),
}
