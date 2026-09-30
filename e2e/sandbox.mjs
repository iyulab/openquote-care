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

import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const inside = 'C:\\openquote-care-check'
const timeoutMs = 15 * 60 * 1000

const args = process.argv.slice(2)
const prepareOnly = args.includes('--prepare')
const withoutWebView2 = args.includes('--without-webview2')
const given = args.find((a) => !a.startsWith('--'))

function gh(ghArgs) {
  const result = spawnSync('gh', ghArgs, { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`gh ${ghArgs.join(' ')}: ${result.stderr.trim()}`)
  return result.stdout.trim()
}

/** The installer to check: the one given, or the latest release's offline installer. */
function installer(folder) {
  if (given) {
    if (!existsSync(given)) throw new Error(`no installer at ${given}`)
    return given
  }
  const tag = gh(['release', 'view', '--json', 'tagName', '--jq', '.tagName'])
  gh(['release', 'download', tag, '--pattern', '*_x64-offline-setup.exe', '--dir', folder])
  const found = readdirSync(folder).filter((f) => f.endsWith('_x64-offline-setup.exe'))
  if (found.length !== 1) throw new Error(`release ${tag} has no offline installer`)
  console.log(`  · ${found[0]} (release ${tag})`)
  return join(folder, found[0])
}

function wsb(folder) {
  return `<Configuration>
  <Networking>Disable</Networking>
  <vGPU>Disable</vGPU>
  <MappedFolders>
    <MappedFolder>
      <HostFolder>${folder}</HostFolder>
      <SandboxFolder>${inside}</SandboxFolder>
      <ReadOnly>false</ReadOnly>
    </MappedFolder>
  </MappedFolders>
  <LogonCommand>
    <Command>powershell -NoProfile -ExecutionPolicy Bypass -File ${inside}\\inside.ps1${withoutWebView2 ? ' -WithoutWebView2' : ''}</Command>
  </LogonCommand>
</Configuration>
`
}

async function waitFor(file) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (existsSync(file)) {
      // Written in one go by the sandbox, but read only once it parses.
      try {
        return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 5000))
  }
  throw new Error(`no result from the sandbox within ${timeoutMs / 60000} minutes`)
}

/** Whether a command is on PATH. */
function has(command) {
  return spawnSync('where', [command], { stdio: 'ignore' }).status === 0
}

/**
 * Starts the sandbox and returns how to close it: the .wsb file is opened the way a person would,
 * and closing means ending the sandbox's processes, which discards it too. (The `wsb` command line
 * of Windows 11 24H2 is not used: no run here has had it, and a path never run is not kept.)
 */
function startSandbox(config) {
  // Only one sandbox runs at a time, and one that is still shutting down keeps the next from
  // running its logon command.
  if (sandboxRunning()) throw new Error('a Windows Sandbox is already running - close it and try again')
  spawn('WindowsSandbox', [config], { detached: true, stdio: 'ignore' }).unref()
  return () => {
    for (const name of ['WindowsSandboxRemoteSession.exe', 'WindowsSandboxServer.exe', 'WindowsSandboxClient.exe', 'WindowsSandbox.exe']) {
      spawnSync('taskkill', ['/F', '/IM', name], { stdio: 'ignore' })
    }
    // The virtual machine outlives those processes by a while; wait for it so the next run starts clean.
    const until = Date.now() + 5 * 60 * 1000
    while (sandboxRunning() && Date.now() < until) spawnSync('powershell', ['-NoProfile', '-Command', 'Start-Sleep 3'])
  }
}

/** Whether a sandbox's virtual machine is running (its memory process is named after it). */
function sandboxRunning() {
  const list = spawnSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8' }).stdout ?? ''
  return /"(vmmemWindowsSandbox|WindowsSandboxServer\.exe)"/i.test(list)
}

async function main() {
  if (!prepareOnly && !has('WindowsSandbox')) {
    throw new Error('Windows Sandbox is not available — turn on the Containers-DisposableClientVM feature and restart')
  }
  const folder = await mkdtemp(join(tmpdir(), 'openquote-care-sandbox-'))
  const from = installer(folder)
  if (dirname(from) !== folder) copyFileSync(from, join(folder, basename(from)))
  // The sandbox runs Windows PowerShell 5.1, which reads a file without a byte order mark in the
  // ANSI code page: one non-ASCII character inside a string can end it early and the script never
  // starts. The mark makes it read the file as UTF-8.
  await writeFile(join(folder, 'inside.ps1'), '﻿' + readFileSync(join(here, 'sandbox-inside.ps1'), 'utf8').replace(/^﻿/, ''))
  await mkdir(join(folder, 'out'))
  const config = join(folder, 'check.wsb')
  await writeFile(config, wsb(folder))
  if (prepareOnly) {
    console.log(`  · prepared ${folder} — open ${config} to run it by hand; the result lands in out\\result.json`)
    return
  }

  const close = startSandbox(config)
  let result
  try {
    console.log('  · sandbox started (networking off)')
    result = await waitFor(join(folder, 'out', 'result.json'))
  } catch (e) {
    const progress = join(folder, 'out', 'progress.log')
    const log = existsSync(progress) ? `\n${readFileSync(progress, 'utf8').trimEnd()}` : ' (the script inside never started)'
    throw new Error(`${e.message} — the folder is kept: ${folder}; steps seen:${log}`)
  } finally {
    close()
  }
  for (const step of result.steps) {
    const shown = !step.ok ? step.error : typeof step.value === 'object' && step.value !== null ? JSON.stringify(step.value, null, 2) : step.value ?? '(none)'
    console.log(`  ${step.ok ? '·' : '✗'} ${step.name}: ${shown}`)
  }
  const value = (name) => result.steps.find((s) => s.name === name)?.value
  assert.equal(value('network'), 'offline', 'the sandbox has no network')
  // Say when the sandbox, not the installer, is what cannot provide a web view.
  if (!withoutWebView2 && /no runtime files/.test(value('webview2 before') ?? '')) {
    console.log('  ! this sandbox registers a WebView2 runtime whose files are missing, so no window can start here — run with --without-webview2')
  }
  const setup = value('install diagnostics')?.webview2Setup
  if (setup?.length) console.log(`  ! the WebView2 setup the installer carries failed inside the sandbox:\n    ${setup.join('\n    ')}`)
  assert.ok(result.ok, `every step in the sandbox passed — the folder is kept: ${folder}`)
  assert.ok(value('webview2 after'), 'a WebView2 runtime is registered after the install')
  if (withoutWebView2) assert.equal(value('webview2 before'), null, 'the WebView2 runtime was gone before the install')
  console.log(value('webview2 before')
    ? '  ✓ installed and started without a network (WebView2 was already there — this does not show an install onto a computer without it)'
    : '  ✓ installed and started without a network, with the WebView2 runtime from the installer')
  await rm(folder, { recursive: true, force: true })
}

main().catch((e) => {
  console.error(`✗ ${e.message}`)
  process.exit(1)
})
