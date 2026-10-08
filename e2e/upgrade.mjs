// Checks that this version installs over the latest published one the way a person updates the
// app: download the published installer, install it for the current user, start it once, then
// run this version's installer into the same folder without uninstalling. The update must keep
// the app's own data (its device identity), start, and drop the web view profile copies an
// earlier version could have left form entries in. The copies send nothing, and the app data
// folder is set aside for the check and put back after it.
//
//   npm run bundle          builds target/release/bundle/nsis/*-setup.exe
//   npm run test:upgrade    runs this check (needs `gh` signed in to read the releases)
//
// UPGRADE_FROM=<tag> picks the published version to update from; the default is the latest one
// that is not this version.

import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import {
  downloadInstaller,
  fileVersion,
  findInstaller,
  gh,
  nsisArgs,
  pickUpgradeFrom,
  profileSnapshots,
  publishedReleases,
  run,
  seedProfileSnapshot,
  startsAndStays,
  uninstall,
  withAppDataSetAside,
} from '@iyulab/tauri-kit-dev/installer'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const config = JSON.parse(readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'))
const appData = join(process.env.LOCALAPPDATA, config.identifier)
const exeName = 'openquote-care.exe'

/**
 * The environment the installed app starts in: without the variable that would point it away from
 * its own engine, and sending nothing — a published copy carries the collector's connection.
 */
function checkEnv() {
  const env = { ...process.env, OPENQUOTE_DIAGNOSTICS_CONNECTION: 'off' }
  delete env.OPENQUOTE_SIDECAR_EXE
  return env
}

const next = findInstaller(join(root, 'target', 'release', 'bundle', 'nsis'), { version: config.version, hint: 'run `npm run bundle` first' })
const repo = gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'])
const from = pickUpgradeFrom(publishedReleases(repo), config.version, process.env.UPGRADE_FROM)
assert.ok(from, 'a published version to update from')

// The check's copies keep their data where this computer's own copy does: set it aside, so what
// they write (identity, session records, web view profile) is gone afterwards.
await withAppDataSetAside(appData, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'openquote-care-upgrade-'))
  const target = join(temp, 'app')
  const exe = join(target, exeName)
  try {
    run(await downloadInstaller({ repo, tag: from, dir: temp }), nsisArgs(target), 'installing the published version')
    assert.equal(fileVersion(exe), from.replace(/^v/, ''), 'the published version is installed')
    assert.ok(await startsAndStays(exe, { env: checkEnv() }), 'the published version starts')
    const device = await readFile(join(appData, 'device-id'), 'utf8')
    console.log(`  ✓ ${from} installed and started`)

    await seedProfileSnapshot(appData)

    run(next, nsisArgs(target), 'installing this version over it')
    assert.equal(fileVersion(exe), config.version, 'the update replaced the app')
    assert.ok(existsSync(join(target, 'sidecar', 'openquote-care-sidecar.exe')), 'the engine sidecar is still there')
    assert.ok(await startsAndStays(exe, { env: checkEnv() }), 'the updated app starts')
    assert.equal(await readFile(join(appData, 'device-id'), 'utf8'), device, 'the device keeps its identity')
    assert.ok(!existsSync(profileSnapshots(appData)), 'profile copies from before the update are gone')
    console.log(`  ✓ ${config.version} installed over ${from}: starts, keeps its device identity, drops old profile copies`)
  } finally {
    if (await uninstall(target, { exe: exeName })) console.log('  ✓ uninstalled')
    await rm(temp, { recursive: true, force: true })
  }
})
