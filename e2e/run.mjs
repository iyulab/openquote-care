// End-to-end scenarios against the real app window: WebView2 driven over CDP, files checked on disk.
//
//   npm run build:sidecar   builds the engine sidecar the app starts
//   npm run build:e2e       builds the debug app with the e2e config (debugging port 9224)
//   npm run test:e2e        runs every scenario against a fresh temporary folder
//                           (E2E_SCREENSHOTS=<dir> saves a picture of the window after each one)
//
// The one seam: the folder picker is a native dialog, so the scenarios put the folder where the
// picker's result goes (the app element's `folder`). Everything after that is clicks and typing.

import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { Cdp, findPage } from './cdp.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const exe = join(root, 'target', 'debug', process.platform === 'win32' ? 'openquote-care.exe' : 'openquote-care')
const sidecar = resolve(
  process.env.OPENQUOTE_SIDECAR_EXE ??
    join(root, 'sidecar', 'OpenquoteCare.Sidecar', 'bin', 'Release', 'net10.0', process.platform === 'win32' ? 'openquote-care-sidecar.exe' : 'openquote-care-sidecar'),
)
const PORT = 9224
const PASSPHRASE = '상담 기록 볼트 2026'

/** In-page helpers: queries that pierce shadow roots, and element boxes for real clicks. */
const HELPERS = `window.__e2e = {
  all(selector, root = document) {
    const found = [...root.querySelectorAll(selector)]
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) found.push(...this.all(selector, el.shadowRoot))
    return found
  },
  one(selector, text) {
    const matches = (el) => el.textContent.replace(/\\s+/g, ' ').trim() === text
    return this.all(selector).find((el) => text === undefined || matches(el))
  },
  box(el) {
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  },
}; true`

const q = (s) => JSON.stringify(s)

class App {
  /** Starts the app and waits for its window. */
  static async launch() {
    const app = new App()
    app.child = spawn(exe, [], { stdio: 'ignore', env: { ...process.env, OPENQUOTE_SIDECAR_EXE: sidecar } })
    const page = await findPage(PORT)
    app.cdp = await Cdp.connect(page.webSocketDebuggerUrl)
    await app.cdp.waitFor(`customElements.get('oc-app') && !!document.querySelector('oc-app')`, 'the app')
    await app.cdp.evaluate(HELPERS)
    return app
  }

  /** Ends the app the hard way and starts it again, in this same App. */
  async restart() {
    await this.quit()
    const next = await App.launch()
    this.child = next.child
    this.cdp = next.cdp
  }

  async quit() {
    this.cdp?.close()
    const child = this.child
    if (!child) return
    child.kill()
    await new Promise((done) => (child.exitCode !== null ? done() : child.once('exit', done)))
    this.child = undefined
  }

  /** Clicks the element matching `selector` (and `text`, if given) with the mouse. */
  async click(selector, text) {
    const box = await this.cdp.waitFor(
      `(() => { const el = __e2e.one(${q(selector)}, ${q(text)}); return el && !el.disabled && !el.hasAttribute('disabled') && __e2e.box(el) })()`,
      `${selector}${text ? ` "${text}"` : ''} to be clickable`,
    )
    await this.cdp.clickAt(box)
  }

  /** Focuses the field labelled `label`, clears it, and types `text`. */
  async type(label, text) {
    await this.cdp.waitFor(
      `(() => { const el = __e2e.one(${q(`input[aria-label="${label}"]`)}); if (!el || el.disabled) return false; el.focus(); el.select(); return true })()`,
      `field "${label}"`,
    )
    await this.cdp.insertText(text)
  }

  /** Where the folder picker's answer lands. */
  pickFolder(path) {
    return this.cdp.evaluate(`(() => { document.querySelector('oc-app').folder = ${q(path)}; return true })()`)
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

const scenarios = {
  async 'leaves nothing behind when the app ends at the recovery kit'(app, work) {
    await app.click('dc-button', '새 볼트 만들기')
    await app.pickFolder(work.vault)
    await app.type('패스프레이즈', PASSPHRASE)
    await app.type('패스프레이즈 다시 입력', PASSPHRASE)
    await app.click('dc-button', '만들기')
    await app.heading('복구 키트')
    await app.restart()
    assert.deepEqual(await readdir(work.vault), [], 'no vault to open without its kit')
    await app.heading('Openquote Care')
  },

  async 'refuses a short passphrase before touching the disk'(app, work) {
    await app.click('dc-button', '새 볼트 만들기')
    await app.heading('새 볼트 만들기')
    await app.pickFolder(work.vault)
    await app.type('패스프레이즈', 'short')
    await app.type('패스프레이즈 다시 입력', 'short')
    await app.click('dc-button', '만들기')
    await app.alert('패스프레이즈는 8자 이상이어야 합니다.')
    assert.deepEqual(await readdir(work.vault), [], 'nothing written')
  },

  async 'creates a vault and shows its recovery kit'(app, work) {
    await app.type('패스프레이즈', PASSPHRASE)
    await app.type('패스프레이즈 다시 입력', PASSPHRASE)
    await app.click('dc-button', '만들기')
    await app.heading('복구 키트')
    const shown = await app.cdp.evaluate(`__e2e.one('[data-role=key]').textContent`)
    work.key = shown.replaceAll(/\s+/g, '')
    assert.equal(shown.trim().split(/\s+/).at(-1), work.key.slice(-6), 'the last group is what gets typed back')
    assert.match(work.key, /^AGE-SECRET-KEY-1[0-9A-Z]{58}$/, 'the whole key, in groups')
    assert.deepEqual(await readdir(work.vault), [], 'nothing written before the kit is confirmed')
    await app.noAlert()
  },

  async 'keeps the vault locked until the end of the key is typed back'(app, work) {
    await app.type('보관했는지 확인: 볼트 키의 마지막 묶음(6자)을 입력하세요', 'ZZZZZZ')
    await app.click('dc-button', '확인')
    await app.alert('볼트 키의 마지막 글자와 다릅니다. 다시 확인하세요.')
    await app.heading('복구 키트')

    await app.type('보관했는지 확인: 볼트 키의 마지막 묶음(6자)을 입력하세요', work.key.slice(-6).toLowerCase())
    await app.click('dc-button', '확인')
    await app.heading('볼트가 열렸습니다')
    await app.noAlert()
    assert.ok((await readdir(work.vault)).length > 0, 'the vault is on disk once confirmed')
    const keyStillShown = await app.cdp.evaluate(`__e2e.all('*').some((el) => el.textContent?.includes(${q(work.key.slice(16, 28))}))`)
    assert.equal(keyStillShown, false, 'the key is gone from the window')
  },

  async 'closes the vault and refuses the wrong passphrase'(app, work) {
    await app.click('dc-button', '볼트 닫기')
    await app.heading('Openquote Care')
    await app.click('dc-button', '볼트 열기')
    await app.heading('볼트 열기')
    await app.pickFolder(work.vault)
    await app.type('패스프레이즈', 'not the passphrase')
    await app.click('dc-button', '열기')
    await app.alert('패스프레이즈가 맞지 않습니다.')
  },

  async 'opens the vault again with its passphrase'(app, work) {
    await app.type('패스프레이즈', PASSPHRASE)
    await app.click('dc-button', '열기')
    await app.heading('볼트가 열렸습니다')
    await app.noAlert()
  },

  async 'says so when a folder is not a vault'(app, work) {
    await app.click('dc-button', '볼트 닫기')
    await app.click('dc-button', '볼트 열기')
    await app.pickFolder(work.empty)
    await app.type('패스프레이즈', PASSPHRASE)
    await app.click('dc-button', '열기')
    await app.alert('이 폴더는 볼트가 아닙니다.')
  },
}

/** With E2E_SCREENSHOTS=<dir>, each passed scenario leaves a picture of the window. */
async function screenshot(cdp, dir, name) {
  const { writeFile } = await import('node:fs/promises')
  await mkdir(dir, { recursive: true })
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
  await writeFile(join(dir, `${name.replace(/[^\p{L}\p{N}]+/gu, '-')}.png`), Buffer.from(data, 'base64'))
}

async function main() {
  if (!existsSync(exe)) throw new Error(`no e2e build at ${exe} — run \`npm run build:e2e\` first`)
  if (!existsSync(sidecar)) throw new Error(`no sidecar at ${sidecar} — run \`npm run build:sidecar\` first`)
  const temp = await mkdtemp(join(tmpdir(), 'openquote-care-e2e-'))
  const work = { vault: join(temp, 'vault'), empty: join(temp, 'empty') }
  await mkdir(work.vault)
  await mkdir(work.empty)

  let app
  let failed = 0
  try {
    app = await App.launch()
    // Scenarios run in order against one window: each builds on what the last one left.
    for (const [name, run] of Object.entries(scenarios)) {
      try {
        await run(app, work)
        console.log(`  ✓ ${name}`)
        if (process.env.E2E_SCREENSHOTS) await screenshot(app.cdp, process.env.E2E_SCREENSHOTS, name)
      } catch (e) {
        failed++
        console.log(`  ✗ ${name}\n    ${e.message.replaceAll('\n', '\n    ')}`)
        if (process.env.E2E_SCREENSHOTS) await screenshot(app.cdp, process.env.E2E_SCREENSHOTS, `FAILED ${name}`)
        break
      }
    }
  } finally {
    await app?.quit()
    await rm(temp, { recursive: true, force: true })
  }
  console.log(failed ? `\n${failed} scenario failed` : `\nall ${Object.keys(scenarios).length} scenarios passed`)
  process.exitCode = failed ? 1 : 0
}

await main()
