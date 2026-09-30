import { en } from './en.js'
import { ko } from './ko.js'

/** The shape every table has: the Korean one, which the others are held to. */
export type Strings = typeof ko

export const tables = { ko, en } satisfies Record<string, Strings>

export type Locale = keyof typeof tables

/** The app's language for a list of preferred language tags: the first whose language has a table, else English. */
export function pickLocale(tags: readonly string[]): Locale {
  for (const tag of tags) {
    const language = tag.split('-')[0].toLowerCase()
    if (language in tables) return language as Locale
  }
  return 'en'
}
