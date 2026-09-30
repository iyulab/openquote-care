// Checks an installer the way a person would get the app, on this computer: install for the
// current user (no administrator), start the installed app, run the shell's command-layer tests
// against the engine sidecar the installer bundled, then uninstall.
//
//   npm run bundle             builds target/release/bundle/nsis/*-setup.exe
//   npm run test:installed     runs this check against it
//
// The installed window cannot be driven over a debugging port: the app passes WebView2 its own
// browser arguments, which take the place of WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS. The screens
// are covered by run.mjs against the debug build; what only an installed copy can show is that
// it starts and that the engine it carries works.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const bundleDir = join(here, '..', 'target', 'release', 'bundle', 'nsis')
const root = join(here, '..')

/** The installer for this version — installers of earlier versions may still sit beside it. */
function installer() {
  const { version } = JSON.parse(readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'))
  const found = existsSync(bundleDir) ? readdirSync(bundleDir).filter((f) => f.endsWith(`_${version}_x64-setup.exe`)) : []
  if (found.length !== 1) throw new Error(`expected the ${version} installer in ${bundleDir} — run \`npm run bundle\` first`)
  return join(bundleDir, found[0])
}

function run(exe, args) {
  const result = spawnSync(exe, args, { stdio: 'ignore', windowsVerbatimArguments: true })
  if (result.status !== 0) throw new Error(`${exe} ${args.join(' ')} exited with ${result.status}`)
}

async function main() {
  const temp = await mkdtemp(join(tmpdir(), 'openquote-care-installed-'))
  const target = join(temp, 'app')
  let child
  try {
    // NSIS: /S is silent, /D= must come last and unquoted.
    run(installer(), ['/S', `/D=${target}`])
    const files = await readdir(target)
    const exe = files.find((f) => f.toLowerCase() === 'openquote-care.exe')
    assert.ok(exe, `the app is installed (${files.join(', ')})`)
    assert.ok(existsSync(join(target, 'sidecar', 'openquote-care-sidecar.exe')), 'the engine sidecar is bundled')
    assert.ok(existsSync(join(target, 'packs', 'tracks.json')), 'the tracks are bundled')
    assert.ok(existsSync(join(target, 'packs', 'care.school.kr', 'schemes', 'topic', 'v1.json')), 'the data packs are bundled')
    console.log('  ✓ installed for the current user')

    const env = { ...process.env }
    delete env.OPENQUOTE_SIDECAR_EXE // the installed app must find its own
    child = spawn(join(target, exe), [], { stdio: 'ignore', env })
    await new Promise((r) => setTimeout(r, 8000))
    assert.equal(child.exitCode, null, 'the installed app is still running after starting')
    console.log('  ✓ the installed app starts and stays up')

    const sidecar = join(target, 'sidecar', 'openquote-care-sidecar.exe')
    const tests = spawnSync('cargo', ['test', '--release', '-p', 'openquote-care', '--lib'], {
      cwd: root,
      env: { ...process.env, OPENQUOTE_SIDECAR_EXE: sidecar },
      encoding: 'utf8',
    })
    const summary = (tests.stdout.match(/test result: .*/g) ?? []).join(' / ')
    assert.equal(tests.status, 0, `the shell's tests pass against the bundled engine: ${summary}
${tests.stdout.slice(-2000)}`)
    assert.ok(!/skipped: no engine sidecar/.test(tests.stderr), 'no test skipped for want of the engine')
    console.log(`  ✓ the shell's commands work with the bundled engine (${summary})`)
  } finally {
    if (child) {
      child.kill()
      await new Promise((done) => (child.exitCode !== null ? done() : child.once('exit', done)))
    }
    const uninstaller = join(target, 'uninstall.exe')
    if (existsSync(uninstaller)) {
      run(uninstaller, ['/S'])
      // The uninstaller copies itself away and finishes in the background.
      for (let i = 0; i < 40 && existsSync(join(target, 'openquote-care.exe')); i++) await new Promise((r) => setTimeout(r, 250))
      assert.ok(!existsSync(join(target, 'openquote-care.exe')), 'uninstalled')
      console.log('  ✓ uninstalled')
    }
    await rm(temp, { recursive: true, force: true })
  }
}

await main()
