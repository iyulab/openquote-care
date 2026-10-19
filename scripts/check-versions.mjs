// Checks that every file naming the app's version names the same one. The release workflow reads
// the version from tauri.conf.json alone, so a file left behind would ship under another number.
// Also that the tauri-kit crates the shell builds with and the TauriKit packages the sidecar restores
// are one release: tauri-kit publishes both at one version, and its two ends talk to each other.
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

const kit = {}
for (const [, name, version] of read('Cargo.lock').matchAll(/name = "(tauri-kit-[^"]+)"\r?\nversion = "([^"]+)"/g)) kit[`${name} (Cargo.lock)`] = version
for (const [, name, version] of read('Directory.Packages.props').matchAll(/<PackageVersion Include="(TauriKit\.[^"]+)" Version="([^"]+)"/g)) kit[`${name} (Directory.Packages.props)`] = version
const kitVersions = new Set(Object.values(kit))
if (kitVersions.size > 1) {
  console.error('the tauri-kit crates and TauriKit packages are not one release:')
  for (const [what, version] of Object.entries(kit)) console.error(`  ${what}: ${version}`)
  process.exit(1)
}
if (kitVersions.size === 1) console.log(`tauri-kit ${[...kitVersions][0]} in all ${Object.keys(kit).length} crates and packages`)
