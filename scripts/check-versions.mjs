// Checks that every file naming the app's version names the same one. The release workflow reads
// the version from tauri.conf.json alone, so a file left behind would ship under another number.
//
//   node scripts/check-versions.mjs
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(path, 'utf8')
const lock = JSON.parse(read('package-lock.json'))

const found = {
  'package.json': JSON.parse(read('package.json')).version,
  'package-lock.json': lock.version,
  'package-lock.json (root package)': lock.packages?.['']?.version,
  'src-tauri/tauri.conf.json': JSON.parse(read('src-tauri/tauri.conf.json')).version,
  'src-tauri/Cargo.toml': /^version\s*=\s*"([^"]+)"/m.exec(read('src-tauri/Cargo.toml'))?.[1],
  'Cargo.lock (openquote-care)': /name = "openquote-care"\r?\nversion = "([^"]+)"/.exec(read('Cargo.lock'))?.[1],
}

const versions = new Set(Object.values(found))
if (versions.size !== 1 || versions.has(undefined)) {
  console.error('the app version differs between files:')
  for (const [file, version] of Object.entries(found)) console.error(`  ${file}: ${version ?? '(not found)'}`)
  process.exit(1)
}
console.log(`version ${[...versions][0]} in all ${Object.keys(found).length} places`)
