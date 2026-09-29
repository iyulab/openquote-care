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
import { copyFile, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
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
    // An item's text may lead with an icon ("◉ 대상자"); the label is what follows.
    const matches = (el) => {
      const t = el.textContent.replace(/\\s+/g, ' ').trim()
      return t === text || t.endsWith(' ' + text)
    }
    return this.all(selector).find((el) => text === undefined || matches(el))
  },
  box(el) {
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  },
  /**
   * The box to click, once a click there would land on el and the box held still since the last
   * poll: a smooth scroll still under way would move el between measuring and clicking.
   */
  target(el) {
    const b = this.box(el)
    const last = this.lastBox
    this.lastBox = b
    if (!last || last.x !== b.x || last.y !== b.y) return false
    let hit = document.elementFromPoint(b.x, b.y)
    while (hit?.shadowRoot) {
      const inner = hit.shadowRoot.elementFromPoint(b.x, b.y)
      if (!inner || inner === hit) break
      hit = inner
    }
    for (let n = hit; n; n = n.parentNode ?? n.host) if (n === el) return b
    return false
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
      `(() => { const el = __e2e.one(${q(selector)}, ${q(text)}); return el && !el.disabled && !el.hasAttribute('disabled') && __e2e.target(el) })()`,
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

  vaultOpen() {
    return this.cdp.waitFor(`!!__e2e.one('oc-vault')`, 'the open vault', { timeoutMs: 60_000 })
  }

  /** The rows of the sessions table, as cell texts. */
  sessionRows() {
    return this.cdp.evaluate(`__e2e.all('tr[data-session]').map((tr) => [...tr.children].map((td) => td.textContent.trim()))`)
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
    await app.vaultOpen()
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
    await app.vaultOpen()
    await app.noAlert()
  },

  async 'asks for a practitioner before a session can be recorded'(app) {
    await app.type('대상자 이름', '가상 학생 1')
    await app.click('dc-button', '대상자 추가')
    await app.cdp.waitFor(`__e2e.all('p').some((p) => p.textContent.includes('담당자를 먼저 추가하세요'))`, 'the practitioner hint')
    await app.click('button', '담당자')
    await app.type('담당자 이름', '상담자 가')
    await app.click('dc-button', '담당자 추가')
    await app.cdp.waitFor(`__e2e.all('li').some((li) => li.textContent.trim() === '상담자 가')`, 'the practitioner listed')
    await app.noAlert()
  },

  async 'records sessions under a subject, newest first'(app, work) {
    await app.click('button', '대상자')
    await app.click('li button', '가상 학생 1')
    await app.setDate('날짜', '2026-04-02')
    await app.choose('주제', 'learning')
    await app.choose('방법', 'special/school-violence')
    await app.click('dc-button', '회기 기록')
    await app.cdp.waitFor(`__e2e.all('tr[data-session]').length === 1`, 'one session')
    await app.setDate('날짜', '2026-04-09')
    await app.choose('주제', 'relation')
    await app.click('dc-button', '회기 기록')
    await app.cdp.waitFor(`__e2e.all('tr[data-session]').length === 2`, 'two sessions')
    await app.noAlert()
    assert.deepEqual(await app.sessionRows(), [
      ['2026-04-09', '관계', '', '상담자 가'],
      ['2026-04-02', '학습', '특별 › 학교폭력', '상담자 가'],
    ])
    const subjects = await readdir(join(work.vault, 'subjects'))
    assert.equal(subjects.length, 1, 'one subject folder')
    const files = await readdir(join(work.vault, 'subjects', subjects[0]))
    assert.equal(files.length, 3, 'the subject and two sessions, one file each')
    assert.ok(files.every((f) => f.endsWith('.age')), 'every record encrypted')
  },

  async 'produces the monthly report and shows what each count is made of'(app, work) {
    await app.click('button', '월 보고')
    await app.type('연도', '2026')
    await app.choose('월', '4')
    await app.click('dc-button', '산출')
    await app.cdp.waitFor(`!!__e2e.one('[data-role=period]')`, 'the report')
    await app.noAlert()
    const row = (code) => app.cdp.evaluate(`[...__e2e.one('tr[data-row=${code}]').children].map((c) => c.textContent.trim())`)
    assert.deepEqual(await row('learning'), ['학습', '1 (1명)', '1 (1명)'], 'one learning session, by 상담자 가, about one person')
    assert.deepEqual(await row('relation'), ['관계', '1 (1명)', '1 (1명)'])
    assert.deepEqual(await row('family'), ['가정', '0', '0'], 'an empty row still shows')
    assert.equal(await app.cdp.evaluate(`__e2e.one('[data-role=placed]').textContent.trim()`), '2 (1명)', 'two sessions, the same person counted once')
    assert.ok(await app.cdp.evaluate(`!!__e2e.one('[data-role=head-count-hint]')`), 'the head count is explained')
    const group = (name) => app.cdp.evaluate(`__e2e.one('tr[data-group=${name}]').children[1].textContent.trim()`)
    assert.deepEqual([await group('pending'), await group('unmapped'), await group('total')], ['0', '0', '2 (1명)'])

    await app.cdp.evaluate(`(() => { __e2e.one('tr[data-row=learning] button.cell').click(); return true })()`)
    await app.cdp.waitFor(`__e2e.all('tr[data-evidence]').length === 1`, 'the evidence')
    const evidence = await app.cdp.evaluate(`[...__e2e.one('tr[data-evidence]').children].map((c) => c.textContent.trim())`)
    assert.deepEqual(evidence, ['2026-04-02', '가상 학생 1', '학습'])

    const years = await readdir(join(work.vault, 'runs'))
    assert.deepEqual(years, ['2026'], 'the run record is kept in the vault')
    assert.equal((await readdir(join(work.vault, 'runs', '2026'))).length, 1)
  },

  async 'applies a classification revision and reports in it, holding back the split category'(app, work) {
    // The test pack: topic v2 with a v1→v2 crosswalk and the report form in v2. "learning" maps 1:1 to a new code, "academic";
    // "relation" splits in two, so its session waits for a person instead of being guessed.
    const pack = join(root, 'tests', 'golden', 'steps', '2')
    await app.cdp.evaluate(`__e2e.one('oc-vault').applyPack(${q(pack)}).then(() => true)`)
    await app.cdp.waitFor(`__e2e.all('[role=status]').some((el) => el.textContent.includes('연계표 topic v1→v2'))`, 'the revision applied')
    await app.noAlert()
    assert.equal(await app.cdp.evaluate(`__e2e.one('select[aria-label="양식"]').value`), 'monthly-topic@2', 'the new form is offered')

    await app.click('dc-button', '산출')
    await app.cdp.waitFor(`!!__e2e.one('tr[data-row=relation-peer]')`, 'the report in v2')
    const row = (code) => app.cdp.evaluate(`[...__e2e.one('tr[data-row=${code}]').children].map((c) => c.textContent.trim())`)
    assert.deepEqual((await row('academic')).slice(1), ['1 (1명)', '1 (1명)'], 'the 1:1 category carried over to its new code')
    assert.deepEqual((await row('relation-peer')).slice(1), ['0', '0'], 'the split category is not guessed')
    const group = (name) => app.cdp.evaluate(`__e2e.one('tr[data-group=${name}]').children[1].textContent.trim()`)
    assert.deepEqual([await group('pending'), await group('unmapped'), await group('total')], ['1 (1명)', '0', '2 (1명)'])

    await app.cdp.evaluate(`__e2e.one('oc-vault').applyPack(${q(pack)}).then(() => true)`)
    await app.cdp.waitFor(`__e2e.all('[role=status]').some((el) => el.textContent.includes('새 분류·양식이 없습니다'))`, 'nothing new the second time')
    assert.deepEqual((await readdir(join(work.vault, 'schemes', 'topic'))).sort(), ['v1-v2.json.age', 'v1.json.age', 'v2.json.age'])
  },

  async 'lets a person settle the split category, and the report counts it there'(app, work) {
    await app.cdp.evaluate(`(() => { __e2e.one('tr[data-group=pending] button.cell').click(); return true })()`)
    await app.cdp.waitFor(`__e2e.all('tr[data-pending]').length === 1`, 'the pending session')
    const offered = await app.cdp.evaluate(`__e2e.all('tr[data-pending] dc-button').map((b) => b.textContent.trim())`)
    assert.deepEqual(offered, ['또래관계', '교사관계'], 'only the codes the crosswalk allows')
    await app.click('dc-button', '또래관계')
    await app.cdp.waitFor(`__e2e.one('tr[data-pending]').textContent.includes('확정')`, 'the choice recorded')
    await app.noAlert()

    await app.click('dc-button', '산출')
    await app.cdp.waitFor(`__e2e.one('tr[data-group=pending]')?.children[1].textContent.trim() === '0'`, 'nothing pending')
    const row = (code) => app.cdp.evaluate(`[...__e2e.one('tr[data-row=${code}]').children].map((c) => c.textContent.trim())`)
    assert.deepEqual((await row('relation-peer')).slice(1), ['1 (1명)', '1 (1명)'])
    assert.equal(await app.cdp.evaluate(`__e2e.one('tr[data-group=total]').children[1].textContent.trim()`), '2 (1명)', 'the total did not move')
    assert.equal(await app.cdp.evaluate(`__e2e.all('[role=status]').length`), 0, 'the "produce again" hint is gone once produced')
    const subjects = await readdir(join(work.vault, 'subjects'))
    assert.equal((await readdir(join(work.vault, 'subjects', subjects[0]))).length, 4, 'the choice is a new file; the session file is untouched')
  },

  async 'explains how this report differs from the one before it'(app) {
    const offered = await app.cdp.evaluate(`[...__e2e.one('select[aria-label="이전 산출과 비교"]').options].map((o) => o.textContent.trim())`)
    assert.equal(offered.length, 2, 'the two earlier runs of April (v1, v2) and none of other periods or this one')
    assert.match(offered[0], / · v2 · 전체 2$/, 'the most recent earlier run first')
    assert.match(offered[1], / · v1 · 전체 2$/)
    await app.click('dc-button', '비교')
    await app.cdp.waitFor(`!!__e2e.one('[data-role=comparison-counts]')`, 'the comparison')
    await app.noAlert()
    assert.equal(await app.cdp.evaluate(`__e2e.one('[data-role=comparison-counts]').textContent.trim()`), '늦게 입력 0 · 빠짐 0 · 분류 개정 0 · 기록 수정 1 · 그대로 1')
    const moved = await app.cdp.evaluate(`[...__e2e.one('tr[data-change=moved]').children].map((c) => c.textContent.trim())`)
    assert.deepEqual(moved, ['2026-04-09', '가상 학생 1', '기록 수정', '재분류 대기', '또래관계 · 상담자 가'])
    const legend = await app.cdp.evaluate(`__e2e.all('[data-role=comparison-legend] dt').map((d) => d.textContent.trim())`)
    assert.deepEqual(legend, ['기록 수정'], 'the legend explains the kinds the table shows, and only those')

    // Against the v1 run the revision itself shows: the learning session moved to its new code
    // with no one touching it, while the split category's session was placed by a person.
    const v1 = await app.cdp.evaluate(`[...__e2e.one('select[aria-label="이전 산출과 비교"]').options][1].value`)
    await app.choose('이전 산출과 비교', v1)
    await app.click('dc-button', '비교')
    await app.cdp.waitFor(`__e2e.one('[data-role=comparison-counts]')?.textContent.includes('분류 개정 1')`, 'the comparison with v1')
    assert.equal(await app.cdp.evaluate(`__e2e.one('[data-role=comparison-counts]').textContent.trim()`), '늦게 입력 0 · 빠짐 0 · 분류 개정 1 · 기록 수정 1 · 그대로 0')
    const revised = await app.cdp.evaluate(`[...__e2e.one('tr[data-change=revised]').children].map((c) => c.textContent.trim())`)
    assert.deepEqual(revised, ['2026-04-02', '가상 학생 1', '분류 개정', '학습 · 상담자 가', '학업 · 상담자 가'])
    const both = await app.cdp.evaluate(`__e2e.all('[data-role=comparison-legend] dt').map((d) => d.textContent.trim())`)
    assert.deepEqual(both, ['분류 개정', '기록 수정'])
  },

  async 'brings this window forward instead of opening a second one'(app) {
    // A second start hands over to the running app and ends; this window keeps its state.
    const second = spawn(exe, [], { stdio: 'ignore', env: { ...process.env, OPENQUOTE_SIDECAR_EXE: sidecar } })
    const code = await new Promise((done, fail) => {
      const timer = setTimeout(() => fail(new Error('the second start is still running')), 15000)
      second.once('exit', (c) => (clearTimeout(timer), done(c)))
    }).finally(() => second.exitCode === null && second.kill())
    assert.equal(code, 0)
    assert.equal(app.child.exitCode, null, 'the first app still runs')
    assert.ok(await app.cdp.evaluate(`!!__e2e.one('[data-role=comparison-counts]')`), 'and still shows what it showed')
  },

  async 'names this device, and the name is what the vault shows for it'(app, work) {
    await app.click('button', '기기')
    await app.cdp.waitFor(`__e2e.all('p').some((p) => p.textContent.includes('아직 이름이 붙은 기기가 없습니다'))`, 'no device named yet')
    await app.type('이 기기 이름', '상담실 PC')
    await app.click('dc-button', '저장')
    await app.cdp.waitFor(`__e2e.all('li[data-device]').some((li) => li.textContent.trim() === '이 기기(상담실 PC)')`, 'this device named')
    await app.noAlert()
    const devices = await readdir(join(work.vault, 'devices'))
    assert.equal(devices.length, 1, 'the name is a change file in the vault, where every device reads it')
    assert.match(devices[0], /\.json\.age$/)
  },

  async 'takes in what another program writes to the vault folder, without being asked'(app, work) {
    // A file arriving from outside (here: a copy under a name its content does not match, so the
    // engine reports it as unreadable) shows up with no refresh button and no window focus.
    const subjects = join(work.vault, 'subjects')
    const folder = join(subjects, (await readdir(subjects))[0])
    const source = (await readdir(folder)).find((f) => f.endsWith('.json.age'))
    const stray = join(folder, '01900000-0000-7000-8000-000000000001.pc99.json.age')
    await copyFile(join(folder, source), stray)
    await app.cdp.waitFor(`__e2e.all('p.error').some((p) => p.textContent.includes('읽지 못한 파일 1개'))`, 'the outside file noticed')
    await rm(stray)
    await app.cdp.waitFor(`!__e2e.all('p.error').some((p) => p.textContent.includes('읽지 못한 파일'))`, 'its removal noticed')
    await app.noAlert()
  },

  async 'keeps the sessions across a restart'(app, work) {
    await app.restart()
    await app.click('dc-button', '볼트 열기')
    await app.pickFolder(work.vault)
    await app.type('패스프레이즈', PASSPHRASE)
    await app.click('dc-button', '열기')
    await app.vaultOpen()
    await app.click('li button', '가상 학생 1')
    await app.cdp.waitFor(`__e2e.all('tr[data-session]').length === 2`, 'both sessions back')
    assert.equal((await app.sessionRows())[1][2], '특별 › 학교폭력')
    await app.click('dc-button', '다시 읽기')
    await app.cdp.waitFor(`__e2e.all('tr[data-session]').length === 2`, 'the same sessions after reading the folder again')
    await app.noAlert()
  },

  async 'records a group session once and counts each person who took part'(app, work) {
    await app.type('대상자 이름', '가상 학생 2')
    await app.click('dc-button', '대상자 추가')
    await app.cdp.waitFor(`__e2e.all('li button').some((b) => b.textContent.trim() === '가상 학생 2')`, 'the second subject')

    await app.click('button', '집단')
    await app.type('집단 이름', '또래 집단')
    await app.click('dc-button', '집단 추가')
    await app.cdp.waitFor(`__e2e.all('[data-role=members] input[data-subject]').length === 2`, 'the members to pick from')
    await app.cdp.evaluate(`(() => { for (const box of __e2e.all('[data-role=members] input[data-subject]')) box.click(); return true })()`)
    await app.click('dc-button', '구성원 저장')
    await app.cdp.waitFor(`__e2e.all('input[data-subject]').filter((b) => b.checked).length === 4`, 'members saved, and offered as the attendees')

    await app.setDate('날짜', '2026-04-16')
    await app.choose('주제', 'relation-peer')
    await app.click('dc-button', '회기 기록')
    await app.cdp.waitFor(`__e2e.all('tr[data-session]').length === 1`, 'the group session')
    await app.noAlert()
    assert.deepEqual(await app.sessionRows(), [['2026-04-16', '또래관계', '가상 학생 1, 가상 학생 2', '상담자 가']])
    const groups = await readdir(join(work.vault, 'groups'))
    assert.equal(groups.length, 1, 'one group folder, apart from the subjects')
    assert.equal((await readdir(join(work.vault, 'groups', groups[0]))).length, 3, 'the group, its members, and the session')

    await app.click('button', '월 보고')
    await app.type('연도', '2026')
    await app.choose('월', '4')
    await app.click('dc-button', '산출')
    await app.cdp.waitFor(`__e2e.one('tr[data-group=total]')?.children[1].textContent.trim() === '3 (2명)'`, 'one more session, one more person')
    const row = await app.cdp.evaluate(`[...__e2e.one('tr[data-row=relation-peer]').children].map((c) => c.textContent.trim())`)
    assert.deepEqual(row.slice(1), ['2 (2명)', '2 (2명)'], 'the settled session and the group session; the first student counted once')
  },
  async 'asks a second device sharing the vault to name itself'(app, work) {
    // The same vault opened as another device: this app's device id is swapped between runs.
    const idFile = join(process.env.LOCALAPPDATA, 'com.iyulab.openquote-care.e2e', 'device-id')
    const own = await readFile(idFile, 'utf8')
    await app.quit()
    await writeFile(idFile, 'e2esecond')
    try {
      const next = await App.launch()
      app.child = next.child
      app.cdp = next.cdp
      await app.click('dc-button', '볼트 열기')
      await app.pickFolder(work.vault)
      await app.type('패스프레이즈', PASSPHRASE)
      await app.click('dc-button', '열기')
      await app.vaultOpen()
      await app.cdp.waitFor(`!!__e2e.one('[data-role=name-hint]')`, 'the hint to name this device')
      await app.click('[data-role=name-hint] dc-button', '이름 붙이기')
      const listed = await app.cdp.waitFor(`(() => { const l = __e2e.all('li[data-device]').map((li) => li.textContent.trim()); return l.length && l })()`, 'the named devices')
      assert.deepEqual(listed, ['상담실 PC'], 'the first device, by the name it gave itself')
      assert.equal(await app.cdp.evaluate(`!!__e2e.one('[data-role=name-hint]')`), false, 'no hint on the page where the name is given')
      await app.noAlert()
    } finally {
      await writeFile(idFile, own)
    }
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
