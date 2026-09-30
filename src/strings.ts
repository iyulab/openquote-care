// Every user-facing string lives in a table under locales/, one per language, so a change of wording
// touches one place. The few the shell shows before any window exists sit in native-strings.json,
// which the tables re-export and the shell compiles in.
import { ko } from './locales/ko.js'
import { pickLocale, tables, type Locale, type Strings } from './locales/index.js'

/** The table in use. Modules read it at the time they draw, so switching before the app starts reaches all of them. */
export let strings: Strings = ko

/** The language of the table in use. */
export let locale: Locale = 'ko'

/** Of names given per language, the one in the app's language, else the English one, else `fallback`. */
export function inAppLanguage(names: Readonly<Record<string, string>>, fallback: string): string {
  return names[locale] ?? names.en ?? fallback
}

/** Uses the table for a system language tag such as `ko-KR` (English when there is none) and says which. */
export function useLocale(tag: string): Locale {
  locale = pickLocale([tag])
  strings = tables[locale]
  return locale
}
