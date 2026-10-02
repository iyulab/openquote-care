// End-to-end scenarios against the real app window: WebView2 driven over CDP, files checked on disk.
//
//   npm run build:sidecar   builds the engine sidecar the app starts
//   npm run build:e2e       builds the debug app with the e2e config (debugging port 9224)
//   npm run test:e2e        runs every scenario against a fresh temporary folder
//                           (E2E_SCREENSHOTS=<dir> saves a picture of the window after each one)
//   npm run test:e2e -- --through <part of a name> --repeat <n>
//                           runs the scenarios up to the first whose name contains that text, n
//                           times over, each time in a fresh folder and window — for chasing a
//                           scenario that fails only sometimes. Scenarios build on each other, so
//                           one cannot run alone.
//
// The one seam: the folder picker is a native dialog, so the scenarios put the folder where the
// picker's result goes (the app element's `folder`). Everything after that is clicks and typing.

import { spawn } from 'node:child_process'
import { copyFile, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { App as KitApp, runScenarios } from '@iyulab/tauri-kit-dev/app'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const exe = join(root, 'target', 'debug', process.platform === 'win32' ? 'openquote-care.exe' : 'openquote-care')
const sidecar = resolve(
  process.env.OPENQUOTE_SIDECAR_EXE ??
    join(root, 'sidecar', 'OpenquoteCare.Sidecar', 'bin', 'Release', 'net10.0', process.platform === 'win32' ? 'openquote-care-sidecar.exe' : 'openquote-care-sidecar'),
)
const PORT = 9224
const PASSPHRASE = '상담 기록 폴더 2026'
const NEW_PASSPHRASE = '새 기록 암호 2026'
// What a settled session says: a suggestion learns from it, and it never leaves the vault.
const FAMILY_NOTE = '합성 상담 내용: 휴대전화 문제로 부모님과 다툼'

const q = (s) => JSON.stringify(s)

// The scenarios find elements by their Korean names, so the app speaks Korean whatever the machine's language.
const appEnv = (env = {}) => ({ ...process.env, OPENQUOTE_SIDECAR_EXE: sidecar, OPENQUOTE_UI_LOCALE: 'ko', ...env })

/**
 * The app's window, driven the way a person uses it: the kit starts it, puts the in-page helpers
 * (`__e2e`) in and clicks; what is this app's own — its fields found by their Korean names, the
 * folder picker's stand-in, the open vault — is here.
 */
class App {
  /** @type {KitApp | undefined} */
  kit

  /** Starts the app, with `env` added to its environment, and waits for its window. */
  static async launch(env = {}) {
    const app = new App()
    app.kit = await KitApp.launch({
      exe,
      port: PORT,
      env: { OPENQUOTE_SIDECAR_EXE: sidecar, OPENQUOTE_UI_LOCALE: 'ko', ...env },
      // The e2e build's window configuration opens the debugging port itself.
      debugPortFromEnv: false,
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

  /** Waits for the open vault; an alert shown instead (the engine did not start, say) fails at once, naming it. */
  async vaultOpen() {
    const outcome = await this.cdp.waitFor(
      `__e2e.one('oc-vault') ? 'open' : __e2e.all('[role=alert]').map((el) => el.textContent.trim()).filter(Boolean).join(' / ')`,
      'the open vault',
      { timeoutMs: 60_000 },
    )
    if (outcome !== 'open') throw new Error(`the vault did not open: ${outcome}`)
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

const scenarios = {
  async 'says on the first screen when this installation reports errors'(app) {
    // A collector nothing listens on: the notice depends on the configuration, not on delivery.
    await app.restart({ OPENQUOTE_DIAGNOSTICS_CONNECTION: 'InstrumentationKey=00000000-0000-0000-0000-000000000000;IngestionEndpoint=https://127.0.0.1:9/' })
    await app.cdp.waitFor(`!!__e2e.one('[data-role="diagnostics"]')`, 'the diagnostics notice')
    // An error the window's code did not catch is written down as its type, never its message.
    await app.cdp.evaluate(`(setTimeout(() => { throw new TypeError('가상 학생 1') }), true)`)
    await app.click('dc-button', '보내는 내용 보기')
    await app.cdp.waitFor(`!!__e2e.one('[data-role="reports"]')`, 'the reports screen')
    const lines = await app.cdp.waitFor(
      `(() => { const pre = __e2e.one('[data-role="report-lines"]'); return pre && pre.textContent.includes('"webview"') ? pre.textContent : false })()`,
      'the window error among the reports',
    )
    const report = lines.trim().split('\n').map((l) => JSON.parse(l)).find((r) => r.layer === 'webview')
    assert.equal(report.kind, 'TypeError')
    assert.doesNotMatch(lines, /가상/, 'the message stays out of the report')
    // Turned off, it stays off on the next launch, and the first screen says so.
    await app.click('dc-button', '보내지 않기')
    await app.cdp.waitFor(`__e2e.all('dc-button').some((b) => b.textContent.trim() === '다시 보내기')`, 'the switch to send again')
    await app.restart({ OPENQUOTE_DIAGNOSTICS_CONNECTION: 'InstrumentationKey=00000000-0000-0000-0000-000000000000;IngestionEndpoint=https://127.0.0.1:9/' })
    await app.cdp.waitFor(`(__e2e.one('[data-role="diagnostics"]')?.textContent ?? '').includes('꺼 두었습니다')`, 'the notice that reports are off')
    await app.click('dc-button', '보내는 내용 보기')
    await app.click('dc-button', '다시 보내기')
    await app.cdp.waitFor(`__e2e.all('dc-button').some((b) => b.textContent.trim() === '보내지 않기')`, 'reports on again')
    await app.restart()
    await app.heading('Openquote Care')
    assert.equal(await app.cdp.evaluate(`!!__e2e.one('[data-role="diagnostics"]')`), false, 'no notice without a collector')
  },

  async 'speaks English when the system language has no table of its own'(app) {
    await app.restart({ OPENQUOTE_UI_LOCALE: 'fr-FR' })
    await app.heading('Openquote Care')
    assert.equal(await app.cdp.evaluate(`document.documentElement.lang`), 'en')
    // Every text node and every name a screen reader or tooltip gives, shadow roots included.
    const words = await app.cdp.evaluate(`__e2e.all('*').flatMap((el) => [
      ...[...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent),
      ...['aria-label', 'title', 'placeholder', 'label'].map((a) => el.getAttribute(a) ?? ''),
    ]).join(' ')`)
    assert.match(words, /Create a vault/)
    assert.doesNotMatch(words, /[가-힣]/, 'no Korean on the first screen')
    await app.restart()
    await app.heading('Openquote Care')
    await app.cdp.waitFor(`!!__e2e.one('dc-button', '새 기록 폴더 만들기')`, 'the Korean first screen again')
  },

  async 'leaves nothing behind when the app ends at the recovery kit'(app, work) {
    await app.click('dc-button', '새 기록 폴더 만들기')
    await app.pickFolder(work.vault)
    await app.type('암호', PASSPHRASE)
    await app.type('암호 다시 입력', PASSPHRASE)
    await app.click('dc-button', '만들기')
    await app.heading('복구 키트')
    await app.restart()
    assert.deepEqual(await readdir(work.vault), [], 'no vault to open without its kit')
    await app.heading('Openquote Care')
  },

  async 'refuses a short passphrase before touching the disk'(app, work) {
    await app.click('dc-button', '새 기록 폴더 만들기')
    await app.heading('새 기록 폴더 만들기')
    await app.pickFolder(work.vault)
    await app.type('암호', 'short')
    await app.type('암호 다시 입력', 'short')
    await app.click('dc-button', '만들기')
    await app.alert('암호는 8자 이상이어야 합니다.')
    assert.deepEqual(await readdir(work.vault), [], 'nothing written')
  },

  async 'creates a vault and shows its recovery kit'(app, work) {
    await app.type('암호', PASSPHRASE)
    await app.type('암호 다시 입력', PASSPHRASE)
    await app.choose('분야와 지역', 'school-kr')
    await app.click('dc-button', '만들기')
    await app.heading('복구 키트')
    const shown = await app.cdp.evaluate(`__e2e.one('[data-role=key]').textContent`)
    work.key = shown.replaceAll(/\s+/g, '')
    assert.equal(shown.trim().split(/\s+/).at(-1), work.key.slice(-6), 'the last group is what gets typed back')
    assert.match(work.key, /^AGE-SECRET-KEY-1[0-9A-Z]{58}$/, 'the whole key, in groups')
    assert.deepEqual(await readdir(work.vault), [], 'nothing written before the kit is confirmed')
    assert.match(await app.cdp.evaluate(`__e2e.one('[data-role=kit-backup]').textContent`), /백업 위치/, 'a space on the kit to write the backup folder in')
    await app.noAlert()
  },

  async 'keeps the vault locked until the end of the key is typed back'(app, work) {
    await app.type('보관했는지 확인: 복구 키의 마지막 묶음(6자)을 입력하세요', 'ZZZZZZ')
    await app.click('dc-button', '확인')
    await app.alert('복구 키의 마지막 글자와 다릅니다. 다시 확인하세요.')
    await app.heading('복구 키트')

    await app.type('보관했는지 확인: 복구 키의 마지막 묶음(6자)을 입력하세요', work.key.slice(-6).toLowerCase())
    await app.click('dc-button', '확인')
    await app.vaultOpen()
    await app.noAlert()
    assert.ok((await readdir(work.vault)).length > 0, 'the vault is on disk once confirmed')
    assert.deepEqual((await readdir(join(work.vault, 'packs'))).sort(), ['care', 'care.school', 'care.school.kr', 'kr'], 'the school track and what it builds on')
    const keyStillShown = await app.cdp.evaluate(`__e2e.all('*').some((el) => el.textContent?.includes(${q(work.key.slice(16, 28))}))`)
    assert.equal(keyStillShown, false, 'the key is gone from the window')
  },

  async 'closes the vault and refuses the wrong passphrase'(app, work) {
    await app.click('dc-button', '기록 폴더 닫기')
    await app.heading('Openquote Care')
    await app.click('dc-button', '기록 폴더 열기')
    await app.heading('기록 폴더 열기')
    await app.pickFolder(work.vault)
    await app.type('암호', 'not the passphrase')
    await app.click('dc-button', '열기')
    await app.alert('암호가 맞지 않습니다. 다른 기기에서 바꿨다면 새 암호를 입력하세요.')
  },

  async 'opens the vault with the recovery key when the passphrase is forgotten, and sets a new one'(app, work) {
    await app.click('dc-button', '암호를 잊었나요? 복구 키 입력')
    await app.type('복구 키', 'AGE-SECRET-KEY-1NOTTHEKEY')
    await app.click('dc-button', '열기')
    await app.alert('복구 키가 맞지 않습니다.')
    // Typed off the printed kit: in its groups, in lower case.
    await app.type('복구 키', work.key.match(/.{1,6}/g).join(' ').toLowerCase())
    await app.click('dc-button', '열기')
    await app.vaultOpen()
    await app.noAlert()

    // Opened with the kit, the window offers a new passphrase; the new one replaces the old.
    await app.cdp.waitFor(`!!__e2e.one('[data-role=key-hint]')`, 'the offer of a new passphrase')
    await app.click('dc-button', '새 암호 정하기')
    await app.type('새 암호', NEW_PASSPHRASE)
    await app.type('새 암호 다시 입력', NEW_PASSPHRASE + '!')
    await app.click('dc-button', '암호 바꾸기')
    await app.alert('두 암호가 다릅니다.')
    await app.type('새 암호 다시 입력', NEW_PASSPHRASE)
    await app.click('dc-button', '암호 바꾸기')
    await app.cdp.waitFor(`!!__e2e.one('[data-role=passphrase-changed]')`, 'the passphrase changed')
    assert.equal(await app.cdp.evaluate(`!!__e2e.one('[data-role=key-hint]')`), false, 'the offer is gone once taken')

    const reopen = async (passphrase) => {
      await app.click('dc-button', '기록 폴더 닫기')
      await app.heading('Openquote Care')
      await app.click('dc-button', '기록 폴더 열기')
      await app.heading('기록 폴더 열기')
      assert.equal(await app.cdp.evaluate(`!!__e2e.one('input[aria-label="암호"]')`), true, 'the passphrase is asked again by default')
      await app.pickFolder(work.vault)
      if (!passphrase) return
      await app.type('암호', passphrase)
      await app.click('dc-button', '열기')
    }
    await reopen(PASSPHRASE)
    await app.alert('암호가 맞지 않습니다. 다른 기기에서 바꿨다면 새 암호를 입력하세요.')
    await app.type('암호', NEW_PASSPHRASE)
    await app.click('dc-button', '열기')
    await app.vaultOpen()
    await app.noAlert()

    // Changed back while open with a passphrase, for the scenarios that follow.
    await app.click('button', '기기')
    await app.click('button', '암호')
    await app.type('새 암호', PASSPHRASE)
    await app.type('새 암호 다시 입력', PASSPHRASE)
    await app.click('dc-button', '암호 바꾸기')
    await app.cdp.waitFor(`!!__e2e.one('[data-role=passphrase-changed]')`, 'the passphrase changed back')
    await reopen()
  },

  async 'opens the vault again with its passphrase'(app, work) {
    await app.type('암호', PASSPHRASE)
    await app.click('dc-button', '열기')
    await app.vaultOpen()
    await app.noAlert()
  },

  async 'asks for a practitioner before a session can be recorded'(app) {
    await app.click('dc-button', '＋ 새 대상자')
    await app.type('대상자 이름', '가상 학생 1')
    await app.click('dc-button', '대상자 추가')
    await app.cdp.waitFor(`__e2e.all('p').some((p) => p.textContent.includes('담당자를 먼저 추가하세요'))`, 'the practitioner hint')
    await app.click('button', '담당자')
    await app.click('dc-button', '＋ 새 담당자')
    await app.type('담당자 이름', '상담자 가')
    await app.click('dc-button', '담당자 추가')
    await app.cdp.waitFor(`__e2e.all('li').some((li) => li.querySelector('.label')?.textContent.trim() === '상담자 가')`, 'the practitioner listed')
    await app.noAlert()
  },

  async 'records sessions under a subject, newest first'(app, work) {
    await app.click('button', '대상자')
    await app.click('li button .label', '가상 학생 1')
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
    const group = (name) => app.cdp.evaluate(`(() => { const m = __e2e.one('dc-metric[data-group=${name}]'); return m ? (m.value + (m.querySelector('[data-role=people]')?.textContent ?? '')).trim() : null })()`)
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
    await app.cdp.waitFor(`__e2e.all('[role=status]').some((el) => el.textContent.includes('분류 대응표 topic 1판→2판'))`, 'the revision applied')
    await app.noAlert()
    assert.equal(await app.cdp.evaluate(`__e2e.one('nav[aria-label="보고 양식"] button[aria-current=true]').dataset.entry`), 'monthly-topic@2', 'the new form is picked')
    assert.ok(await app.cdp.evaluate(`__e2e.all('[role=status]').some((el) => el.textContent.includes('새 분류 판에 맞춘 양식이 없습니다'))`),
      'the pack brought no export form for topic v2: the list form left behind is named')
    assert.equal(await app.cdp.evaluate(`__e2e.all('[role=status]').some((el) => el.textContent.includes('대응표가 없는 분류'))`), false,
      'topic v2 came with its v1→v2 crosswalk: no scheme is left unlinked')
    assert.equal(await app.cdp.evaluate(`!!__e2e.one('[data-form-behind]')`), false, 'the chosen report form is in the latest version')

    await app.click('dc-button', '산출')
    await app.cdp.waitFor(`!!__e2e.one('tr[data-row=relation-peer]')`, 'the report in v2')
    const row = (code) => app.cdp.evaluate(`[...__e2e.one('tr[data-row=${code}]').children].map((c) => c.textContent.trim())`)
    assert.deepEqual((await row('academic')).slice(1), ['1 (1명)', '1 (1명)'], 'the 1:1 category carried over to its new code')
    assert.deepEqual((await row('relation-peer')).slice(1), ['0', '0'], 'the split category is not guessed')
    const group = (name) => app.cdp.evaluate(`(() => { const m = __e2e.one('dc-metric[data-group=${name}]'); return m ? (m.value + (m.querySelector('[data-role=people]')?.textContent ?? '')).trim() : null })()`)
    assert.deepEqual([await group('pending'), await group('unmapped'), await group('total')], ['1 (1명)', '0', '2 (1명)'])

    await app.cdp.evaluate(`__e2e.one('oc-vault').applyPack(${q(pack)}).then(() => true)`)
    await app.cdp.waitFor(`__e2e.all('[role=status]').some((el) => el.textContent.includes('새 분류·양식이 없습니다'))`, 'nothing new the second time')
    assert.deepEqual((await readdir(join(work.vault, 'schemes', 'topic'))).sort(), ['v1-v2.json.age', 'v1.json.age', 'v2.json.age'])
  },

  async 'lets a person settle the split category, and the report counts it there'(app, work) {
    await app.cdp.evaluate(`(() => { __e2e.one('dc-metric[data-group=pending] button.cell').click(); return true })()`)
    await app.cdp.waitFor(`__e2e.all('tr[data-pending]').length === 1`, 'the pending session')
    const offered = await app.cdp.evaluate(`__e2e.all('tr[data-pending] dc-button').map((b) => b.textContent.trim())`)
    assert.deepEqual(offered, ['또래관계', '교사관계'], 'only the codes the crosswalk allows')
    await app.click('dc-button', '또래관계')
    await app.cdp.waitFor(`__e2e.one('tr[data-pending]').textContent.includes('확정')`, 'the choice recorded')
    await app.noAlert()

    await app.click('dc-button', '산출')
    await app.cdp.waitFor(`(() => { const m = __e2e.one('dc-metric[data-group=pending]'); return m && (m.value + (m.querySelector('[data-role=people]')?.textContent ?? '')).trim() === '0' })()`, 'nothing pending')
    const row = (code) => app.cdp.evaluate(`[...__e2e.one('tr[data-row=${code}]').children].map((c) => c.textContent.trim())`)
    assert.deepEqual((await row('relation-peer')).slice(1), ['1 (1명)', '1 (1명)'])
    assert.equal(await app.cdp.evaluate(`(() => { const m = __e2e.one('dc-metric[data-group=total]'); return (m.value + (m.querySelector('[data-role=people]')?.textContent ?? '')).trim() })()`), '2 (1명)', 'the total did not move')
    assert.equal(await app.cdp.evaluate(`__e2e.all('[role=status]').length`), 0, 'the "produce again" hint is gone once produced')
    const subjects = await readdir(join(work.vault, 'subjects'))
    assert.equal((await readdir(join(work.vault, 'subjects', subjects[0]))).length, 4, 'the choice is a new file; the session file is untouched')
  },

  async 'explains how this report differs from the one before it'(app) {
    const offered = await app.cdp.evaluate(`[...__e2e.one('select[aria-label="이전 산출과 비교"]').options].map((o) => o.textContent.trim())`)
    assert.equal(offered.length, 2, 'the two earlier runs of April (v1, v2) and none of other periods or this one')
    assert.match(offered[0], / · 2판 · 전체 2$/, 'the most recent earlier run first')
    assert.match(offered[1], / · 1판 · 전체 2$/)
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
    const second = spawn(exe, [], { stdio: 'ignore', env: appEnv() })
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
    await app.click('button', '이 기기 이름')
    await app.cdp.waitFor(`__e2e.all('p').some((p) => p.textContent.includes('아직 이름이 붙은 기기가 없습니다'))`, 'no device named yet')
    await app.type('이 기기 이름', '상담실 PC')
    await app.click('dc-button', '저장')
    await app.cdp.waitFor(`__e2e.all('li[data-device]').some((li) => li.textContent.trim() === '이 기기(상담실 PC)')`, 'this device named')
    await app.noAlert()
    const devices = await readdir(join(work.vault, 'devices'))
    assert.equal(devices.length, 1, 'the name is a change file in the vault, where every device reads it')
    assert.match(devices[0], /\.json\.age$/)
  },

  async 'keeps a backup of the vault in another folder, and says so on this computer'(app, work) {
    // The folder picker is the system's; the window's own method takes its answer.
    const copy = join(dirname(work.vault), 'backup')
    await mkdir(copy)
    await app.click('button', '기기')
    await app.click('button', '자동 백업')
    await app.cdp.evaluate(`__e2e.one('oc-vault').setBackup(${q(copy)}).then(() => true)`)
    await app.cdp.waitFor(`(__e2e.one('[data-role=backup-status]')?.textContent ?? '').startsWith('마지막 백업')`, 'the first backup')
    assert.match(await app.cdp.evaluate(`__e2e.one('[data-role=backup-write-down]').textContent`), /복구 키트/, 'says to write the backup folder on the kit')
    await app.noAlert()
    const files = async (root) => (await readdir(root, { recursive: true })).map((f) => f.replaceAll('\\', '/')).sort()
    const mark = 'openquote-care-backup.json'
    assert.ok((await files(copy)).includes(mark), 'the copy carries the mark that says it is a backup')
    assert.deepEqual((await files(copy)).filter((f) => f !== mark), await files(work.vault), 'the copy holds every file of the vault, as it is on disk')

    await app.cdp.evaluate(`__e2e.one('oc-vault').setBackup(${q(work.vault)}).then(() => true)`)
    await app.alert('백업 폴더는 기록 폴더 안이나, 기록 폴더를 품은 폴더일 수 없습니다. 떨어진 폴더를 고르세요.')
    assert.ok(await app.cdp.evaluate(`__e2e.one('[data-role=backup-folder]').textContent.includes(${q(copy)})`), 'a refused folder leaves the backup as it was')

    await app.click('dc-button', '백업 끄기')
    await app.cdp.waitFor(`__e2e.one('[data-role=backup-status]')?.textContent.trim() === '사용하지 않습니다.'`, 'the backup stopped')
    await app.noAlert()
    await rm(copy, { recursive: true, force: true })
  },

  async 'names what the vault lost by its backup, and brings back a record file that went missing'(app, work) {
    const copy = join(dirname(work.vault), 'backup-restore')
    await mkdir(copy)
    await app.click('button', '자동 백업')
    await app.cdp.evaluate(`__e2e.one('oc-vault').setBackup(${q(copy)}).then(() => true)`)
    await app.cdp.waitFor(`(__e2e.one('[data-role=backup-status]')?.textContent ?? '').startsWith('마지막 백업')`, 'the first backup')

    // A sync client takes one record file away and cuts another short; the window notices by itself.
    const subjects = join(work.vault, 'subjects')
    const folder = join(subjects, (await readdir(subjects))[0])
    const [gone, cut] = (await readdir(folder)).filter((f) => f.endsWith('.json.age')).sort().slice(-2).map((f) => join(folder, f))
    const [goneBytes, cutBytes] = [await readFile(gone), await readFile(cut)]
    await rm(gone)
    await writeFile(cut, cutBytes.subarray(0, cutBytes.length >> 1))
    await app.cdp.waitFor(`!!__e2e.one('[data-role=backup-missing]') && !!__e2e.one('[data-role=backup-damaged]')`, 'the lost and the damaged file named')
    assert.match(await app.cdp.evaluate(`__e2e.one('[data-role=backup-missing]').textContent`), /없어진 기록 파일이 1개/)
    assert.match(await app.cdp.evaluate(`__e2e.one('[data-role=backup-damaged]').textContent`), /손상되어 읽을 수 없습니다.*백업 폴더를 지우거나 다른 폴더로 바꾸지 마세요/)
    assert.equal(await app.cdp.evaluate(`!!__e2e.one('[data-role=backup-unresolved]')`), false, 'which copy is sound is told')

    await app.click('dc-button', '백업에서 되살리기')
    await app.cdp.waitFor(`!__e2e.one('[data-role=backup-missing]')`, 'the lost file restored')
    await app.noAlert()
    assert.equal(await app.cdp.evaluate(`__e2e.one('[role=status]')?.textContent.trim()`), '기록 파일 1개를 백업에서 되살렸습니다.')
    assert.deepEqual(await readFile(gone), goneBytes, 'the file once written, byte for byte')
    assert.deepEqual(await readFile(cut), cutBytes.subarray(0, cutBytes.length >> 1), 'a damaged record file is not replaced')
    assert.ok(await app.cdp.evaluate(`!!__e2e.one('[data-role=backup-damaged]')`), 'and is still named')

    // The person has the backup's sound copy take the damaged file's place, after saying yes.
    await app.click('dc-button', '백업의 성한 사본으로 바꾸기')
    assert.match(await app.cdp.evaluate(`__e2e.one('[data-role=backup-replace-confirm]').textContent`), /지우지 않고 기록 폴더 안 「damaged」 폴더에 보관한 뒤/)
    assert.deepEqual(await readFile(cut), cutBytes.subarray(0, cutBytes.length >> 1), 'nothing changes before the person says yes')
    await app.click('dc-button', '바꾸기')
    await app.cdp.waitFor(`!__e2e.one('[data-role=backup-damaged]')`, 'the damaged file replaced')
    await app.noAlert()
    assert.match(await app.cdp.evaluate(`__e2e.one('[role=status]')?.textContent.trim()`), /손상된 기록 파일 1개를 백업의 사본으로 바꿨습니다/)
    assert.deepEqual(await readFile(cut), cutBytes, 'the file once written, byte for byte')
    await app.cdp.waitFor(`!__e2e.one('[data-role=unreadable]')`, 'nothing left unreadable')
    await app.click('dc-button', '백업 끄기')
    await app.cdp.waitFor(`__e2e.one('[data-role=backup-status]')?.textContent.trim() === '사용하지 않습니다.'`, 'the backup stopped')
    await rm(copy, { recursive: true, force: true })
  },

  async 'takes in what another program writes to the vault folder, without being asked'(app, work) {
    // A file arriving from outside (here: a copy under a name its content does not match, so the
    // engine reports it as unreadable) shows up with no refresh button and no window focus.
    const subjects = join(work.vault, 'subjects')
    const folder = join(subjects, (await readdir(subjects))[0])
    const source = (await readdir(folder)).find((f) => f.endsWith('.json.age'))
    const stray = join(folder, '01900000-0000-7000-8000-000000000001.pc99.json.age')
    await copyFile(join(folder, source), stray)
    const listed = (reason) => `__e2e.all('[data-role=unreadable] li[data-reason=${reason}]').length === 1`
    const gone = `!__e2e.one('[data-role=unreadable]')`
    await app.cdp.waitFor(listed('NameMismatch'), 'the outside file noticed, with its reason')
    assert.match(await app.cdp.evaluate(`__e2e.one('[data-role=unreadable] summary').textContent`), /읽지 못한 파일 1개/)
    const what = () => app.cdp.evaluate(`__e2e.one('[data-role=unreadable] [data-role=what]')?.textContent`)
    assert.match(await what(), /^대상자 가상 학생 \d의 기록$/, 'named by the subject it belongs to, not by its folder id')
    await rm(stray)
    await app.cdp.waitFor(gone, 'its removal noticed')

    // A sync client's copy of a scheme (the losing side of a conflict) is shown, not dropped.
    const schemes = join(work.vault, 'schemes', 'topic')
    const conflicted = join(schemes, 'v1.json (conflicted copy 2026-04-02).age')
    await copyFile(join(schemes, 'v1.json.age'), conflicted)
    await app.cdp.waitFor(listed('NameMismatch'), 'the conflicted copy noticed')
    assert.match(await app.cdp.evaluate(`__e2e.one('[data-role=unreadable] li').textContent`), /충돌 사본/)
    assert.equal(await what(), '분류 topic 1판')
    await rm(conflicted)
    await app.cdp.waitFor(gone, 'its removal noticed')

    // A record file cut off while syncing cannot be decrypted: it is listed, not dropped.
    const cut = join(folder, '01900000-0000-7000-8000-00000000abcd.pc99.json.age')
    await writeFile(cut, 'age-encryption.org/v1\n')
    await app.cdp.waitFor(listed('Undecryptable'), 'the undecryptable file noticed')
    assert.match(await what(), /^대상자 가상 학생 \d의 기록$/)
    await rm(cut)
    await app.cdp.waitFor(gone, 'its removal noticed')
    await app.noAlert()
  },

  async 'keeps the sessions across a restart'(app, work) {
    await app.restart()
    await app.click('dc-button', '기록 폴더 열기')
    await app.pickFolder(work.vault)
    await app.type('암호', PASSPHRASE)
    await app.click('dc-button', '열기')
    await app.vaultOpen()
    await app.click('li button .label', '가상 학생 1')
    await app.cdp.waitFor(`__e2e.all('tr[data-session]').length === 2`, 'both sessions back')
    assert.equal((await app.sessionRows())[1][2], '특별 › 학교폭력')
    await app.click('dc-button', '다시 읽기')
    await app.cdp.waitFor(`__e2e.all('tr[data-session]').length === 2`, 'the same sessions after reading the folder again')

    // A sync client's copy of every record file, under the names sync clients give one, is the
    // same record again: read, not listed as unreadable and not counted twice.
    const subjects = join(work.vault, 'subjects')
    const copies = []
    for (const folder of await readdir(subjects)) {
      for (const file of (await readdir(join(subjects, folder))).filter((f) => f.endsWith('.json.age'))) {
        const name = file.slice(0, -'.age'.length)
        for (const copy of [`${name} (conflicted copy 2026-04-02).age`, `${name}-LAPTOP.age`]) {
          copies.push(join(subjects, folder, copy))
          await copyFile(join(subjects, folder, file), copies.at(-1))
        }
      }
    }
    await app.cdp.evaluate(`__e2e.one('oc-vault').refresh().then(() => true)`)
    assert.equal(await app.cdp.evaluate(`__e2e.all('tr[data-session]').length`), 2, 'still two sessions')
    assert.equal(await app.cdp.evaluate(`!!__e2e.one('[data-role=unreadable]')`), false, 'no copy listed as unreadable')
    for (const copy of copies) await rm(copy)
    await app.noAlert()
  },

  async 'locks on request, forgetting the key until the passphrase is typed again'(app, work) {
    await app.click('dc-button', '지금 잠그기')
    await app.cdp.waitFor(`!!__e2e.one('[data-role=locked]')`, 'the locked screen')
    assert.equal(await app.cdp.evaluate(`!!__e2e.one('oc-vault')`), false, 'no record is on screen')
    assert.ok(await app.cdp.evaluate(`__e2e.all('.folder').some((el) => el.textContent.includes(${q(work.vault)}))`), 'the same folder, ready to open')
    await app.type('암호', PASSPHRASE)
    await app.click('dc-button', '열기')
    await app.vaultOpen()
    await app.noAlert()
  },
  async 'records a group session once and counts each person who took part'(app, work) {
    await app.click('dc-button', '＋ 새 대상자')
    await app.type('대상자 이름', '가상 학생 2')
    await app.click('dc-button', '대상자 추가')
    await app.cdp.waitFor(`__e2e.all('li button').some((b) => b.querySelector('.label')?.textContent.trim() === '가상 학생 2')`, 'the second subject')

    await app.click('button', '집단')
    await app.click('dc-button', '＋ 새 집단')
    await app.type('집단 이름', '또래 집단')
    await app.click('dc-button', '집단 추가')
    await app.cdp.waitFor(`__e2e.all('[data-role=members] dc-checkbox[data-subject]').length === 2`, 'the members to pick from')
    await app.cdp.evaluate(`(() => { for (const box of __e2e.all('[data-role=members] dc-checkbox[data-subject]')) box.click(); return true })()`)
    await app.click('dc-button', '구성원 저장')
    await app.cdp.waitFor(`__e2e.all('dc-checkbox[data-subject]').filter((b) => b.checked).length === 4`, 'members saved, and offered as the attendees')

    await app.setDate('날짜', '2026-04-16')
    await app.choose('주제', 'relation-peer')
    await app.click('dc-button', '회기 기록')
    await app.cdp.waitFor(`__e2e.all('tr[data-session]').length === 1`, 'the group session')
    await app.noAlert()
    assert.deepEqual(await app.sessionRows(), [['2026-04-16', '또래관계', '', '가상 학생 1, 가상 학생 2', '상담자 가']])
    const groups = await readdir(join(work.vault, 'groups'))
    assert.equal(groups.length, 1, 'one group folder, apart from the subjects')
    assert.equal((await readdir(join(work.vault, 'groups', groups[0]))).length, 3, 'the group, its members, and the session')

    await app.click('button', '월 보고')
    await app.type('연도', '2026')
    await app.choose('월', '4')
    await app.click('dc-button', '산출')
    await app.cdp.waitFor(`(() => { const m = __e2e.one('dc-metric[data-group=total]'); return m && (m.value + (m.querySelector('[data-role=people]')?.textContent ?? '')).trim() === '3 (2명)' })()`, 'one more session, one more person')
    const row = await app.cdp.evaluate(`[...__e2e.one('tr[data-row=relation-peer]').children].map((c) => c.textContent.trim())`)
    assert.deepEqual(row.slice(1), ['2 (2명)', '2 (2명)'], 'the settled session and the group session; the first student counted once')
  },
  async 'adds and updates subjects from rows pasted out of a spreadsheet'(app) {
    await app.click('button', '대상자')
    await app.click('dc-button', '＋ 새 대상자')
    const paste = ['이름\t학년\t반', '가상 학생 1\t2\t3', '가상 학생 3\t1\t4', ''].join('\n')
    await app.cdp.evaluate(`(() => {
      const zone = __e2e.one('dc-paste-rows-zone').shadowRoot.querySelector('textarea')
      const data = new DataTransfer(); data.setData('text/plain', ${q(paste)})
      zone.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }))
      return true })()`)
    await app.cdp.waitFor(`!!__e2e.one('[data-role=import-tally]')`, 'the pasted rows planned')
    assert.equal(await app.cdp.evaluate(`__e2e.one('[data-role=import-tally]').textContent.trim()`), '추가 1 · 갱신 1 · 그대로 0 · 문제 0')
    await app.click('dc-button', '가져오기 (추가 1 · 갱신 1)')
    await app.cdp.waitFor(`__e2e.all('li button').some((b) => b.querySelector('.label')?.textContent.trim() === '가상 학생 3')`, 'the new subject listed')
    await app.noAlert()

    // A session keeps the grade and class of the day it was recorded.
    await app.click('li button .label', '가상 학생 3')
    await app.setDate('날짜', '2026-04-20')
    await app.choose('주제', 'family')
    await app.click('dc-button', '회기 기록')
    await app.cdp.waitFor(`__e2e.all('tr[data-session]').length === 1`, 'the session of the new subject')
    await app.noAlert()
  },
  async 'lays out the menu, a list to pick from and the document picked, and folds the menu to its icons'(app) {
    await app.click('button', '대상자')
    await app.click('li button .label', '가상 학생 3')
    // Three columns side by side: the menu, the list as wide as the menu, the document taking the rest.
    const widths = () =>
      app.cdp.evaluate(`(() => {
        const width = (el) => Math.round(el.getBoundingClientRect().width)
        const nav = __e2e.one('nav[aria-label="대상자"]')
        const doc = __e2e.one('oc-subjects').shadowRoot.querySelector('section.document')
        return { menu: width(__e2e.one('dp-sidebar')), list: width(nav.closest('dp-list-detail').shadowRoot.querySelector('.list')), document: width(doc) }
      })()`)
    const open = await widths()
    assert.equal(open.list, open.menu, 'the list is as wide as the menu')
    assert.ok(open.document > 2 * open.list, `the document takes the rest (${JSON.stringify(open)})`)
    assert.ok(await app.cdp.evaluate(`__e2e.all('h2').some((h) => h.textContent.includes('가상 학생 3'))`), 'the document is the one picked')

    await app.click('button[aria-label="메뉴 접기/펼치기"]')
    await app.cdp.waitFor(`__e2e.one('dp-sidebar').hasAttribute('collapsed')`, 'the menu folded to its icons')
    const folded = await widths()
    assert.ok(folded.menu < open.menu, 'the folded menu is narrower')
    assert.equal(folded.list, open.list, 'the list keeps its width')
    assert.ok(folded.document > open.document, 'the document takes the room given up')
    await app.click('button[aria-label="메뉴 접기/펼치기"]')
    await app.cdp.waitFor(`!__e2e.one('dp-sidebar').hasAttribute('collapsed')`, 'the menu unfolded')
    await app.noAlert()
  },
  async 'in a narrow window shows the list or the document picked, with a way back, and the menu as a drawer'(app) {
    await app.cdp.send('Emulation.setDeviceMetricsOverride', { width: 800, height: 700, deviceScaleFactor: 0, mobile: false })
    try {
      const shown = (js) => app.cdp.evaluate(`(() => { const el = ${js}; return !!el && el.getBoundingClientRect().width > 0 })()`)
      const list = `__e2e.one('nav[aria-label="대상자"]')`
      const doc = `__e2e.one('oc-subjects').shadowRoot.querySelector('section.document')`
      await app.cdp.waitFor(`!__e2e.one('dp-shell').hasAttribute('sidebar-open') && __e2e.one('dp-sidebar').getBoundingClientRect().width === 0`, 'the menu out of the way')

      await app.click('button[aria-label="메뉴 접기/펼치기"]')
      await app.cdp.waitFor(`__e2e.one('dp-shell').hasAttribute('sidebar-open')`, 'the menu as a drawer')
      assert.equal(await app.cdp.evaluate(`__e2e.one('dp-sidebar').hasAttribute('collapsed')`), false, 'a drawer shows the menu in full')
      await app.click('button', '대상자')
      await app.cdp.waitFor(`!__e2e.one('dp-shell').hasAttribute('sidebar-open')`, 'the drawer gives way to what was picked')

      // A document left open from the wide window shows alone now: back to the list first.
      if (await app.cdp.evaluate(`__e2e.one('nav[aria-label="대상자"]').closest('dp-list-detail').hasAttribute('detail-open')`)) await app.click('dc-button', '← 목록으로')
      await app.cdp.waitFor(`(() => { const el = ${list}; return !!el && el.getBoundingClientRect().width > 0 })()`, 'the list alone')
      assert.equal(await shown(doc), false, 'no document beside the list')
      await app.click('li button .label', '가상 학생 1')
      await app.cdp.waitFor(`(() => { const el = ${doc}; return !!el && el.getBoundingClientRect().width > 0 })()`, 'the document alone')
      assert.equal(await shown(list), false, 'the list gives way to the document')
      assert.ok(await app.cdp.evaluate(`__e2e.all('h2').some((h) => h.textContent.includes('가상 학생 1'))`), 'the one picked')
      await app.click('dc-button', '← 목록으로')
      await app.cdp.waitFor(`(() => { const el = ${list}; return !!el && el.getBoundingClientRect().width > 0 })()`, 'back at the list')
    } finally {
      await app.cdp.send('Emulation.clearDeviceMetricsOverride')
    }
    await app.cdp.waitFor(`__e2e.one('dp-sidebar').getBoundingClientRect().width > 0`, 'the menu beside the content again')
    await app.noAlert()
  },
  async 'lists the sessions of a month in an export form, ready to paste'(app) {
    // The export form came with the vault, from the pack it was made with.
    await app.click('button', '기록 목록')
    await app.cdp.waitFor(`!!__e2e.one('nav[aria-label="목록 양식"] button[aria-current=true]')`, 'the export form offered, and picked')
    await app.type('연도', '2026')
    await app.choose('월', '4')
    await app.click('dc-button', '목록 만들기')
    await app.cdp.waitFor(`__e2e.all('tr[data-export-row]').length === 4`, 'four sessions listed')
    await app.noAlert()
    const rows = await app.cdp.evaluate(`__e2e.all('tr[data-export-row]').map((tr) => [...tr.children].map((td) => td.textContent.trim()))`)
    assert.deepEqual(rows.map((r) => [r[0], r[1], r[2], r[3], r[4], r[5]]), [
      ['2026-04-02', '2026', '가상 학생 1', '1', '', ''],
      ['2026-04-09', '2026', '가상 학생 1', '1', '', ''],
      ['2026-04-16', '2026', '가상 학생 1, 가상 학생 2', '2', '', ''],
      ['2026-04-20', '2026', '가상 학생 3', '1', '1', '4'],
    ], 'in date order, the group session once with both attendees, and the grade and class a session kept')
    assert.ok(await app.cdp.evaluate(`!!__e2e.one('[data-role=export-gaps]')`), 'the v1 form cannot place the reclassified sessions: said, not guessed')
    assert.match(await app.cdp.evaluate(`__e2e.one('[data-form-behind]')?.textContent ?? ''`), /1판 기준/, 'the form says which scheme version it lags')
    assert.equal(await app.cdp.evaluate(`!!__e2e.one('dc-button', '표 복사')`), true, 'the rows can be copied')
  },
  async 'records what was said in a session, and keeps it out of the list form'(app, work) {
    const said = '합성 상담 내용: 시험 불안을 이야기함'
    await app.click('button', '대상자')
    await app.click('li button .label', '가상 학생 3')
    await app.setDate('날짜', '2026-05-07')
    await app.choose('주제', 'relation-peer')
    await app.write('상담 내용', said)
    await app.click('dc-button', '회기 기록')
    await app.cdp.waitFor(`__e2e.all('tr[data-session]').some((tr) => tr.textContent.includes('2026-05-07'))`, 'the session listed')
    await app.noAlert()
    const row = await app.cdp.evaluate(`__e2e.all('tr[data-session]').find((tr) => tr.textContent.includes('2026-05-07')).textContent`)
    assert.ok(!row.includes(said), 'what was said is not a column')
    await app.click('button[data-role=note]')
    await app.cdp.waitFor(`__e2e.all('tr[data-note]').some((tr) => tr.textContent.includes(${q(said)}))`, 'what was said, opened under its row')

    await app.click('button', '기록 목록')
    await app.choose('월', '5')
    await app.click('dc-button', '목록 만들기')
    await app.cdp.waitFor(`__e2e.all('tr[data-export-row]').length === 1`, 'the May session listed')
    const listed = await app.cdp.evaluate(`__e2e.all('tr[data-export-row]').map((tr) => tr.textContent).join(' ')`)
    assert.ok(!listed.includes(said), 'the list form never carries what was said')
    for (const dir of await readdir(join(work.vault, 'subjects'))) {
      for (const f of await readdir(join(work.vault, 'subjects', dir))) {
        assert.ok(f.endsWith('.age'), 'every record encrypted')
        assert.ok(!(await readFile(join(work.vault, 'subjects', dir, f))).includes(Buffer.from(said)), 'nothing said is on disk in the clear')
      }
    }
  },

  async 'suggests a topic from the most similar settled session, and records that it was taken from the suggestion'(app) {
    await app.click('button', '대상자')
    await app.click('li button .label', '가상 학생 3')
    const settle = async (day, topic, said) => {
      await app.setDate('날짜', day)
      await app.choose('주제', topic)
      await app.write('상담 내용', said)
      await app.click('dc-button', '회기 기록')
      await app.cdp.waitFor(`__e2e.all('tr[data-session]').some((tr) => tr.textContent.includes(${q(day)}))`, `the session of ${day} listed`)
    }
    await settle('2026-05-12', 'family', FAMILY_NOTE)
    await settle('2026-05-14', 'academic', '합성 상담 내용: 성적이 떨어져 진로를 걱정함')

    await app.setDate('날짜', '2026-05-21')
    await app.write('상담 내용', '합성 상담 내용: 휴대전화 때문에 부모님과 또 다툼')
    await app.cdp.waitFor(`__e2e.all('[data-suggestions="topic"] dc-button[data-suggestion="family"]').length === 1`, 'the family topic suggested')
    assert.ok(
      !(await app.cdp.evaluate(`__e2e.all('[data-suggestions="topic"] dc-button').some((b) => ['suicide', 'self-harm', 'psychosis', 'crisis'].includes(b.dataset.suggestion))`)),
      'a topic the scheme keeps out of suggestions is never offered',
    )
    assert.equal(await app.cdp.evaluate(`__e2e.one('select[aria-label="주제"]').value`), '', 'nothing is filled in until a person takes it')

    await app.click('dc-button[data-role=why-suggested]')
    await app.cdp.waitFor(`(__e2e.one('[data-why="topic"]')?.textContent ?? '').includes('2026-05-12 가상 학생 3')`, 'the similar session, by its date and who it is about')
    assert.ok(!(await app.cdp.evaluate(`__e2e.one('[data-why="topic"]').textContent.includes('다툼')`)), 'what a similar session says is never shown')

    await app.click('dc-button[data-suggestion="family"]')
    await app.cdp.waitFor(`__e2e.one('select[aria-label="주제"]')?.value === 'family'`, 'the topic taken from the suggestion')
    await app.click('dc-button', '회기 기록')
    await app.cdp.waitFor(`__e2e.all('tr[data-session]').some((tr) => tr.textContent.includes('2026-05-21'))`, 'the session of 2026-05-21 listed')
    await app.noAlert()

    const changes = await app.cdp.evaluate(`window.__TAURI_INTERNALS__.invoke('history', { entityType: 'session' }).then((all) => all.flatMap((e) => e.changes))`)
    const taken = changes.find((c) => c.fields.date === '2026-05-21')
    assert.deepEqual(taken.source, { topic: 'suggestion' }, 'the session keeps that its topic came from a suggestion')
    assert.deepEqual(changes.find((c) => c.fields.date === '2026-05-12').source, {}, 'a topic a person picked is not marked')
  },

  async 'leaves a copy of every record that reads without the app, apart from the vault, content only when asked'(app, work) {
    const said = '합성 상담 내용: 시험 불안을 이야기함'
    await app.click('button', '기록 목록')
    await app.click('li button .label', '전체 기록 사본 (앱 없이 읽기)')
    await app.cdp.waitFor(`!!__e2e.one('[data-role=plain-copy-warning]')`, 'the warning that the copy has no passphrase')
    await app.cdp.waitFor(`__e2e.one('[data-role=plain-copy-last]')?.textContent.trim() === '이 컴퓨터에서 만든 사본이 없습니다.'`, 'no copy made yet')
    // The folder picker is the system's; the screen's own method takes its answer.
    const make = async (folder) => {
      await mkdir(folder)
      await app.cdp.evaluate(`__e2e.one('oc-export').makePlainCopy(${q(folder)}).then(() => true)`)
      await app.cdp.waitFor(`__e2e.all('[role=status]').some((el) => el.textContent.startsWith('사본을 만들었습니다'))`, 'the copy made')
      await app.noAlert()
      const [made, ...more] = await readdir(folder)
      assert.deepEqual(more, [], 'one new folder')
      assert.match(made, /^Openquote 기록 사본 \d{4}-\d\d-\d\d \d{4}$/)
      assert.deepEqual((await readdir(join(folder, made))).sort(), ['기록.html', '대상자.csv', '읽어보기.txt', '회기.csv'])
      return join(folder, made)
    }
    const plain = join(dirname(work.vault), 'plain')
    const copy = await make(plain)
    const page = await readFile(join(copy, '기록.html'), 'utf8')
    for (const name of ['가상 학생 1', '가상 학생 2', '가상 학생 3', '또래 집단', '상담자 가']) assert.ok(page.includes(name), name)
    assert.ok(!page.includes(said), 'session content stays out unless asked for')
    assert.ok(page.includes('<h3>고친 기록</h3>'), 'the edits made after a record was first written, such as the grade taken in from pasted rows')
    assert.ok((await readFile(join(copy, '회기.csv'), 'utf8')).startsWith('\uFEFF대상자,집단,'), 'a table a spreadsheet reads as UTF-8')
    assert.match((await readFile(join(copy, '읽어보기.txt'), 'utf8')).split('\r\n')[1], /^기록 폴더 「vault」 · .* · .*에서 만듦$/, 'the note says when and where the copy was made')
    await app.cdp.waitFor(`!!__e2e.one('[data-role=plain-copy-fresh]')`, 'nothing changed since the copy')
    assert.ok(await app.cdp.evaluate(`__e2e.one('[data-role=plain-copy-last]').textContent.includes(${q(copy)})`), 'the last copy, by where it went')

    await app.cdp.evaluate(`(() => { __e2e.one('[data-role=plain-copy-narrative]').click(); return true })()`)
    await app.cdp.waitFor(`__e2e.one('[data-role=plain-copy-narrative]').checked`, 'content asked for')
    const withContent = join(dirname(work.vault), 'plain-with-content')
    const second = await make(withContent)
    assert.ok((await readFile(join(second, '기록.html'), 'utf8')).includes(said), 'asked for, the content is in the page')
    assert.ok((await readFile(join(second, '회기.csv'), 'utf8')).includes(said), 'and in the table')

    await app.cdp.evaluate(`__e2e.one('oc-export').makePlainCopy(${q(work.vault)}).then(() => true)`)
    await app.alert('사본은 기록 폴더 안이나, 기록 폴더를 품은 폴더에 만들 수 없습니다. 떨어진 폴더를 고르세요.')
    assert.ok(!(await readdir(work.vault)).some((f) => f.startsWith('Openquote')), 'no plain file inside the vault')

    // A record changed after the copy: the screen says the copy no longer holds everything.
    await app.click('button', '대상자')
    await app.click('li button .label', '가상 학생 2')
    await app.click('dc-button', '대상자 정보 고치기')
    await app.type('반', '7')
    await app.click('dc-button', '고친 내용 저장')
    await app.cdp.waitFor(`!__e2e.one('[data-role=correct-subject]')`, 'the subject corrected')
    await app.click('button', '기록 목록')
    await app.click('li button .label', '전체 기록 사본 (앱 없이 읽기)')
    await app.cdp.waitFor(`__e2e.one('[data-role=plain-copy-stale]')?.textContent.startsWith('그 뒤 바뀐 기록이 1건 있어')`, 'the copy is behind by one change')
    assert.ok(await app.cdp.evaluate(`__e2e.one('[data-role=plain-copy-last]').textContent.includes('상담 내용 포함')`), 'the last copy held session content')
    await rm(plain, { recursive: true, force: true })
    await rm(withContent, { recursive: true, force: true })
  },
  async 'names a scheme version no crosswalk leads to when its pack is applied'(app, work) {
    // A relabel-only revision still needs a crosswalk; without one every earlier value is unmapped there.
    const pack = join(dirname(work.vault), 'relabel-pack')
    await mkdir(join(pack, 'schemes', 'method'), { recursive: true })
    await writeFile(join(pack, 'schemes', 'method', 'v2.json'),
      JSON.stringify({ format: 'openquote.scheme/0', scheme: 'method', version: 2, items: [{ code: 'interview', label: '개인 면담' }] }))
    await app.cdp.evaluate(`__e2e.one('oc-vault').applyPack(${q(pack)}).then(() => true)`)
    await app.cdp.waitFor(`__e2e.all('[role=status]').some((el) => el.textContent.includes('대응표가 없는 분류가 있습니다: 분류 method 2판'))`,
      'the unlinked version named')
    await app.noAlert()
  },

  async 'asks a second device sharing the vault to name itself'(app, work) {
    // The same vault opened as another device: this app's device id is swapped between runs.
    const idFile = join(process.env.LOCALAPPDATA, 'com.iyulab.openquote-care.e2e', 'device-id')
    const own = await readFile(idFile, 'utf8')
    await app.quit()
    await writeFile(idFile, 'e2esecond')
    try {
      app.kit = (await App.launch()).kit
      await app.click('dc-button', '기록 폴더 열기')
      await app.pickFolder(work.vault)
      await app.type('암호', PASSPHRASE)
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

  async 'shows a field two edits changed without seeing each other, until a person picks one'(app, work) {
    await app.click('button', '대상자')
    await app.click('li button .label', '가상 학생 1')
    await app.cdp.waitFor(`__e2e.all('tr[data-session]').length > 0`, 'the sessions')
    const id = await app.cdp.evaluate(`__e2e.one('tr[data-session]').dataset.session`)
    const date = (await app.sessionRows())[0][0].slice(0, 8) // the month of the first session, 'YYYY-MM-'
    // Two edits that did not see each other, made through the window's own commands: the first
    // is taken out of the folder while the second is made, as when a sync client delivers late.
    const edit = (day) => app.cdp.evaluate(`window.__TAURI_INTERNALS__.invoke('record', { route: '/changes/update',
      request: { type: 'session', id: ${q(id)}, fields: { date: ${q(date + day)} } } })`)
    const first = join(work.vault, ...(await edit('20')).split('/')) + '.age'
    const aside = join(work.empty, 'late.age')
    await copyFile(first, aside)
    await rm(first)
    await app.cdp.evaluate(`__e2e.one('oc-vault').refresh().then(() => true)`)
    await edit('21')
    await copyFile(aside, first)
    await rm(aside)
    await app.cdp.evaluate(`__e2e.one('oc-vault').refresh().then(() => true)`)

    await app.click('[data-role=conflict]')
    await app.cdp.waitFor(`!!__e2e.one('[data-role=settle]')`, 'the panel to settle it')
    const offered = await app.cdp.evaluate(`__e2e.all('[data-role=settle] dc-button').map((b) => b.textContent.trim().split(' · ')[0]).sort()`)
    assert.deepEqual(offered, [date + '20', date + '21'], 'both values, each from where it was made')
    const pick = await app.cdp.waitFor(`(() => { const b = __e2e.all('[data-role=settle] dc-button').find((b) => b.textContent.trim().startsWith(${q(offered[1])})); return b && __e2e.target(b) })()`, 'the value to pick')
    await app.cdp.clickAt(pick)
    await app.cdp.waitFor(`!__e2e.one('[data-role=conflict]') && !__e2e.one('[data-role=settle]')`, 'the field settled')
    assert.ok((await app.sessionRows()).some((row) => row[0] === date + '21'), 'the value the person picked')
    await app.noAlert()
  },

  async 'says a conflict may only be a change not yet synced, and it clears when that change arrives'(app, work) {
    await app.click('button', '대상자')
    await app.click('li button .label', '가상 학생 1')
    await app.cdp.waitFor(`__e2e.all('tr[data-session]').length > 0`, 'the sessions')
    const id = await app.cdp.evaluate(`__e2e.one('tr[data-session]').dataset.session`)
    const date = (await app.sessionRows())[0][0].slice(0, 8)
    const edit = (day) => app.cdp.evaluate(`window.__TAURI_INTERNALS__.invoke('record', { route: '/changes/update',
      request: { type: 'session', id: ${q(id)}, fields: { date: ${q(date + day)} } } })`)
    // Two edits in a row on one device; the first has not reached this one yet, so the second
    // cannot be seen to have seen what came before it.
    const middle = join(work.vault, ...(await edit('22')).split('/')) + '.age'
    await app.cdp.evaluate(`__e2e.one('oc-vault').refresh().then(() => true)`)
    await edit('23')
    const aside = join(work.empty, 'middle.age')
    await copyFile(middle, aside)
    await rm(middle)
    await app.cdp.evaluate(`__e2e.one('oc-vault').refresh().then(() => true)`)

    await app.click('[data-role=conflict]')
    await app.cdp.waitFor(`!!__e2e.one('[data-role=settle]')`, 'the panel to settle it')
    await app.cdp.waitFor(`!!__e2e.one('[data-role=missing-base]')`, 'the note that a change has not arrived yet')

    await copyFile(aside, middle)
    await rm(aside)
    await app.cdp.evaluate(`__e2e.one('oc-vault').refresh().then(() => true)`)
    await app.cdp.waitFor(`!__e2e.one('[data-role=conflict]') && !__e2e.one('[data-role=settle]')`, 'the conflict gone once the change arrived')
    assert.ok((await app.sessionRows()).some((row) => row[0] === date + '23'), 'the later edit is the value')
    await app.noAlert()
  },

  async 'keeps two sessions recorded on the same day as two'(app, work) {
    await app.click('button', '대상자')
    await app.click('li button .label', '가상 학생 1')
    const before = (await app.sessionRows()).length
    const recordFiles = async () => (await readdir(join(work.vault, 'subjects'), { recursive: true })).filter((f) => f.endsWith('.age')).length
    const filesBefore = await recordFiles()
    await app.setDate('날짜', '2026-06-15')
    await app.choose('주제', 'family')
    await app.click('dc-button', '회기 기록')
    await app.cdp.waitFor(`__e2e.all('tr[data-session]').length === ${before + 1}`, 'the first session of the day')
    await app.setDate('날짜', '2026-06-15')
    await app.choose('주제', 'relation-peer')
    await app.click('dc-button', '회기 기록')
    await app.cdp.waitFor(`__e2e.all('tr[data-session]').length === ${before + 2}`, 'the second session of the day')
    await app.noAlert()
    const sameDay = (await app.sessionRows()).filter((row) => row[0] === '2026-06-15').map((row) => row[1]).sort()
    assert.deepEqual(sameDay, ['가정', '또래관계'], 'both sessions of the day are shown, neither replacing the other')
    assert.equal(await recordFiles(), filesBefore + 2, 'one file for each session')
  },

  async 'corrects a saved session: only the changed field is written, and the session says it was corrected'(app, work) {
    const recordFiles = async () => (await readdir(join(work.vault, 'subjects'), { recursive: true })).filter((f) => f.endsWith('.age')).sort()
    const filesBefore = await recordFiles()
    const contentBefore = await Promise.all(filesBefore.map((f) => readFile(join(work.vault, 'subjects', f))))
    const row = `__e2e.all('tr[data-session]').find((tr) => tr.children[0].textContent.includes('2026-06-15') && tr.children[1].textContent.trim() === '가정')`
    const id = await app.cdp.evaluate(`${row}?.dataset.session`)
    assert.ok(id, 'the family session of 15 June')
    await app.cdp.evaluate(`${row}.querySelector('[data-role=correct]').click()`)
    await app.cdp.waitFor(`!!__e2e.one('[data-role=correct-session]')`, 'the correction form')
    assert.equal(await app.cdp.evaluate(`__e2e.all('input[aria-label="날짜"]')[0].value`), '2026-06-15', 'the form starts from what the session holds')

    await app.click('dc-button', '고친 내용 저장')
    const said = (text) => `__e2e.all('[role=status]').some((el) => el.textContent.trim() === ${q(text)})`
    await app.cdp.waitFor(said('바뀐 칸이 없습니다.'), 'nothing changed, nothing written', { timeoutMs: 5000 }).catch(async (e) => {
      throw new Error(`${e.message} — shown: ${await app.cdp.evaluate(`__e2e.all('[role=status], [role=alert]').map((el) => el.textContent.trim()).join(' / ')`)}`)
    })
    assert.deepEqual(await recordFiles(), filesBefore)

    await app.setDate('날짜', '2026-06-16')
    await app.click('dc-button', '고친 내용 저장')
    await app.cdp.waitFor(`!__e2e.one('[data-role=correct-session]') && ${said('회기를 고쳤습니다.')}`, 'the session corrected')
    await app.noAlert()
    const corrected = (await app.sessionRows()).filter((r) => r[1] === '가정' && r[0].startsWith('2026-06-1'))
    assert.deepEqual(corrected.map((r) => r[0]), ['2026-06-16'], 'the session shows its corrected date')
    assert.equal(await app.cdp.evaluate(`!!__e2e.one('tr[data-session="${id}"] [data-role=corrected]')`), true, 'and says it was corrected')

    const filesAfter = await recordFiles()
    assert.equal(filesAfter.length, filesBefore.length + 1, 'the correction is a file of its own')
    for (const [i, f] of filesBefore.entries()) assert.deepEqual(await readFile(join(work.vault, 'subjects', f)), contentBefore[i], `${f} is untouched`)
  },

  async 'corrects what the record of a subject holds, starting from it, as an edit of its own'(app, work) {
    const recordFiles = async () => (await readdir(join(work.vault, 'subjects'), { recursive: true })).filter((f) => f.endsWith('.age')).length
    const filesBefore = await recordFiles()
    await app.click('dc-button', '대상자 정보 고치기')
    await app.cdp.waitFor(`!!__e2e.one('[data-role=correct-subject]')`, 'the subject form')
    assert.equal(await app.cdp.evaluate(`__e2e.one('input[aria-label="이름"]').value`), '가상 학생 1', 'the form starts from the record')
    await app.type('학교', '가상 중학교')
    await app.click('dc-button', '고친 내용 저장')
    const said = (text) => `__e2e.all('[role=status]').some((el) => el.textContent.trim() === ${q(text)})`
    await app.cdp.waitFor(`!__e2e.one('[data-role=correct-subject]') && ${said('대상자 정보를 고쳤습니다.')}`, 'the subject corrected')
    await app.noAlert()
    assert.equal(await recordFiles(), filesBefore + 1, 'the correction is a file of its own')

    await app.click('dc-button', '대상자 정보 고치기')
    await app.cdp.waitFor(`__e2e.one('input[aria-label="학교"]')?.value === '가상 중학교'`, 'the record now holds it')
    await app.setDate('이름', '') // sets any input's value, a date's or not
    await app.click('dc-button', '고친 내용 저장')
    await app.alert('‘이름’ 칸을 채우세요.')
    await app.click('dc-button', '취소')
    await app.cdp.waitFor(`!__e2e.one('[data-role=correct-subject]')`, 'the form left')
    assert.equal(await recordFiles(), filesBefore + 1, 'an empty required field writes nothing')
  },

  async 'says the key file is damaged, opens with the recovery key, and a new passphrase mends it'(app, work) {
    await app.click('dc-button', '기록 폴더 닫기')
    const keyFile = join(work.vault, 'keys', 'vault-key.age')
    await writeFile(keyFile, '-----BEGIN AGE ENCRYPTED FILE-----\ncut off')
    await app.click('dc-button', '기록 폴더 열기')
    await app.pickFolder(work.vault)
    await app.type('암호', PASSPHRASE)
    await app.click('dc-button', '열기')
    await app.alert('암호로 여는 데 쓰는 파일이 없거나 손상되었습니다. 복구 키로 여세요 — 연 뒤 새 암호를 정하면 다시 암호로 열립니다.')

    // The recovery key is asked for at once; opening with it lands on setting a new passphrase.
    assert.ok(await app.cdp.evaluate(`!!__e2e.one('input[aria-label="복구 키"]')`), 'the recovery key field shows without looking for it')
    await app.type('복구 키', work.key)
    await app.click('dc-button', '열기')
    await app.vaultOpen()
    await app.cdp.waitFor(`!!__e2e.one('[data-role=key-file-lost]')`, 'a new passphrase asked for')
    assert.match(await app.cdp.evaluate(`__e2e.one('[data-role=key-file-lost]').textContent`), /새 암호를 정해야 다음부터 암호로 열 수 있습니다/)
    await app.click('button', '대상자')
    await app.cdp.waitFor(`__e2e.one('[data-role=key-hint]')?.getAttribute('role') === 'alert'`, 'still asked for on another screen')
    await app.click('dc-button', '새 암호 정하기')
    await app.type('새 암호', PASSPHRASE)
    await app.type('새 암호 다시 입력', PASSPHRASE)
    await app.click('dc-button', '암호 바꾸기')
    await app.cdp.waitFor(`!!__e2e.one('[data-role=passphrase-changed]')`, 'the passphrase set')

    await app.click('dc-button', '기록 폴더 닫기')
    await app.click('dc-button', '기록 폴더 열기')
    await app.pickFolder(work.vault)
    await app.type('암호', PASSPHRASE)
    await app.click('dc-button', '열기')
    await app.vaultOpen()
    await app.noAlert()
  },

  async 'says so when a folder is not a vault'(app, work) {
    await app.click('dc-button', '기록 폴더 닫기')
    await app.click('dc-button', '기록 폴더 열기')
    await app.pickFolder(work.empty)
    await app.type('암호', PASSPHRASE)
    await app.click('dc-button', '열기')
    await app.alert('이 폴더는 기록 폴더가 아닙니다.')
  },

  async 'puts back the file that marks a vault folder when only it went missing, and opens'(app, work) {
    const declaration = join(work.vault, 'vault.json')
    const before = await readFile(declaration)
    await rm(declaration)
    await app.pickFolder(work.vault)
    await app.type('암호', PASSPHRASE)
    await app.click('dc-button', '열기')
    await app.alert('이 폴더에서 기록 폴더임을 알리는 파일(vault.json)이 없어졌습니다. 암호 파일과 기록 파일은 남아 있어, 그 파일을 되살리면 전처럼 열립니다.')
    await app.click('dc-button', '그 파일을 되살리고 열기')
    await app.vaultOpen()
    await app.noAlert()
    assert.deepEqual(await readFile(declaration), before, 'the declaration every vault of this format has')
  },

  // Last: it ends the app, so the web view writes out its profile before the scan.
  async 'makes a vault on the neutral English track, records on it, and shows no Korean anywhere'(app, work) {
    // The core and English packs only: no school or Korean pack, and the window in English.
    await app.restart({ OPENQUOTE_UI_LOCALE: 'en' })
    const vault = join(dirname(work.vault), 'neutral-vault')
    await mkdir(vault)
    await app.click('dc-button', 'Create a vault')
    await app.pickFolder(vault)
    await app.type('Passphrase', PASSPHRASE)
    await app.type('Passphrase again', PASSPHRASE)
    await app.choose('Field and region', 'care-en')
    await app.click('dc-button', 'Create')
    await app.heading('Recovery kit')
    const key = (await app.cdp.evaluate(`__e2e.one('[data-role=key]').textContent`)).replaceAll(/\s+/g, '')
    await app.type('To confirm you kept it, type the last group of the recovery key (6 characters)', key.slice(-6))
    await app.click('dc-button', 'Confirm')
    await app.vaultOpen()
    assert.deepEqual((await readdir(join(vault, 'packs'))).sort(), ['care', 'en'], 'only the core and the English labels')

    await app.click('button', 'Practitioners')
    await app.click('dc-button', '+ New practitioner')
    await app.type('Practitioner name', 'Counselor A')
    await app.click('dc-button', 'Add practitioner')
    await app.click('button', 'Clients')
    await app.click('dc-button', '+ New client')
    await app.type('Client name', 'Client One')
    await app.click('dc-button', 'Add client')
    await app.click('li button .label', 'Client One')
    await app.setDate('Date', '2026-04-02')
    await app.choose('Concern', 'anxiety')
    await app.choose('Mode', 'video')
    await app.write('Notes', 'Synthetic notes about exam stress')
    await app.click('dc-button', 'Record session')
    await app.cdp.waitFor(`__e2e.all('tr[data-session]').length === 1`, 'the session listed')
    await app.noAlert()
    const [row] = await app.sessionRows()
    assert.ok(row[0].startsWith('2026-04-02'), 'the date first (its cell also offers to open the notes)')
    assert.deepEqual(row.slice(1), ['Anxiety and stress', 'Video', 'Counselor A'], 'then the concern, the mode and the practitioner')

    // The concern is optional on this track: a session without one is counted, in no row, and said so.
    await app.setDate('Date', '2026-04-09')
    await app.choose('Mode', 'phone')
    await app.click('dc-button', 'Record session')
    await app.cdp.waitFor(`__e2e.all('tr[data-session]').length === 2`, 'the session without a concern listed')
    await app.noAlert()
    await app.click('button', 'Monthly report')
    await app.type('Year', '2026')
    await app.choose('Month', '4')
    await app.click('dc-button', 'Run')
    await app.cdp.waitFor(`(() => { const m = __e2e.one('dc-metric[data-group=total]'); return m && (m.value + (m.querySelector('[data-role=people]')?.textContent ?? '')).trim() === '2 (1 person)' })()`, 'both sessions in the total')
    const blank = await app.cdp.evaluate(`(() => { const m = __e2e.one('dc-metric[data-group=blank]'); return m ? [m.label, (m.value + (m.querySelector('[data-role=people]')?.textContent ?? '')).trim()] : [] })()`)
    assert.deepEqual(blank, ['(No concern)', '1 (1 person)'], 'the session without a concern, apart from the rows')
    assert.equal(await app.cdp.evaluate(`(() => { const m = __e2e.one('dc-metric[data-group=unmapped]'); return (m.value + (m.querySelector('[data-role=people]')?.textContent ?? '')).trim() })()`), '0', 'not a gap in a crosswalk')
    assert.equal(await app.cdp.evaluate(`__e2e.one('[data-role=placed]').textContent.trim()`), '1 (1 person)', 'one session in the rows')

    // Every screen, every text node and every name a screen reader or tooltip gives, shadow roots included.
    const words = () => app.cdp.evaluate(`__e2e.all('*').flatMap((el) => [
      ...[...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent),
      ...['aria-label', 'title', 'placeholder', 'label'].map((a) => el.getAttribute(a) ?? ''),
    ]).join(' ')`)
    for (const screen of ['Clients', 'Groups', 'Monthly report', 'Record lists', 'Practitioners', 'Devices']) {
      await app.click('button', screen)
      assert.doesNotMatch(await words(), /[\uac00-\ud7a3]/, `no Korean on ${screen}`)
    }
  },

  async 'leaves no record, key or passphrase outside the vault'(app, work) {
    await app.quit()
    const typedKey = work.key.match(/.{1,6}/g).join(' ').toLowerCase()
    const needles = [PASSPHRASE, NEW_PASSPHRASE, work.key, work.key.toLowerCase(), typedKey,
      '가상 학생 1', '가상 학생 2', '상담자 가', '또래 집단', '상담실 PC', FAMILY_NOTE]
    const appData = join(process.env.LOCALAPPDATA, 'com.iyulab.openquote-care.e2e')
    assert.ok(existsSync(appData), 'the app data folder the scan covers exists')
    const inAppData = await filesHolding(appData, needles)
    // The app and its engine were given their own temporary folder for this run.
    const inTemp = await filesHolding(work.appTemp, needles)
    assert.deepEqual([...inAppData, ...inTemp], [], 'nothing typed or shown is kept outside the vault')
  },
}

/**
 * Files under `dir` (recursively) that contain any of `needles` in UTF-8 or UTF-16, as
 * `path: needle` lines. Unreadable entries (locked, gone, no access) are passed over.
 */
async function filesHolding(dir, needles) {
  const patterns = needles.flatMap((n) => [Buffer.from(n, 'utf8'), Buffer.from(n, 'utf16le')].map((b) => [n, b]))
  const found = []
  const walk = async (d) => {
    let entries
    try { entries = await readdir(d, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const path = join(d, entry.name)
      if (entry.isDirectory()) { await walk(path); continue }
      if (!entry.isFile()) continue
      let content
      try {
        const stats = await stat(path)
        if (stats.size > 64 * 1024 * 1024) continue
        content = await readFile(path)
      } catch { continue }
      for (const [needle, bytes] of patterns) {
        if (content.includes(bytes)) { found.push(`${path}: ${needle}`); break }
      }
    }
  }
  await walk(dir)
  return found
}

// The system temporary folder, read before a run points TEMP into its own folder.
const systemTemp = tmpdir()

/** A fresh start for one run: its own folders, and every app started from here on writing its temporary files into one of them. */
async function start() {
  const temp = await mkdtemp(join(systemTemp, 'openquote-care-e2e-'))
  const work = { vault: join(temp, 'vault'), empty: join(temp, 'empty'), appTemp: join(temp, 'app-temp') }
  const stop = async () => {
    await rm(temp, { recursive: true, force: true })
    process.env.TEMP = process.env.TMP = systemTemp
  }
  try {
    await mkdir(work.vault)
    await mkdir(work.empty)
    await mkdir(work.appTemp)
    // The app (and the engine it starts) write their temporary files where the last scenario can look through all of them.
    process.env.TEMP = process.env.TMP = work.appTemp
    return { app: await App.launch(), context: work, stop }
  } catch (e) {
    await stop()
    throw e
  }
}

if (!existsSync(exe)) throw new Error(`no e2e build at ${exe} — run \`npm run build:e2e\` first`)
if (!existsSync(sidecar)) throw new Error(`no sidecar at ${sidecar} — run \`npm run build:sidecar\` first`)
process.exitCode = await runScenarios(scenarios, {
  start,
  // A wait that timed out says what it waited for; what the window showed instead says why.
  shown: (app) => app.cdp.evaluate(`__e2e.all('[role=alert]').map((el) => el.textContent.trim()).filter(Boolean).join(' / ')`),
})
