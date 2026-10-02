// Checks the way an installed app updates itself, end to end, on this computer: an installer built
// like a release (with an updater signature, made with a key generated for this run), installed for
// the current user, finds a newer version described at a local address, and — when the person chooses
// to update — downloads it, checks its signature, closes, lets the installer replace it and starts
// again. The "newer" installer is the same one under a higher version number: what is checked is the
// way there, not what arrives.
//
//   npm run test:update      builds the test installer (a release build), runs the check, uninstalls
//
// The test build has its own name and identifier, so it never touches an installed Openquote Care or
// its data, and a debugging port in its configuration so its window can be driven.

import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { App } from '@iyulab/tauri-kit-dev/app'
import { nsisArgs, run, uninstall } from '@iyulab/tauri-kit-dev/installer'
import { verifies } from '../scripts/verify-update-signature.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const base = JSON.parse(readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'))
const PORT = 9225
const NAME = 'Openquote Care Update Test'
const exeName = 'openquote-care.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** The installed copies of the test app that are running, by process id. */
function running(exe) {
  const ps = spawnSync('powershell', ['-NoProfile', '-Command', `Get-Process | Where-Object { $_.Path -eq '${exe}' } | ForEach-Object { $_.Id }`], { encoding: 'utf8' })
  return ps.stdout.split(/\s+/).filter(Boolean).map(Number)
}

const temp = await mkdtemp(join(tmpdir(), 'openquote-care-update-'))
const target = join(temp, 'app')
const exe = join(target, exeName)
let server
let app
try {
  // A key for this run only.
  const key = join(temp, 'updater.key')
  const keygen = spawnSync('npx', ['tauri', 'signer', 'generate', '-w', key, '-p', '""', '--ci'], { cwd: root, shell: true, encoding: 'utf8' })
  assert.equal(keygen.status, 0, keygen.stderr)
  const main = base.app.windows.find((w) => w.label === 'main')
  const conf = join(temp, 'tauri.update-test.conf.json')
  await writeFile(
    conf,
    JSON.stringify({
      productName: NAME,
      identifier: `${base.identifier}.update-test`,
      app: { windows: [{ ...main, title: NAME, additionalBrowserArgs: `--remote-debugging-port=${PORT}` }] },
      bundle: { createUpdaterArtifacts: true },
      plugins: {
        updater: {
          pubkey: readFileSync(`${key}.pub`, 'utf8').trim(),
          endpoints: ['http://127.0.0.1:1/latest.json'],
          dangerousInsecureTransportProtocol: true,
          windows: { installMode: 'passive' },
        },
      },
    }),
  )
  const build = spawnSync('npx', ['tauri', 'build', '--config', 'src-tauri/tauri.bundle.conf.json', '--config', conf], {
    cwd: root,
    shell: true,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY: key, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: '' },
  })
  assert.equal(build.status, 0, 'the test installer builds')
  const installer = join(root, 'target', 'release', 'bundle', 'nsis', `${NAME}_${base.version}_x64-setup.exe`)
  assert.ok(existsSync(installer), `the test installer: ${installer}`)
  assert.ok(verifies(readFileSync(installer), readFileSync(`${installer}.sig`, 'utf8'), readFileSync(`${key}.pub`, 'utf8')), 'the installer carries an updater signature')
  // The updater installs only what was signed for the version announced: signed again as the newer one.
  const resign = spawnSync('npx', ['tauri', 'signer', 'sign', '-f', key, '-p', '""', '--app-version', '9.9.9', `"${installer}"`], { cwd: root, shell: true, encoding: 'utf8' })
  assert.equal(resign.status, 0, resign.stderr)
  const signature = readFileSync(`${installer}.sig`, 'utf8')

  // The newer version, described and served here.
  const asked = []
  server = createServer((req, res) => {
    asked.push(req.url)
    if (req.url === '/latest.json') {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ version: '9.9.9', pub_date: new Date().toISOString(), platforms: { 'windows-x86_64': { signature, url: `http://127.0.0.1:${server.address().port}/setup.exe` } } }))
    } else if (req.url === '/setup.exe') {
      res.setHeader('content-length', statSync(installer).size)
      createReadStream(installer).pipe(res)
    } else {
      res.statusCode = 404
      res.end()
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const endpoint = `http://127.0.0.1:${server.address().port}/latest.json`

  run(installer, nsisArgs(target), 'installing the test build')
  assert.ok(existsSync(exe), 'installed')
  // The installer keeps the files' own times, so what shows it ran again is a file it puts back.
  const marker = join(target, 'licenses', 'Pretendard-OFL.txt')
  assert.ok(existsSync(marker))
  await rm(marker)
  console.log('  ✓ the test build installed for the current user')

  const env = { ...process.env, OPENQUOTE_UPDATE_ENDPOINT: endpoint }
  delete env.OPENQUOTE_SIDECAR_EXE
  app = await App.launch({ exe, port: PORT, env, debugPortFromEnv: false, ready: `customElements.get('oc-app') && !!document.querySelector('oc-app')` })
  await app.cdp.waitFor(`(__e2e.one('dc-toast[data-role=update]')?.message ?? '').includes('9.9.9')`, 'the notice of the new version')
  console.log('  ✓ the newer version is found and offered')
  const before = running(exe)
  assert.equal(before.length, 1, 'one copy running')

  // The notice's own button, "Update now".
  await app.click('dc-button[part="action"]')
  const until = Date.now() + 120_000
  while (!(asked.includes('/setup.exe') && !running(exe).includes(before[0]) && running(exe).length === 1) && Date.now() < until) await sleep(500)
  assert.ok(asked.includes('/setup.exe'), 'the installer was downloaded')
  assert.ok(!running(exe).includes(before[0]), 'the app ended to let the installer run')
  assert.equal(running(exe).length, 1, 'and started again after it')
  assert.ok(existsSync(marker), 'the installer ran over the installed app')
  console.log('  ✓ downloaded, signature checked, installed, started again')
  app.cdp?.close()
  app.child = undefined
} finally {
  for (const pid of running(exe)) spawnSync('taskkill', ['/F', '/PID', String(pid)])
  server?.close()
  await sleep(1000)
  await uninstall(target, { exe: exeName }).catch(() => {})
  await rm(temp, { recursive: true, force: true }).catch(() => {})
  // The test build's own data folder (its device id and web view profile), named by its identifier.
  if (process.env.LOCALAPPDATA) await rm(join(process.env.LOCALAPPDATA, `${base.identifier}.update-test`), { recursive: true, force: true }).catch(() => {})
}
console.log('the installed app updates itself')
