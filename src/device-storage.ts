// Settings of this computer rather than of a vault (the idle lock, a vault's backup folder, the
// sidebar's width) live in the window's local storage, which a locked-down profile may refuse.

/** The window's local storage, or none when the profile refuses it. */
export function safeStorage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}
