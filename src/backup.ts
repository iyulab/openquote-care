// The folder this computer keeps a vault's backup in. Like the idle lock it is a setting of the
// device, not of the vault — and one per vault, since a device may open more than one.

const KEY = 'openquote-care.backup:'

/** The backup folder this computer keeps for the vault in `vaultFolder`, or null. */
export function storedBackup(vaultFolder: string, storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): string | null {
  try {
    return storage?.getItem(KEY + vaultFolder) || null
  } catch {
    return null
  }
}

/** Remembers `backup` for the vault in `vaultFolder` on this computer; null forgets it. */
export function storeBackup(vaultFolder: string, backup: string | null, storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined = safeStorage()): void {
  try {
    if (backup) storage?.setItem(KEY + vaultFolder, backup)
    else storage?.removeItem(KEY + vaultFolder)
  } catch {
    // Storage refused: the backup is kept until the window closes.
  }
}

function safeStorage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}
