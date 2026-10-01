// Checks the offline installer the way a computer without internet would get the app: in Windows
// Sandbox with networking turned off, install it silently for the current user, start it, and
// check that the app, its engine and a web view are running. The sandbox writes what it saw to a
// result file this script reads back; the sandbox is closed afterwards.
//
//   npm run test:sandbox                 the latest published offline installer (needs `gh`)
//   npm run test:sandbox -- <installer>  a given installer
//   npm run test:sandbox -- --prepare    only lay out the folder and the .wsb file, and say where
//   npm run test:sandbox -- --without-webview2
//                                        remove the WebView2 runtime in the sandbox first, so the
//                                        installer has to bring its own
//
// Windows Sandbox is an optional Windows feature (Containers-DisposableClientVM) and needs a
// restart after it is turned on. The sandbox is a copy of the host's Windows, so it has the
// WebView2 runtime when the host does: the result says whether it was there before the install,
// and a run on a host that has it proves "no network", not "no WebView2".
//
// The steps every Tauri app shares come from @iyulab/tauri-kit-dev/sandbox; this app adds one
// (sandbox-extra.ps1): its bundled engine starts and loads an empty vault.

import { readFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { downloadInstaller, gh } from '@iyulab/tauri-kit-dev/installer'
import { runInSandbox } from '@iyulab/tauri-kit-dev/sandbox'

const here = dirname(fileURLToPath(import.meta.url))
const { identifier } = JSON.parse(readFileSync(join(here, '..', 'src-tauri', 'tauri.conf.json'), 'utf8'))

const args = process.argv.slice(2)
const prepareOnly = args.includes('--prepare')
const withoutWebView2 = args.includes('--without-webview2')

/** The installer to check: the one given, or the latest release's offline installer. */
async function installer() {
  const given = args.find((a) => !a.startsWith('--'))
  if (given) return given
  const repo = gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'])
  const tag = gh(['release', 'view', '-R', repo, '--json', 'tagName', '--jq', '.tagName'])
  const path = await downloadInstaller({ repo, tag, dir: await mkdtemp(join(tmpdir(), 'openquote-care-offline-')), pattern: '*_x64-offline-setup.exe' })
  console.log(`  · ${path} (release ${tag})`)
  return path
}

try {
  const outcome = await runInSandbox({
    installer: await installer(),
    exe: 'openquote-care.exe',
    identifier,
    extraScript: join(here, 'sandbox-extra.ps1'),
    withoutWebView2,
    prepareOnly,
    inside: 'C:\\openquote-care-check',
  })
  if (prepareOnly) {
    console.log(`  · prepared ${outcome.folder} — open ${outcome.config} to run it by hand; the result lands in out\\result.json`)
  } else {
    for (const line of outcome.lines) console.log(`  ${line}`)
    if (outcome.failed.length) throw new Error(outcome.failed.join('; '))
  }
} catch (e) {
  console.error(`✗ ${e.message}`)
  process.exit(1)
}
