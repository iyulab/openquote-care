// Runs every local check in order and stops at the first that fails.
//
//   npm run verify                        screens, sidecar, shell and vault tests, clippy
//   npm run verify -- --e2e               and the real app window over CDP
//   npm run verify -- --installed         and the installer: bundle, install, run, uninstall, the
//                                         update over the latest published version, and the app
//                                         updating itself (a test build and key made for the run)
//
// The sidecar is built first: the shell's tests that need it fail without one. Before anything,
// the machine is checked for what the build needs (see `checkMachine` below).
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { checkMachine } from '@iyulab/tauri-kit-dev/machine'

const args = new Set(process.argv.slice(2))
const unknown = [...args].filter((a) => a !== '--e2e' && a !== '--installed')
if (unknown.length) {
  console.error(`unknown option: ${unknown.join(' ')} (expected --e2e, --installed)`)
  process.exit(2)
}

const sidecar = join('sidecar', 'OpenquoteCare.Sidecar', 'bin', 'Release', 'net10.0', process.platform === 'win32' ? 'openquote-care-sidecar.exe' : 'openquote-care-sidecar')
const env = { ...process.env, OPENQUOTE_SIDECAR_EXE: process.env.OPENQUOTE_SIDECAR_EXE ?? join(process.cwd(), sidecar) }

// What the machine needs and does not always have — Rust on the MSVC toolchain, a dotnet for the
// sidecar and, for a per-user .NET install, DOTNET_ROOT pointing at it — checked (and where possible
// set) up front, so a run does not fail twenty minutes in with a message that points elsewhere.
const machine = checkMachine({ dotnet: true, env })
for (const [name, value] of Object.entries(machine.set)) {
  env[name] = value
  console.log(`${name} not set; using ${value}`)
}
if (machine.problems.length) {
  for (const p of machine.problems) console.error(`✗ ${p}`)
  process.exit(2)
}

const steps = [
  ['versions agree', 'node scripts/check-versions.mjs'],
  ['core names no field or region', 'npm run check:core'],
  ['design tokens read are defined', 'npm run check:tokens'],
  ['typecheck', 'npm run typecheck'],
  ['screens', 'npm test'],
  ['sidecar build', 'npm run build:sidecar'],
  ['golden vaults as their generators write them', 'node scripts/check-golden.mjs'],
  ['sidecar and golden-vault tests', 'dotnet test --solution OpenquoteCare.slnx'],
  ['screens build (the shell embeds dist/)', 'npm run build'],
  ['shell and vault tests', 'cargo test --release --workspace'],
  ['clippy', 'cargo clippy --workspace --all-targets -- -D warnings'],
]
if (args.has('--e2e')) steps.push(['window build', 'npm run build:e2e'], ['window scenarios', 'npm run test:e2e'])
if (args.has('--installed')) steps.push(['installer', 'npm run bundle'], ['installed app', 'npm run test:installed'], ['update over the published version', 'npm run test:upgrade'], ['the installed app updates itself', 'npm run test:update'])

for (const [name, command] of steps) {
  console.log(`\n▶ ${name}: ${command}`)
  const started = Date.now()
  const result = spawnSync(command, { stdio: 'inherit', shell: true, env })
  if (result.status !== 0) {
    console.error(`\n✗ ${name} failed${result.error ? `: ${result.error.message}` : ''}`)
    process.exit(result.status || 1)
  }
  console.log(`✓ ${name} (${Math.round((Date.now() - started) / 1000)}s)`)
}
console.log(`\nall ${steps.length} checks passed`)
