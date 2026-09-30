// Runs every local check in order and stops at the first that fails.
//
//   npm run verify                        screens, sidecar, shell and vault tests, clippy
//   npm run verify -- --e2e               and the real app window over CDP
//   npm run verify -- --installed         and the installer: bundle, install, run, uninstall, and
//                                         the update over the latest published version
//
// The sidecar is built first: the shell's tests that need it fail without one. Before anything,
// the machine is checked for what the build needs (see `environment` below).
import { execFileSync, spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { realpathSync } from 'node:fs'

const args = new Set(process.argv.slice(2))
const unknown = [...args].filter((a) => a !== '--e2e' && a !== '--installed')
if (unknown.length) {
  console.error(`unknown option: ${unknown.join(' ')} (expected --e2e, --installed)`)
  process.exit(2)
}

const sidecar = join('sidecar', 'OpenquoteCare.Sidecar', 'bin', 'Release', 'net10.0', process.platform === 'win32' ? 'openquote-care-sidecar.exe' : 'openquote-care-sidecar')
const env = { ...process.env, OPENQUOTE_SIDECAR_EXE: process.env.OPENQUOTE_SIDECAR_EXE ?? join(process.cwd(), sidecar) }

// What a Windows machine needs and does not always have, checked (and where possible set) up front
// so a run does not fail twenty minutes in with a message that points elsewhere.
function environment() {
  const problems = []
  const run = (command, args) => {
    try {
      return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    } catch {
      return undefined
    }
  }
  if (process.platform === 'win32') {
    // The shell links as a cdylib, which the GNU linker fails at without saying why.
    const toolchain = run('rustup', ['show', 'active-toolchain'])
    if (toolchain && !toolchain.includes('msvc')) {
      problems.push(`Rust uses ${toolchain.split(' ')[0]}; Tauri needs MSVC: rustup override set stable-x86_64-pc-windows-msvc`)
    }
    // The sidecar is an apphost: it finds the .NET runtime through DOTNET_ROOT or a machine-wide
    // install. For a per-user install, point it at the dotnet this shell runs.
    if (!env.DOTNET_ROOT) {
      const where = run('where', ['dotnet'])?.split(/\r?\n/)[0]
      if (where) {
        const root = dirname(realpathSync(where))
        if (!/program files/i.test(root)) {
          env.DOTNET_ROOT = root
          console.log(`DOTNET_ROOT not set; using ${root} (the dotnet on PATH)`)
        }
      }
    }
  }
  if (!run('dotnet', ['--version'])) problems.push('no dotnet on PATH (install the SDK global.json names)')
  if (problems.length) {
    for (const p of problems) console.error(`✗ ${p}`)
    process.exit(2)
  }
}
environment()

const steps = [
  ['versions agree', 'node scripts/check-versions.mjs'],
  ['core names no field or region', 'npm run check:core'],
  ['typecheck', 'npm run typecheck'],
  ['screens', 'npm test'],
  ['sidecar build', 'npm run build:sidecar'],
  ['sidecar and golden-vault tests', 'dotnet test --solution OpenquoteCare.slnx'],
  ['screens build (the shell embeds dist/)', 'npm run build'],
  ['shell and vault tests', 'cargo test --release --workspace'],
  ['clippy', 'cargo clippy --workspace --all-targets -- -D warnings'],
]
if (args.has('--e2e')) steps.push(['window build', 'npm run build:e2e'], ['window scenarios', 'npm run test:e2e'])
if (args.has('--installed')) steps.push(['installer', 'npm run bundle'], ['installed app', 'npm run test:installed'], ['update over the published version', 'npm run test:upgrade'])

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
