import { strings } from './strings.js'

/** A failed shell command, as the shell sends it. */
export interface CommandError {
  code: string
  message: string
}

export function isCommandError(e: unknown): e is CommandError {
  return typeof e === 'object' && e !== null && typeof (e as CommandError).code === 'string'
}

/** The sentence to show a person for a failure, and the shell's own words for the detail line. */
export function describeError(e: unknown): { text: string; detail?: string } {
  if (isCommandError(e)) {
    const known = (strings.errors as Record<string, string>)[e.code]
    return known ? { text: known } : { text: strings.errors.unknown, detail: e.message }
  }
  return { text: strings.errors.unknown, detail: e instanceof Error ? e.message : String(e) }
}
