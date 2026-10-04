// Finding sessions by what they say: every word a person types must appear somewhere in a session —
// a field's value in words, what was written in it, or the names of the people it is about. The
// search runs over the records the window already holds; nothing is written down to make it faster.

import type { Entity } from './records.js'

/** One thing a session says, as a person reads it: the field's label and its value in words. */
export interface SessionText {
  label: string
  text: string
}

/** A session that holds every word, with where the first word was found and the words around it. */
export interface SearchHit {
  session: Entity
  label: string
  snippet: string
}

/** How much of a long text shows on each side of a match. */
const AROUND = 30

/** Text compared without regard to case or to how its letters were composed. */
function fold(text: string): string {
  return text.normalize('NFC').toLocaleLowerCase()
}

/** The words of a query, folded; none when it holds only spaces. */
export function searchWords(query: string): string[] {
  return fold(query).split(/\s+/).filter((w) => w !== '')
}

/** The part of `text` around `at` (where a match of `length` starts), marked where it was cut. */
function around(text: string, at: number, length: number): string {
  const from = Math.max(0, at - AROUND)
  const to = Math.min(text.length, at + length + AROUND)
  return `${from > 0 ? '…' : ''}${text.slice(from, to).trim()}${to < text.length ? '…' : ''}`
}

/**
 * The sessions holding every word of `query`, in the order given, each with where its first word
 * was found. `describe` says what a session says; a query of no words finds nothing.
 */
export function searchSessions(sessions: readonly Entity[], query: string, describe: (s: Entity) => SessionText[]): SearchHit[] {
  const words = searchWords(query)
  if (words.length === 0) return []
  const hits: SearchHit[] = []
  for (const session of sessions) {
    const texts = describe(session).filter((t) => t.text.trim() !== '')
    const folded = texts.map((t) => fold(t.text))
    if (!words.every((w) => folded.some((t) => t.includes(w)))) continue
    const i = folded.findIndex((t) => t.includes(words[0]))
    // Folding keeps a text's length for the letters people type, so the place found is the place shown.
    const text = texts[i].text.normalize('NFC')
    hits.push({ session, label: texts[i].label, snippet: around(text, folded[i].indexOf(words[0]), words[0].length) })
  }
  return hits
}
