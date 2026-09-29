// Runs every local check in order and stops at the first that fails.
//
//   npm run verify                        screens, sidecar, shell and vault tests, clippy
//   npm run verify -- --e2e               and the real app window over CDP
//   npm run verify -- --installed         and the installer: bundle, install, run, uninstall
//
// The sidecar is built first so the shell's tests that need it run instead of being skipped.
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const args = new Set(process.argv.slice(2))
const unknown = [...args].filter((a) => a !== '--e2e' && a !== '--installed')
if (unknown.length) {
  console.error(`unknown option: ${unknown.join(' ')} (expected --e2e, --installed)`)
  process.exit(2)
}

const sidecar = join('sidecar', 'OpenquoteCare.Sidecar', 'bin', 'Release', 'net10.0', process.platform === 'win32' ? 'openquote-care-sidecar.exe' : 'openquote-care-sidecar')
const env = { ...process.env, OPENQUOTE_SIDECAR_EXE: process.env.OPENQUOTE_SIDECAR_EXE ?? join(process.cwd(), sidecar) }

const steps = [
  ['typecheck', 'npm run typecheck'],
  ['screens', 'npm test'],
  ['sidecar build', 'npm run build:sidecar'],
  ['sidecar and golden-vault tests', 'dotnet test --solution OpenquoteCare.slnx'],
  ['screens build (the shell embeds dist/)', 'npm run build'],
  ['shell and vault tests', 'cargo test --release --workspace'],
  ['clippy', 'cargo clippy --workspace --all-targets -- -D warnings'],
]
if (args.has('--e2e')) steps.push(['window build', 'npm run build:e2e'], ['window scenarios', 'npm run test:e2e'])
if (args.has('--installed')) steps.push(['installer', 'npm run bundle'], ['installed app', 'npm run test:installed'])

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
