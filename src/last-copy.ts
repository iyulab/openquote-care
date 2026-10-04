// The last whole-record copy this computer made of a vault: when, where, whether session content
// went in, and how many changes the vault's records had been built from then — so the screen can
// say when records changed after it. A setting of the device, kept per vault, like the backup folder.

import { safeStorage } from './device-storage.js'

const KEY = 'openquote-care.plain-copy:'

export interface LastCopy {
  /** When it was made, in milliseconds since 1970. */
  at: number
  /** The folder it was written to. */
  folder: string
  withNarrative: boolean
  /** How many changes the records it holds were built from. */
  changes: number
}

/** The last copy this computer made of the vault in `vaultFolder`, or null. */
export function storedCopy(vaultFolder: string, storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): LastCopy | null {
  try {
    const value = JSON.parse(storage?.getItem(KEY + vaultFolder) ?? 'null') as Partial<LastCopy> | null
    return value && typeof value.at === 'number' && typeof value.folder === 'string' && typeof value.changes === 'number'
      ? { at: value.at, folder: value.folder, withNarrative: value.withNarrative === true, changes: value.changes }
      : null
  } catch {
    return null
  }
}

/** Remembers `copy` as the last one this computer made of the vault in `vaultFolder`. */
export function storeCopy(vaultFolder: string, copy: LastCopy, storage: Pick<Storage, 'setItem'> | undefined = safeStorage()): void {
  try {
    storage?.setItem(KEY + vaultFolder, JSON.stringify(copy))
  } catch {
    // Storage refused: the copy is remembered until the window closes, by the screen that made it.
  }
}
