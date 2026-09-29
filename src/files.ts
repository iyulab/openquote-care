// What a vault file is, in the words of the records it holds — for a file the person has to act on.

/** What a vault path holds, from the folder layout alone. */
export type FileKind =
  | { kind: 'subject'; name?: string }
  | { kind: 'group'; name?: string }
  | { kind: 'practitioners' }
  | { kind: 'devices' }
  | { kind: 'scheme'; scheme: string; version: number }
  | { kind: 'crosswalk'; scheme: string; from: number; to: number }
  | { kind: 'report'; report: string; version: number }
  | { kind: 'export'; form: string; version: number }
  | { kind: 'run'; year: number }
  | { kind: 'other' }

/**
 * Reads a vault path (plaintext or encrypted, `/`-separated) as what it holds. A subject's or
 * group's name comes from `names`; it is missing when the unreadable file is the one that named it.
 */
export function fileKind(path: string, names: { subjects: Map<string, string>; groups: Map<string, string> }): FileKind {
  const parts = path.replace(/\.age$/, '').split('/')
  const [top, second, file] = parts
  const named = (map: Map<string, string>) => (second && map.get(second)) || undefined
  // Loose on what follows the version: a sync client's conflict copy keeps the name's start.
  const version = (/^v(\d+)(?![\d-])/.exec(file ?? '') ?? [])[1]
  if (top === 'subjects' && parts.length === 3) return { kind: 'subject', name: named(names.subjects) }
  if (top === 'groups' && parts.length === 3) return { kind: 'group', name: named(names.groups) }
  if (top === 'practitioners' && parts.length === 2) return { kind: 'practitioners' }
  if (top === 'devices' && parts.length === 2) return { kind: 'devices' }
  if (top === 'schemes' && second && parts.length === 3) {
    const crosswalk = /^v(\d+)-v(\d+)(?!\d)/.exec(file)
    if (crosswalk) return { kind: 'crosswalk', scheme: second, from: Number(crosswalk[1]), to: Number(crosswalk[2]) }
    if (version) return { kind: 'scheme', scheme: second, version: Number(version) }
  }
  if (top === 'reports' && second && version && parts.length === 3) return { kind: 'report', report: second, version: Number(version) }
  if (top === 'exports' && second && version && parts.length === 3) return { kind: 'export', form: second, version: Number(version) }
  if (top === 'runs' && /^\d{4}$/.test(second ?? '') && parts.length === 3) return { kind: 'run', year: Number(second) }
  return { kind: 'other' }
}
