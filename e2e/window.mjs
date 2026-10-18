// The app's window for scripts that drive it: the e2e scenarios and the website pictures. The debug
// build with the e2e configuration (`npm run build:e2e`) opens a debugging port of its own.

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { App as KitApp } from '@iyulab/tauri-kit-dev/app'
import { checkMachine } from '@iyulab/tauri-kit-dev/machine'

const here = dirname(fileURLToPath(import.meta.url))
export const root = join(here, '..')
export const exe = join(root, 'target', 'debug', process.platform === 'win32' ? 'openquote-care.exe' : 'openquote-care')
export const sidecar = resolve(
  process.env.OPENQUOTE_SIDECAR_EXE ??
    join(root, 'sidecar', 'OpenquoteCare.Sidecar', 'bin', 'Release', 'net10.0', process.platform === 'win32' ? 'openquote-care-sidecar.exe' : 'openquote-care-sidecar'),
)
export const PORT = 9224
/** The e2e build's identifier, which names its app data folder and its WebView2 profile. */
export const E2E_IDENTIFIER = JSON.parse(readFileSync(join(root, 'src-tauri', 'tauri.e2e.conf.json'), 'utf8')).identifier

// The sidecar finds a per-user .NET only through DOTNET_ROOT; without it the window says only that
// the app could not get ready to open records. Set it as `npm run verify` does, when the shell has not.
const machine = process.env.DOTNET_ROOT ? {} : checkMachine({ dotnet: true }).set

export const q = (s) => JSON.stringify(s)

/**
 * The app's window, driven the way a person uses it: the kit starts it, puts the in-page helpers
 * (`__e2e`) in and clicks; what is this app's own — its fields found by their Korean names, the
 * folder picker's stand-in, the open vault — is here.
 */
export class App {
  /** @type {KitApp | undefined} */
  kit

  /** Starts the app, with `env` added to its environment, and waits for its window. */
  static async launch(env = {}) {
    const app = new App()
    app.kit = await KitApp.launch({
      exe,
      port: PORT,
      env: { OPENQUOTE_SIDECAR_EXE: sidecar, OPENQUOTE_UI_LOCALE: 'ko', ...machine, ...env },
      // The e2e build's window configuration opens the debugging port itself.
      debugPortFromEnv: false,
      // Its identifier names the WebView2 profile: a restart waits for the browser of the window it ended to be
      // gone, since a window started while that browser is still shutting down joins it and never opens the port.
      webviewProfile: E2E_IDENTIFIER,
      ready: `customElements.get('oc-app') && !!document.querySelector('oc-app')`,
    })
    return app
  }

  get cdp() {
    return this.kit.cdp
  }

  get child() {
    return this.kit?.child
  }

  /** Ends the app the hard way and starts it again, in this same App, with `env` added. */
  restart(env = {}) {
    return this.kit.restart(env)
  }

  async quit() {
    await this.kit?.quit()
  }

  /**
   * Ends the app the way Windows does at shutdown, restart or sign-out: every top-level window of its
   * process is asked `WM_QUERYENDSESSION`, then told `WM_ENDSESSION`, and the process is waited for.
   */
  async endSession() {
    const child = this.child
    assert.equal(process.platform, 'win32', 'the session-ending messages are Windows ones')
    const script = `
Add-Type @'
using System; using System.Runtime.InteropServices; using System.Collections.Generic;
public static class SessionEnd {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr h, uint m, IntPtr w, IntPtr l, uint f, uint t, out IntPtr r);
  public static int Send(uint pid) {
    var windows = new List<IntPtr>();
    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p == pid) windows.Add(h); return true; }, IntPtr.Zero);
    IntPtr r;
    foreach (var h in windows) SendMessageTimeout(h, 0x11, IntPtr.Zero, IntPtr.Zero, 2, 5000, out r);
    foreach (var h in windows) SendMessageTimeout(h, 0x16, (IntPtr)1, IntPtr.Zero, 2, 5000, out r);
    return windows.Count;
  }
}
'@
[SessionEnd]::Send(${child.pid})`
    const exited = new Promise((done) => (child.exitCode !== null ? done() : child.once('exit', done)))
    const sent = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' })
    assert.equal(sent.status, 0, `the session-ending messages were not sent: ${sent.stderr}`)
    assert.ok(Number(sent.stdout.trim()) > 0, 'the app has top-level windows to tell')
    await Promise.race([exited, new Promise((_, fail) => setTimeout(() => fail(new Error('the app did not exit when the session ended')), 15_000))])
  }

  /** Clicks the element matching `selector` (and `text`, if given) with the mouse. */
  click(selector, text) {
    return this.kit.click(selector, text)
  }

  /** Focuses the field labelled `label`, clears it, and types `text`. */
  async type(label, text) {
    await this.cdp.waitFor(
      `(() => { const el = __e2e.one(${q(`input[aria-label="${label}"]`)}); if (!el || el.disabled) return false; el.focus(); el.select(); return true })()`,
      `field "${label}"`,
    )
    await this.cdp.insertText(text)
  }

  /** Focuses the multi-line field labelled `label`, clears it, and types `text`. */
  async write(label, text) {
    await this.cdp.waitFor(
      `(() => { const el = __e2e.one(${q(`textarea[aria-label="${label}"]`)}); if (!el || el.disabled) return false; el.focus(); el.select(); return true })()`,
      `text area "${label}"`,
    )
    await this.cdp.insertText(text)
  }

  /** Where the folder picker's answer lands. */
  pickFolder(path) {
    return this.cdp.evaluate(`(() => { document.querySelector('oc-app').folder = ${q(path)}; return true })()`)
  }

  /** Opens the folder's menu in the top bar and picks the action named `label` from it. */
  async folderAction(label) {
    await this.click('dc-button[data-role=folder-menu]')
    await this.click('[role=menuitem]', label)
  }

  /** Picks an option in the dropdown labelled `label`, the way a person's choice reports it. */
  async choose(label, value) {
    await this.cdp.waitFor(
      `(() => { const el = __e2e.one(${q(`select[aria-label="${label}"]`)}); if (!el || el.disabled || ![...el.options].some((o) => o.value === ${q(value)})) return false
        el.value = ${q(value)}; el.dispatchEvent(new Event('change', { bubbles: true, composed: true })); return true })()`,
      `dropdown "${label}" to offer "${value}"`,
    )
  }

  /** Sets the date field labelled `label` (a native date input: typing into it depends on the locale). */
  async setDate(label, value) {
    await this.cdp.waitFor(
      `(() => { const el = __e2e.one(${q(`input[aria-label="${label}"]`)}); if (!el || el.disabled) return false
        el.value = ${q(value)}; el.dispatchEvent(new Event('input', { bubbles: true, composed: true })); return true })()`,
      `date "${label}"`,
    )
  }

  /**
   * Waits for the open vault, its screens drawn (its first read ended — `dp-shell` replaces the opening line); an
   * alert shown instead (the engine did not start, say) fails at once, naming it.
   */
  async vaultOpen() {
    const outcome = await this.cdp.waitFor(
      `__e2e.one('oc-vault') && __e2e.one('dp-shell') ? 'open' : __e2e.all('[role=alert]').map((el) => el.textContent.trim()).filter(Boolean).join(' / ')`,
      'the open vault',
      { timeoutMs: 60_000 },
    )
    if (outcome !== 'open') throw new Error(`the vault did not open: ${outcome}`)
  }

  /** Waits for a passphrase change to be said: it makes the key again as opening does, so it waits as long. */
  passphraseChanged(what) {
    return this.cdp.waitFor(`!!__e2e.one('[data-role=passphrase-changed]')`, what, { timeoutMs: 60_000 })
  }

  /** The session rows as their values read: a cell's own buttons and marks (`.cell`) left out. */
  sessionRows() {
    return this.cdp.evaluate(
      `__e2e.all('tr[data-session]').map((tr) => [...tr.children].map((td) => { const c = td.cloneNode(true); c.querySelectorAll('.cell').forEach((e) => e.remove()); return c.textContent.trim() }))`,
    )
  }

  heading(text) {
    return this.cdp.waitFor(`__e2e.all('h1, h2').some((el) => el.textContent.trim() === ${q(text)})`, `heading "${text}"`, { timeoutMs: 60_000 })
  }

  alert(text) {
    return this.cdp.waitFor(`__e2e.all('[role=alert] p').some((el) => el.textContent.trim() === ${q(text)})`, `alert "${text}"`, { timeoutMs: 60_000 })
  }

  async noAlert() {
    const alert = await this.cdp.evaluate(`__e2e.all('[role=alert]').map((el) => el.textContent.trim()).filter(Boolean).join(' / ')`)
    assert.equal(alert, '', 'no error shown')
  }
}
