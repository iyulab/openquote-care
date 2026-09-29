// Checks that this version installs over the latest published one the way a person updates the
// app: download the published installer, install it for the current user, start it once, then
// run this version's installer into the same folder without uninstalling. The update must keep
// the app's own data (its device identity), start, and drop the web view profile copies an
// earlier version could have left form entries in.
//
//   npm run bundle          builds target/release/bundle/nsis/*-setup.exe
//   npm run test:upgrade    runs this check (needs `gh` signed in to read the releases)
//
// UPGRADE_FROM=<tag> picks the published version to update from; the default is the latest one
// that is not this version.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const bundleDir = join(root, 'target', 'release', 'bundle', 'nsis')
const config = JSON.parse(readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'))
const appData = join(process.env.LOCALAPPDATA, config.identifier)

function run(exe, args, what) {
  const result = spawnSync(exe, args, { stdio: 'ignore', windowsVerbatimArguments: true })
  if (result.status !== 0) throw new Error(`${what}: ${exe} ${args.join(' ')} exited with ${result.status}`)
}

function gh(args) {
  const result = spawnSync('gh', args, { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`gh ${args.join(' ')}: ${result.stderr.trim()}`)
  return result.stdout.trim()
}

/** The version the installed app's executable reports, from its file properties. */
function fileVersion(exe) {
  const ps = spawnSync('powershell', ['-NoProfile', '-Command', `(Get-Item '${exe}').VersionInfo.ProductVersion`], { encoding: 'utf8' })
  return ps.stdout.trim()
}

async function startOnce(exe) {
  const env = { ...process.env }
  delete env.OPENQUOTE_SIDECAR_EXE
  const child = spawn(exe, [], { stdio: 'ignore', env })
  await new Promise((r) => setTimeout(r, 8000))
  const running = child.exitCode === null
  child.kill()
  await new Promise((done) => (child.exitCode !== null ? done() : child.once('exit', done)))
  return running
}

async function main() {
  const found = existsSync(bundleDir) ? readdirSync(bundleDir).filter((f) => f.endsWith(`_${config.version}_x64-setup.exe`)) : []
  if (found.length !== 1) throw new Error(`expected the ${config.version} installer in ${bundleDir} — run \`npm run bundle\` first`)
  const next = join(bundleDir, found[0])

  const repo = gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'])
  const published = JSON.parse(gh(['release', 'list', '-R', repo, '--exclude-drafts', '--json', 'tagName,publishedAt']))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .map((r) => r.tagName)
  const from = process.env.UPGRADE_FROM || published.find((tag) => tag !== `v${config.version}`)
  assert.ok(from, 'a published version to update from')

  const temp = await mkdtemp(join(tmpdir(), 'openquote-care-upgrade-'))
  const target = join(temp, 'app')
  try {
    gh(['release', 'download', from, '-R', repo, '--pattern', '*_x64-setup.exe', '--dir', temp])
    const setup = (await readdir(temp)).find((f) => f.endsWith('_x64-setup.exe'))
    run(join(temp, setup), ['/S', `/D=${target}`], 'installing the published version')
    const exe = join(target, 'openquote-care.exe')
    assert.equal(fileVersion(exe), from.replace(/^v/, ''), 'the published version is installed')
    assert.ok(await startOnce(exe), 'the published version starts')
    const device = await readFile(join(appData, 'device-id'), 'utf8')
    console.log(`  ✓ ${from} installed and started`)

    // What a runtime update leaves behind: a copy of the profile from before it.
    const snapshot = join(appData, 'EBWebView', 'Snapshots', '1.0.0.0', 'Default')
    await mkdir(snapshot, { recursive: true })
    await writeFile(join(snapshot, 'Web Data'), 'an entry typed into an earlier version')

    run(next, ['/S', `/D=${target}`], 'installing this version over it')
    assert.equal(fileVersion(exe), config.version, 'the update replaced the app')
    assert.ok(existsSync(join(target, 'sidecar', 'openquote-care-sidecar.exe')), 'the engine sidecar is still there')
    assert.ok(await startOnce(exe), 'the updated app starts')
    assert.equal(await readFile(join(appData, 'device-id'), 'utf8'), device, 'the device keeps its identity')
    assert.ok(!existsSync(join(appData, 'EBWebView', 'Snapshots')), 'profile copies from before the update are gone')
    console.log(`  ✓ ${config.version} installed over ${from}: starts, keeps its device identity, drops old profile copies`)
  } finally {
    const uninstaller = join(target, 'uninstall.exe')
    if (existsSync(uninstaller)) {
      run(uninstaller, ['/S'], 'uninstalling')
      for (let i = 0; i < 40 && existsSync(join(target, 'openquote-care.exe')); i++) await new Promise((r) => setTimeout(r, 250))
      console.log('  ✓ uninstalled')
    }
    await rm(temp, { recursive: true, force: true })
  }
}

await main()
