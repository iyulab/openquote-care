// What the engine hands the window, and the small rules the record screens apply to it.

/** A classification value as the format keeps it: the scheme version it was recorded in. */
export interface Classified {
  scheme: string
  version: number
  code: string
}

/** A merged entity as the engine lists it. */
export interface Entity {
  type: string
  id: string
  /** The subject whose folder holds it; null for a practitioner or anything a group holds. */
  subject: string | null
  /** The group whose folder holds it (a group session, say); null otherwise. */
  group: string | null
  /** The subjects it is about: its subject, or a group session's attendees. */
  people: string[]
  fields: Record<string, unknown>
  /** Fields two devices changed without seeing each other: every value is kept. */
  conflicts: Record<string, FieldHead[]>
}

/** One device's value for a field that was changed concurrently. */
export interface FieldHead {
  changeId: string
  device: string
  value: unknown
}

export interface SchemeItem {
  code: string
  label: string
  parent: string | null
  suggest: boolean
}

export interface Scheme {
  scheme: string
  version: number
  items: SchemeItem[]
}

export interface Choice {
  value: string
  label: string
  disabled?: boolean
}

/** The newest version of `name`, which is what a new record is classified in. */
export function latest(schemes: Scheme[], name: string): Scheme | undefined {
  return schemes.filter((s) => s.scheme === name).reduce<Scheme | undefined>((a, s) => (!a || s.version > a.version ? s : a), undefined)
}

/**
 * The choices a scheme offers. An item with children is a heading, not a choice: a record is
 * classified to a leaf, so a child is labelled with its parent ("특별 › 학교폭력").
 */
export function choices(scheme: Scheme): Choice[] {
  const byCode = new Map(scheme.items.map((i) => [i.code, i]))
  const parents = new Set(scheme.items.map((i) => i.parent).filter((p): p is string => !!p))
  return scheme.items.map((i) => {
    const parent = i.parent ? byCode.get(i.parent) : undefined
    return {
      value: i.code,
      label: parent ? `${parent.label} › ${i.label}` : i.label,
      ...(parents.has(i.code) ? { disabled: true } : {}),
    }
  })
}

/** The label of a recorded value in the version it was recorded in, or its code if unknown. */
export function labelOf(schemes: Scheme[], value: unknown): string {
  if (!isClassified(value)) return ''
  const scheme = schemes.find((s) => s.scheme === value.scheme && s.version === value.version)
  const choice = scheme && choices(scheme).find((c) => c.value === value.code)
  return choice?.label ?? value.code
}

export function isClassified(value: unknown): value is Classified {
  const v = value as Classified | null
  return typeof v === 'object' && v !== null && typeof v.scheme === 'string' && typeof v.version === 'number' && typeof v.code === 'string'
}

/** Where a value lands in a later version: one code, codes a person chooses from, or none. */
export interface Resolution {
  kind: 'assigned' | 'pending' | 'unmapped'
  code: string | null
  candidates: string[]
}

/** The field of `entity` classified in `scheme`, if any: the one a report's rows count by. */
export function classifiedField(entity: Entity, scheme: string): [string, Classified] | undefined {
  for (const [field, value] of Object.entries(entity.fields)) {
    if (isClassified(value) && value.scheme === scheme) return [field, value]
  }
  return undefined
}

/** The fields of `entity` changed concurrently, each with the distinct values to choose from. */
export function conflictsOf(entity: Entity): { field: string; heads: FieldHead[] }[] {
  return Object.entries(entity.conflicts ?? {})
    .filter(([, heads]) => heads.length > 1)
    .map(([field, heads]) => ({ field, heads: [...heads].sort((a, b) => a.device.localeCompare(b.device)) }))
}

/** A text field's value, or empty. */
export function text(entity: Entity, field: string): string {
  const v = entity.fields[field]
  return typeof v === 'string' ? v : ''
}

/** Sessions newest first by the date the counsellor wrote; ties by id, so the order is stable. */
export function newestFirst(sessions: Entity[]): Entity[] {
  return [...sessions].sort((a, b) => text(b, 'date').localeCompare(text(a, 'date')) || b.id.localeCompare(a.id))
}

/** What a definition file added from a data pack is, in the pack's own terms. */
export type Definition =
  | { kind: 'scheme'; name: string; version: number }
  | { kind: 'crosswalk'; name: string; from: number; to: number }
  | { kind: 'report'; name: string; version: number }

/** Reads a definition file's vault path (`schemes/topic/v2.json`, `schemes/topic/v1-v2.json`, `reports/x/v2.json`). */
export function definitionOf(path: string): Definition | undefined {
  const scheme = /^schemes\/([^/]+)\/v(\d+)\.json$/.exec(path)
  if (scheme) return { kind: 'scheme', name: scheme[1], version: Number(scheme[2]) }
  const crosswalk = /^schemes\/([^/]+)\/v(\d+)-v(\d+)\.json$/.exec(path)
  if (crosswalk) return { kind: 'crosswalk', name: crosswalk[1], from: Number(crosswalk[2]), to: Number(crosswalk[3]) }
  const report = /^reports\/([^/]+)\/v(\d+)\.json$/.exec(path)
  if (report) return { kind: 'report', name: report[1], version: Number(report[2]) }
  return undefined
}

/** Today as a calendar date (`YYYY-MM-DD`) on this computer's clock. */
export function today(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** Who a session is about, by name: its subject, or a group session's attendees. */
export function namesOf(session: Entity, names: Map<string, string>): string {
  return session.people.map((id) => names.get(id) ?? '').filter((n) => n !== '').join(', ')
}
