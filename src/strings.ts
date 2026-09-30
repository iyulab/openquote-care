// Every user-facing string lives in a table under locales/, one per language, so a change of wording
// touches one place. The few the shell shows before any window exists sit in native-strings.json,
// which the tables re-export and the shell compiles in.
import { ko } from './locales/ko.js'
import { pickLocale, tables, type Locale, type Strings } from './locales/index.js'

/** The table in use. Modules read it at the time they draw, so switching before the app starts reaches all of them. */
export let strings: Strings = ko

/** Uses the table for a system language tag such as `ko-KR` (English when there is none) and says which. */
export function useLocale(tag: string): Locale {
  const locale = pickLocale([tag])
  strings = tables[locale]
  return locale
}
