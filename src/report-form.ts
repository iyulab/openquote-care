// The report form a person last chose for a vault on this computer, by name — a revision brings a
// newer version of the same form — so the statistics screen opens on it again rather than on
// whichever form sorts first. A setting of the device, per vault.
import { safeStorage } from './device-storage.js'

const KEY = 'openquote-care.report-form:'

/** The name of the form last chosen for the vault in `vaultFolder` on this computer, or null. */
export function storedReportForm(vaultFolder: string, storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): string | null {
  try {
    return storage?.getItem(KEY + vaultFolder) || null
  } catch {
    return null
  }
}

/** Remembers `form` as the one last chosen for the vault in `vaultFolder`. */
export function storeReportForm(vaultFolder: string, form: string, storage: Pick<Storage, 'setItem'> | undefined = safeStorage()): void {
  try {
    storage?.setItem(KEY + vaultFolder, form)
  } catch {
    // Storage refused: the screen opens on the newest form next time.
  }
}
