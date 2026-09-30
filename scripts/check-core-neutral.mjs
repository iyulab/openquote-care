// Checks that the core — the app's own code, not its data packs, word tables or tests — names no
// field of practice or region: no Korean text, no school or Korea terms, no fixed locale. What a
// vault is about comes from its packs; code that knows it would leak one track into every other.
//
//   node scripts/check-core-neutral.mjs        (exits 1 and lists the lines when any is found)
//
// An exception goes in scripts/core-neutral.allow.json as { "file", "pattern", "reason" }: the line
// in that file matching the pattern is let through, and the reason says why.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** What the core must not say, each with what it is. */
export const RULES = [
  { name: 'Korean text', pattern: /[가-힣]/ },
  { name: 'field or region term', pattern: /\b(school|grade|guardian|neis|korea|kr|ko|ko-KR|care\.school|care-kr)\b/i },
  // A locale written into a comparison or a formatter: its second argument, or its first, is a language tag.
  { name: 'fixed collation locale', pattern: /localeCompare\((?:[^()]|\([^()]*\))*,\s*['"][a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?['"]/ },
  { name: 'fixed locale', pattern: /Intl\.\w+\(\s*\[?\s*['"][a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?['"]/ },
  { name: 'fixed time zone', pattern: /Asia\/Seoul|\+09:00/ },
]

/** The core: code under these folders with these extensions, less word tables, tests and build output. */
const ROOTS = [
  ['src', '.ts'],
  ['src-tauri/src', '.rs'],
  ['sidecar', '.cs'],
  ['crates', '.rs'],
]
const SKIP = [/(^|\/)(locales|__tests__|tests|bin|obj|node_modules|target)(\/|$)/]

// A Rust file's code before its test module: tests may name anything they need.
const withoutTests = (path, text) => (path.endsWith('.rs') ? text.split(/^\s*#\[cfg\(test\)\]/m)[0] : text)

/** The core files under `root`, as paths relative to it with forward slashes. */
export function coreFiles(root) {
  const found = []
  const walk = (dir, ext) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      const rel = relative(root, path).split(sep).join('/')
      if (SKIP.some((s) => s.test(rel))) continue
      if (statSync(path).isDirectory()) walk(path, ext)
      else if (rel.endsWith(ext)) found.push(rel)
    }
  }
  for (const [dir, ext] of ROOTS) {
    try {
      walk(join(root, dir), ext)
    } catch {
      // a root the checkout lacks holds nothing to check
    }
  }
  return found.sort()
}

/**
 * The lines of `files` ({ path, text }) that break a rule and no allowed exception covers. An
 * exception without a reason is itself reported, so none is let through silently.
 */
export function audit(files, allow = []) {
  const findings = []
  for (const a of allow) {
    if (!a.reason?.trim()) findings.push({ path: 'scripts/core-neutral.allow.json', line: 0, rule: 'exception without a reason', text: JSON.stringify(a) })
  }
  const allowed = allow.filter((a) => a.reason?.trim())
  for (const { path, text } of files) {
    withoutTests(path, text)
      .split(/\r?\n/)
      .forEach((line, i) => {
        for (const rule of RULES) {
          if (!rule.pattern.test(line)) continue
          if (allowed.some((a) => a.file === path && new RegExp(a.pattern).test(line))) continue
          findings.push({ path, line: i + 1, rule: rule.name, text: line.trim() })
        }
      })
  }
  return findings
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
  const allow = JSON.parse(readFileSync(join(root, 'scripts', 'core-neutral.allow.json'), 'utf8'))
  const files = coreFiles(root).map((path) => ({ path, text: readFileSync(join(root, path), 'utf8') }))
  const findings = audit(files, allow)
  for (const f of findings) console.error(`${f.path}:${f.line}: ${f.rule}: ${f.text}`)
  if (findings.length > 0) {
    console.error(`\n${findings.length} line(s) in the core name a field or region; move them to a data pack or a word table`)
    process.exit(1)
  }
  console.log(`core neutral — ${files.length} files`)
}
