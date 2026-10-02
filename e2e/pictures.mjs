// Pictures of the app's main screens, for its website: a fresh vault on a track, filled with made-up
// records through the app's own commands, then each screen as a person sees it. Every name and note
// is synthetic.
//
//   npm run build:sidecar && npm run build:e2e
//   node e2e/pictures.mjs <folder> [--locale ko|en] [--root <folder>]
//
// The vault and its backup are made under --root (default: the system's temporary folder) and its
// path shows on the recovery kit and the backup screen: for pictures to publish, give a root that
// names nobody, such as a folder at the top of a drive. It is removed afterwards.
//
// Korean pictures are of the Korean school track, English ones of the neutral English track.

import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { App, q, root } from './window.mjs'

const args = process.argv.slice(2)
const out = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'))
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const locale = option('--locale') ?? 'ko'
if (!out || !['ko', 'en'].includes(locale)) {
  console.error('usage: node e2e/pictures.mjs <folder> [--locale ko|en]')
  process.exit(2)
}
const PASSPHRASE = 'picture vault 2026'
const WIDTH = 1280
const HEIGHT = 820

/** What each locale needs: the screens' names, the track, and records that read naturally in it. */
const L = {
  ko: {
    track: 'school-kr',
    ui: {
      create: '새 기록 폴더 만들기', passphrase: '암호', again: '암호 다시 입력', track: '분야와 지역', make: '만들기', kit: '복구 키트',
      kitTail: '보관했는지 확인: 복구 키의 마지막 묶음(6자)을 입력하세요', confirm: '확인', subjects: '대상자', date: '날짜', note: '상담 내용',
      report: '통계', year: '연도', month: '월', run: '산출', lists: '기록 목록', makeList: '목록 만들기', refresh: '다시 읽기',
      compareWith: '이전 산출과 비교', compare: '비교', devices: '기기', backup: '자동 백업', practitioner: '담당자',
    },
    practitioners: ['상담교사 가', '전문상담사 나'],
    subjects: ['가상 학생 1', '가상 학생 2', '가상 학생 3', '가상 학생 4', '가상 학생 5', '가상 학생 6', '가상 학생 7', '가상 학생 8'],
    subjectFields: (i) => ({ school: '가상중학교', grade: String((i % 3) + 1), class: String((i % 5) + 1) }),
    topic: 'topic',
    method: 'method',
    // Topic codes of the school pack, each with notes of the kind a counsellor might write.
    notes: {
      learning: ['시험을 앞두고 공부가 손에 잡히지 않는다고 함', '성적이 떨어져 진로를 걱정함', '수업 시간에 집중이 어렵다고 함'],
      relation: ['반 친구들과 사이가 멀어져 점심을 혼자 먹음', '친한 친구와 다툰 뒤 학교 가기 싫다고 함'],
      family: ['휴대전화 문제로 부모님과 자주 다툼', '집에서 형제와 갈등이 잦다고 함'],
      anxiety: ['발표 전에 숨이 가빠지고 긴장된다고 함', '잠들기 전 걱정이 많아 잠을 설침'],
      depression: ['요즘 아무것도 하기 싫고 기운이 없다고 함'],
      anger: ['화가 나면 물건을 던지게 된다고 함'],
    },
    methods: ['interview', 'interview', 'interview', 'phone', 'consult'],
    // The order sessions take their topics in: the common ones more often.
    sequence: ['learning', 'relation', 'family', 'learning', 'anxiety', 'relation', 'depression', 'family', 'learning', 'anger', 'relation', 'anxiety', 'learning'],
    crisis: { topic: 'crisis', note: '사라지고 싶다는 말을 해 안전 계획을 함께 세움' },
    draft: { subject: '가상 학생 3', date: '2026-05-21', note: '휴대전화 때문에 부모님과 또 다툼', crisisNote: '사라지고 싶다는 말을 다시 함' },
  },
  en: {
    track: 'care-en',
    ui: {
      create: 'Create a vault', passphrase: 'Passphrase', again: 'Passphrase again', track: 'Field and region', make: 'Create', kit: 'Recovery kit',
      kitTail: 'To confirm you kept it, type the last group of the recovery key (6 characters)', confirm: 'Confirm', subjects: 'Clients', date: 'Date',
      note: 'Notes', report: 'Statistics', year: 'Year', month: 'Month', run: 'Run', lists: 'Record lists', makeList: 'Make list', refresh: 'Reload',
      compareWith: 'Compare with an earlier run', compare: 'Compare', devices: 'Devices', backup: 'Automatic backup', practitioner: 'Practitioner',
    },
    practitioners: ['Counselor A', 'Counselor B'],
    subjects: ['Client One', 'Client Two', 'Client Three', 'Client Four', 'Client Five', 'Client Six'],
    subjectFields: () => ({}),
    topic: 'care.concern',
    method: 'care.mode',
    notes: {
      'study-work': ['Exam stress, finds it hard to start studying', 'Worried about falling behind at work'],
      relationships: ['Drifting apart from friends, eats lunch alone', 'Argument with a close friend'],
      family: ['Frequent arguments with parents about phone use', 'Tension with a sibling at home'],
      anxiety: ['Short of breath before presentations', 'Lies awake worrying'],
      mood: ['Low energy, nothing feels worth doing lately'],
    },
    methods: ['in-person', 'in-person', 'video', 'phone'],
    sequence: ['study-work', 'relationships', 'family', 'study-work', 'anxiety', 'relationships', 'mood', 'family', 'study-work', 'anxiety', 'relationships'],
    crisis: { topic: 'safety', note: 'Said they want to disappear; made a safety plan together' },
    draft: { subject: 'Client Three', date: '2026-05-21', note: 'Argued with parents about the phone again', crisisNote: 'Said again they want to disappear' },
  },
}[locale]

const shots = resolve(out)
await mkdir(shots, { recursive: true })
const base = option('--root') ?? tmpdir()
if (!existsSync(base)) await mkdir(base, { recursive: true })
// A plain name, as a person's own folder would have; one left from an earlier run is not reused.
const work = join(base, locale === 'ko' ? '학교 상담' : 'Counseling')
if (existsSync(work)) throw new Error(`${work} exists — remove it or give another --root`)
await mkdir(work)
const vault = join(work, locale === 'ko' ? '2026 상담 기록' : 'Counseling records 2026')
await mkdir(vault)
const app = await App.launch({ OPENQUOTE_UI_LOCALE: locale })
const ui = L.ui
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** The window at a fixed size, so every picture is framed the same. */
async function frame() {
  await app.cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: false })
}

async function shoot(name) {
  await sleep(600) // transitions and fonts settle
  const { data } = await app.cdp.send('Page.captureScreenshot', { format: 'png' })
  await writeFile(join(shots, `${name}.png`), Buffer.from(data, 'base64'))
  console.log(`  ✓ ${name}`)
}

const invoke = (command, args) => app.cdp.evaluate(`window.__TAURI_INTERNALS__.invoke(${q(command)}, ${q(args)})`)
// The entity a first change starts: a subject's folder, or the file's id in the flat list of practitioners.
const idOf = (path) => path.split('/')[1].split('.')[0]
const coded = (scheme, code) => ({ scheme, version: 1, code })

try {
  await frame()
  // A vault on the track, as a person makes it; the recovery kit is the first picture.
  await app.click('dc-button', ui.create)
  await app.pickFolder(vault)
  await app.type(ui.passphrase, PASSPHRASE)
  await app.type(ui.again, PASSPHRASE)
  await app.choose(ui.track, L.track)
  await app.click('dc-button', ui.make)
  await app.heading(ui.kit)
  await shoot('kit')
  const key = (await app.cdp.evaluate(`__e2e.one('[data-role=key]').textContent`)).replaceAll(/\s+/g, '')
  await app.type(ui.kitTail, key.slice(-6))
  await app.click('dc-button', ui.confirm)
  await app.vaultOpen()

  // Made-up records, through the same commands the screens use.
  const practitioners = []
  for (const name of L.practitioners) practitioners.push(idOf(await invoke('record', { route: '/changes/practitioner', request: { fields: { name } } })))
  const subjects = []
  for (const [i, name] of L.subjects.entries()) subjects.push(idOf(await invoke('record', { route: '/changes/subject', request: { fields: { name, ...L.subjectFields(i) } } })))
  let n = 0
  for (const month of ['03', '04', '05']) {
    for (let day = 2; day <= 28; day += 2) {
      if (month === '05' && day > 20) break
      const topic = L.sequence[n % L.sequence.length]
      const notes = L.notes[topic]
      const fields = {
        date: `2026-${month}-${String(day).padStart(2, '0')}`,
        practitioner: practitioners[Math.floor(n / 3) % practitioners.length],
        [locale === 'ko' ? 'topic' : 'concern']: coded(L.topic, topic),
        [locale === 'ko' ? 'method' : 'mode']: coded(L.method, L.methods[(n * 2) % L.methods.length]),
        note: notes[n % notes.length],
      }
      await invoke('record', { route: '/changes/in-subject', request: { subjectId: subjects[(n * 5) % subjects.length], type: 'session', fields } })
      n++
    }
  }
  await app.click('dc-button', ui.refresh)
  await sleep(1500)

  // A new session: the suggestions under the empty classification, and why.
  await app.click('button', ui.subjects)
  await app.click('li button .label', L.draft.subject)
  await app.setDate(ui.date, L.draft.date)
  await app.choose(ui.practitioner, practitioners[0])
  await app.write(ui.note, L.draft.note)
  await app.cdp.waitFor(`__e2e.all('[data-suggestions] dc-button[data-suggestion]').length > 0`, 'suggestions')
  await app.click('dc-button[data-role=why-suggested]')
  await shoot('suggest')
  // A crisis-related session recorded earlier: a draft like it is offered that topic, set apart.
  await invoke('record', { route: '/changes/in-subject', request: { subjectId: subjects[1], type: 'session', fields: {
    date: '2026-05-14', practitioner: practitioners[1], [locale === 'ko' ? 'topic' : 'concern']: coded(L.topic, L.crisis.topic), note: L.crisis.note } } })
  await app.click('dc-button', ui.refresh)
  await app.cdp.waitFor(`!!__e2e.one(${q(`textarea[aria-label="${ui.note}"]`)})`, 'the form again')
  await app.write(ui.note, L.draft.crisisNote)
  await app.cdp.waitFor(`!!__e2e.one('[data-suggestions] dc-button[data-confirm]')`, 'a suggestion to be confirmed')
  await app.cdp.evaluate(`(__e2e.one('[data-suggestions]')?.scrollIntoView({ block: 'center' }), true)`)
  await shoot('confirm')
  await app.write(ui.note, '')

  // The monthly report, and what one count is made of.
  await app.click('button', ui.report)
  await app.type(ui.year, '2026')
  await app.choose(ui.month, '4')
  await app.click('dc-button', ui.run)
  await app.cdp.waitFor(`!!__e2e.one('[data-role=period]')`, 'the report')
  await shoot('report')
  // The largest count: what one number in the table is made of.
  await app.cdp.evaluate(`(() => { const cells = __e2e.all('tr[data-row] button.cell'); cells.sort((a, b) => parseInt(b.textContent) - parseInt(a.textContent))[0].click(); return true })()`)
  await app.cdp.waitFor(`__e2e.all('tr[data-evidence]').length > 0`, 'the evidence')
  await app.cdp.evaluate(`(__e2e.one('tr[data-evidence]')?.scrollIntoView({ block: 'center' }), true)`)
  await shoot('evidence')

  if (locale === 'ko') {
    // A revision of the topics: one category split in two waits for a person; the report says so.
    await app.cdp.evaluate(`__e2e.one('oc-vault').applyPack(${q(join(root, 'tests', 'golden', 'steps', '2'))}).then(() => true)`)
    await app.cdp.waitFor(`__e2e.all('[role=status]').some((el) => el.textContent.includes('1판→2판'))`, 'the revision applied')
    await app.click('dc-button', ui.run)
    await app.cdp.waitFor(`!!__e2e.one('dc-metric[data-group=pending]')`, 'the report in the new version')
    await shoot('revision')
    await app.cdp.evaluate(`(() => { __e2e.one('dc-metric[data-group=pending] button.cell').click(); return true })()`)
    await app.cdp.waitFor(`__e2e.all('tr[data-pending]').length > 0`, 'the sessions waiting')
    await app.cdp.evaluate(`(__e2e.one('tr[data-pending]')?.scrollIntoView({ block: 'center' }), true)`)
    await shoot('settle')
    // The new run against the first one: what moved, and why.
    const first = await app.cdp.evaluate(`[...__e2e.one(${q(`select[aria-label="${ui.compareWith}"]`)}).options].at(-1).value`)
    await app.choose(ui.compareWith, first)
    await app.click('dc-button', ui.compare)
    await app.cdp.waitFor(`!!__e2e.one('[data-role=comparison-counts]')`, 'the comparison')
    await app.cdp.evaluate(`(__e2e.one('[data-role=comparison-counts]')?.scrollIntoView({ block: 'start' }), true)`)
    await shoot('compare')
  }

  // The month's sessions in the export form, ready to paste.
  await app.click('button', ui.lists)
  await app.type(ui.year, '2026')
  await app.choose(ui.month, '4')
  await app.click('dc-button', ui.makeList)
  await app.cdp.waitFor(`__e2e.all('tr[data-export-row]').length > 0`, 'the list')
  await shoot('export')

  // The automatic backup, in another folder.
  const copy = join(work, locale === 'ko' ? '백업' : 'Backup')
  await mkdir(copy)
  await app.click('button', ui.devices)
  await app.click('button', ui.backup)
  await app.cdp.evaluate(`__e2e.one('oc-vault').setBackup(${q(copy)}).then(() => true)`)
  await app.cdp.waitFor(`!!__e2e.one('[data-role=backup-status]')`, 'the backup')
  await sleep(1500)
  await shoot('backup')
} finally {
  await app.quit()
  await rm(work, { recursive: true, force: true }).catch(() => {})
}
console.log(`pictures in ${shots}`)
