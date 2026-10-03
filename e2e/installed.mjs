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

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { findInstaller, startsAndStays, withInstalled } from '@iyulab/tauri-kit-dev/installer'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const { version } = JSON.parse(readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'))
const exe = 'openquote-care.exe'

/** The environment the installed app starts in: without the variable that would point it away from its own engine. */
function ownEngineEnv() {
  const env = { ...process.env }
  delete env.OPENQUOTE_SIDECAR_EXE
  return env
}

const installer = findInstaller(join(root, 'target', 'release', 'bundle', 'nsis'), { version, hint: 'run `npm run bundle` first' })
await withInstalled(
  installer,
  async (target) => {
    assert.ok(existsSync(join(target, 'sidecar', 'openquote-care-sidecar.exe')), 'the engine sidecar is bundled')
    assert.ok(existsSync(join(target, 'packs', 'tracks.json')), 'the tracks are bundled')
    const notices = join(target, 'licenses', 'THIRD-PARTY-NOTICES.txt')
    assert.equal(existsSync(notices) && readFileSync(notices, 'utf8'), readFileSync(join(root, 'LICENSES', 'THIRD-PARTY-NOTICES.txt'), 'utf8'), 'the third-party notices are bundled')
    // Every pack the tracks start from, and every pack they build on, with each file it lists.
    for (const pack of readdirSync(join(root, 'packs'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)) {
      for (const name of readdirSync(join(root, 'packs', pack, 'packs', pack))) {
        const { provides } = JSON.parse(readFileSync(join(target, 'packs', pack, 'packs', pack, name), 'utf8'))
        for (const path of provides) assert.ok(existsSync(join(target, 'packs', pack, path)), `pack ${pack} brings ${path}`)
      }
    }
    console.log('  ✓ installed for the current user')

    assert.ok(await startsAndStays(join(target, exe), { env: ownEngineEnv() }), 'the installed app is still running after starting')
    console.log('  ✓ the installed app starts and stays up')

    const tests = spawnSync('cargo', ['test', '--release', '-p', 'openquote-care', '--lib'], {
      cwd: root,
      env: { ...process.env, OPENQUOTE_SIDECAR_EXE: join(target, 'sidecar', 'openquote-care-sidecar.exe') },
      encoding: 'utf8',
    })
    const summary = (tests.stdout.match(/test result: .*/g) ?? []).join(' / ')
    assert.equal(tests.status, 0, `the shell's tests pass against the bundled engine: ${summary}
${tests.stdout.slice(-2000)}`)
    assert.ok(!/skipped: no engine sidecar/.test(tests.stderr), 'no test skipped for want of the engine')
    console.log(`  ✓ the shell's commands work with the bundled engine (${summary})`)
  },
  { exe, prefix: 'openquote-care-installed-' },
)
console.log('  ✓ uninstalled')
