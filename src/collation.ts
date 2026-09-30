// How names people gave things (subjects, groups, practitioners, devices) are put in order.

import { locale } from './strings.js'

/**
 * Orders names by the vault's locales — those its packs label things in, the most specific pack's
 * first — falling back to the app's language when the vault names none. One place, so every list
 * of names in the app agrees.
 */
export function nameCollator(vaultLocales: readonly string[] = []): Intl.Collator {
  return new Intl.Collator([...vaultLocales, locale])
}
