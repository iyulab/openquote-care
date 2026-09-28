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
  /** The subject whose folder holds it; null for a practitioner. */
  subject: string | null
  fields: Record<string, unknown>
  conflicts: Record<string, unknown[]>
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

/** A text field's value, or empty. */
export function text(entity: Entity, field: string): string {
  const v = entity.fields[field]
  return typeof v === 'string' ? v : ''
}

/** Sessions newest first by the date the counsellor wrote; ties by id, so the order is stable. */
export function newestFirst(sessions: Entity[]): Entity[] {
  return [...sessions].sort((a, b) => text(b, 'date').localeCompare(text(a, 'date')) || b.id.localeCompare(a.id))
}

/** Today as a calendar date (`YYYY-MM-DD`) on this computer's clock. */
export function today(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
