/** A scheme a form classifies by, at a version older than the latest one the vault holds. */
export interface SchemeLag {
  scheme: string
  version: number
  latest: number
}

/** A report or export form as the vault summary lists it. */
export interface FormEntry {
  name: string
  version: number
  label: string
  behind: SchemeLag[]
  /** False when the form reads a field the vault's packs hide: hiding a field hides what is built on it. */
  offered: boolean
}

/**
 * The forms whose newest version still classifies by an older scheme version — after a revision,
 * the pack that brought the new scheme did not bring a matching form. Older versions of a form lag
 * by design (they serve the months before the revision), so only a form's newest version counts.
 */
export function leftBehind(forms: FormEntry[]): FormEntry[] {
  const newest = new Map<string, FormEntry>()
  for (const f of forms) {
    const seen = newest.get(f.name)
    if (!seen || seen.version < f.version) newest.set(f.name, f)
  }
  return [...newest.values()].filter((f) => f.behind.length > 0)
}
