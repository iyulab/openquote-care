// How names people gave things (subjects, groups, practitioners, devices) are put in order.

/** The locale names sort in when the vault says none: every vault made before packs carried labels. */
export const DEFAULT_NAME_LOCALE = 'ko'

/**
 * Orders names by the vault's locales — those its packs label things in, the most specific pack's
 * first — falling back to {@link DEFAULT_NAME_LOCALE}. One place, so every list of names in the
 * app agrees.
 */
export function nameCollator(vaultLocales: readonly string[] = []): Intl.Collator {
  return new Intl.Collator([...vaultLocales, DEFAULT_NAME_LOCALE])
}
