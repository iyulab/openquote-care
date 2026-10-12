// A case number for a person added without one: the day they were added and a short tail, as a counsellor can read it
// out and write it on paper — 2026-1013-7K3Q. Devices sharing a records folder write without asking one another, so
// the number is not a running count (two devices would hand out the same one) but a day and four random characters,
// drawn again while the vault already holds the number.

/** Crockford's base 32: digits and letters with no I, L, O or U, so a number read aloud is not misheard. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function randomTail(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4))
  return [...bytes].map((b) => ALPHABET[b & 31]).join('')
}

/** A case number for `day` (`YYYY-MM-DD`) that `taken` does not hold. */
export function newCaseNumber(day: string, taken: ReadonlySet<string>, tail: () => string = randomTail): string {
  const [y, m, d] = day.split('-')
  for (;;) {
    const number = `${y}-${m}${d}-${tail()}`
    if (!taken.has(number)) return number
  }
}
