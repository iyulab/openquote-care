// Correcting a saved record: the form starts from what the record holds now, and only what a
// person changed is written — as a new change, so the record as first written stays.
import type { FieldView } from './fields.js'
import type { Entity } from './records.js'
import { alsoKey, isCoded, primaryAndOthers } from './several.js'

/**
 * What a form's inputs show for `entity`: each field's current value as the input holds it (a code
 * for a classification; for one holding several, the primary code, the others under their own key).
 */
export function asDraft(fields: FieldView[], entity: Entity): Record<string, string> {
  const draft: Record<string, string> = {}
  for (const f of fields) {
    const value = entity.fields[f.name]
    if (value === undefined || value === null) draft[f.name] = ''
    else if (Array.isArray(value) || isCoded(value)) {
      const { primary, others } = primaryAndOthers(value)
      draft[f.name] = primary?.code ?? ''
      if (others.length > 0) draft[alsoKey(f.name)] = others.map((o) => o.code).join('\n')
    } else draft[f.name] = typeof value === 'string' ? value : String(value)
  }
  return draft
}

function same(a: unknown, b: unknown): boolean {
  if (isCoded(a) && isCoded(b)) return a.scheme === b.scheme && a.version === b.version && a.code === b.code && !!a.primary === !!b.primary
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => same(x, b[i]))
  return a === b
}

/**
 * The fields of `filled` (what the inputs hold, as recorded; an emptied input absent) that differ
 * from what `entity` holds, and `null` for a field the person emptied — the change that turns the
 * record into what the form shows. Fields the form does not show are left out.
 */
export function changedFields(fields: FieldView[], entity: Entity, filled: Record<string, unknown>): Record<string, unknown> {
  const changed: Record<string, unknown> = {}
  for (const f of fields) {
    const was = entity.fields[f.name]
    const now = filled[f.name]
    const had = was !== undefined && was !== null && was !== ''
    if (now === undefined) {
      if (had) changed[f.name] = null
    } else if (!had || !same(was, now)) {
      changed[f.name] = now
    }
  }
  return changed
}
