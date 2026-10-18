// Checks that the app's diagnostics registry names every coded field the bundled packs declare.
//
//   node scripts/check-diagnostics-registry.mjs
//
// The suggestion-use events (src-tauri/diagnostics-registry.json) name a field as `<kind of record>.<field>`
// from a closed list, because a name the registry does not declare is counted as `other`. A pack that gains a
// coded field would otherwise be counted under `other` without anyone noticing. Coded fields the registry
// names that no pack declares any more are reported as well.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const registry = JSON.parse(readFileSync(join('src-tauri', 'diagnostics-registry.json'), 'utf8'))
const declared = new Set(registry.events['suggestion.use'].fields.field.values)
declared.delete('other')

const wanted = new Set()
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path)
    else if (entry.name.endsWith('.json') && path.split(/[\\/]/).includes('fields')) {
      const definition = JSON.parse(readFileSync(path, 'utf8'))
      if (!String(definition.format).startsWith('openquote.fields/')) continue
      for (const field of definition.fields ?? []) if (field.kind === 'coded') wanted.add(`${definition.type}.${field.name}`)
    }
  }
}
walk('packs')

const missing = [...wanted].filter((name) => !declared.has(name)).sort()
const stale = [...declared].filter((name) => !wanted.has(name)).sort()
for (const [what, names] of [
  ['coded fields no registry value names (they would be counted as other)', missing],
  ['registry values no pack declares a coded field for', stale],
]) {
  if (names.length > 0) console.error(`${what}: ${names.join(', ')}`)
}
if (missing.length > 0 || stale.length > 0) process.exit(1)
console.log(`the registry names the ${wanted.size} coded fields of the bundled packs`)
