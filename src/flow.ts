// The rules of making a vault, apart from the screens that show them.

/** The shortest passphrase a new vault accepts. */
export const MIN_PASSPHRASE = 8

/** How many trailing characters of the vault key a person types back; matches the shell. */
export const KIT_TAIL = 6

export type CreateProblem = 'no-folder' | 'passphrase-short' | 'passphrase-mismatch'

/** Why the create form cannot be sent yet, or undefined when it can. */
export function createProblem(folder: string | undefined, passphrase: string, again: string): CreateProblem | undefined {
  if (!folder) return 'no-folder'
  if ([...passphrase].length < MIN_PASSPHRASE) return 'passphrase-short'
  if (passphrase !== again) return 'passphrase-mismatch'
  return undefined
}

/**
 * The vault key split into groups for copying by hand: the prefix whole, then groups of
 * {@link KIT_TAIL} counted from the end, so the last group is exactly what is typed back.
 */
export function groupKey(key: string): string[] {
  const prefix = 'AGE-SECRET-KEY-1'
  const body = key.startsWith(prefix) ? key.slice(prefix.length) : key
  const groups: string[] = []
  for (let end = body.length; end > 0; end -= KIT_TAIL) groups.unshift(body.slice(Math.max(0, end - KIT_TAIL), end))
  return key.startsWith(prefix) ? [prefix, ...groups] : groups
}
