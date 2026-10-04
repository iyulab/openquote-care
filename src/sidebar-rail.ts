// Whether the open vault's sidebar is folded to its icon rail on this computer.

import { safeStorage } from './device-storage.js'

const KEY = 'openquote-care.sidebar-rail'

/** Folded on this computer, as last left; a setting of the device, like the idle lock. */
export function sidebarRail(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): boolean {
  try {
    return storage?.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function setSidebarRail(folded: boolean, storage: Pick<Storage, 'setItem'> | undefined = safeStorage()): void {
  try {
    storage?.setItem(KEY, folded ? '1' : '0')
  } catch {
    // Storage refused: the choice lasts until the window closes.
  }
}
