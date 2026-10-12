import { en } from './en.js'
import { ko } from './ko.js'

/** The shape every table has: the Korean one, which the others are held to. */
export type Strings = typeof ko

export const tables = { ko, en } satisfies Record<string, Strings>

export type Locale = keyof typeof tables

/** Each language the app speaks, named in its own words — the same whatever language the app speaks. */
export const languageNames: Record<Locale, string> = { ko: '한국어', en: 'English' }

/** The app's language for a list of preferred language tags: the first whose language has a table, else English. */
export function pickLocale(tags: readonly string[]): Locale {
  for (const tag of tags) {
    const language = tag.split('-')[0].toLowerCase()
    if (language in tables) return language as Locale
  }
  return 'en'
}
