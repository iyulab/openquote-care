// Pictures of the app's main screens, for its website: a fresh vault on a track, filled with made-up
// records through the app's own commands, then each screen as a person sees it. Every name and note
// is synthetic.
//
//   npm run build:sidecar && npm run build:e2e
//   node e2e/pictures.mjs <folder> [--locale ko|en] [--theme light|dark] [--root <folder>] [--compare <earlier folder>] [--set-short-date]
//
// --theme takes every picture in those colours (the app's own setting, put back to following the
// system when the run ends); without it, the window follows the system's.
// The app's language setting is the locale's for the run, and follows the system again after it.
//
// Beside each picture goes the text it shows (<scene>.txt). With --compare, the scenes whose text
// differs from an earlier run's are listed — with the lines added and gone — in <folder>/changes.txt,
// so a person looks first at the pictures that changed. The run also says which kinds of record and
// which forms the vault holds that are not in e2e/pictures-known.json — new since the scenes were
// last decided: give one a scene, or add it to that file (--update-known writes what the vault holds).
//
// The vault and its backup are made under --root (default: the system's temporary folder) and its
// path shows on the recovery kit and the backup screen: for pictures to publish, give a root that
// names nobody, such as a folder at the top of a drive. It is removed afterwards.
//
// Korean pictures are of the Korean school track, English ones of the neutral English track.
// Date fields show in Windows' regional format, which neither a browser argument nor the devtools
// locale override changes: the script takes Korean pictures only where that format is the Korean one.
// With --set-short-date it sets Windows' short date format to the locale's for the run (the window,
// started after, reads it) and puts the person's own back when the run ends, however it ends. A run
// that could not put it back leaves a note in the temporary folder, and the next run refuses to start
// until the format is mended by hand and the note removed.

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { App, q, root } from './window.mjs'

const args = process.argv.slice(2)
// The options that take a value; the others (--set-short-date, --update-known) stand alone.
const VALUED = ['--locale', '--root', '--compare']
const out = args.find((a, i) => !a.startsWith('--') && !VALUED.includes(args[i - 1]))
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const locale = option('--locale') ?? 'ko'
if (!out || !['ko', 'en'].includes(locale)) {
  console.error('usage: node e2e/pictures.mjs <folder> [--locale ko|en]')
  process.exit(2)
}
// Date fields show in Windows' short date format, which the pictures cannot change: a Korean picture
// taken under another format shows dates no Korean installation shows. Take them where it is Korean.
const SHORT_DATE = { ko: 'yyyy-MM-dd' }
const SHORT_DATE_NOTE = join(tmpdir(), 'openquote-pictures-short-date.txt')
/** Sets Windows' short date format for this user the way Region settings does, so processes started after read it. */
function setShortDate(format) {
  const set = `Add-Type -Namespace W -Name L -MemberDefinition '[DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern bool SetLocaleInfo(uint l, uint t, string d);'; if (-not [W.L]::SetLocaleInfo(0x400, 0x1F, '${format.replaceAll("'", "''")}')) { exit 1 }`
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', set], { stdio: 'inherit' })
}
if (process.platform === 'win32' && SHORT_DATE[locale]) {
  if (existsSync(SHORT_DATE_NOTE)) {
    console.error(`An earlier run may have left Windows' short date format changed; it was ${readFileSync(SHORT_DATE_NOTE, 'utf8').trim()}. Set it back in Region settings, then delete ${SHORT_DATE_NOTE}.`)
    process.exit(2)
  }
  const set = execFileSync('reg', ['query', 'HKCU\\Control Panel\\International', '/v', 'sShortDate'], { encoding: 'utf8' }).match(/sShortDate\s+REG_SZ\s+(\S+)/)?.[1]
  if (set !== SHORT_DATE[locale]) {
    if (!args.includes('--set-short-date') || !set) {
      console.error(`Windows shows short dates as ${set ?? 'unknown'} here; ${locale} pictures need ${SHORT_DATE[locale]} (Region settings, or --set-short-date for this run).`)
      process.exit(2)
    }
    writeFileSync(SHORT_DATE_NOTE, `${set}\n`)
    setShortDate(SHORT_DATE[locale])
    let restored = false
    // Put back on every way out: the end, an error, Ctrl+C.
    process.on('exit', () => {
      if (restored) return
      restored = true
      setShortDate(set)
      unlinkSync(SHORT_DATE_NOTE)
      console.log(`Windows' short date format is ${set} again.`)
    })
    process.on('SIGINT', () => process.exit(130))
  }
}
const PASSPHRASE = 'picture vault 2026'
const WIDTH = 1280
const HEIGHT = 820

const coded = (scheme, code) => ({ scheme, version: 1, code })
// The school track's NEIS category (under 상담 › 개인상담) and session title for each topic.
const NEIS = { learning: 'academic', relation: 'relationships', family: 'family', anxiety: 'mental-health', depression: 'mental-health', anger: 'personality', crisis: 'self-harm-suicide' }
// The assessments sessions give, in turn: a battery (the first marked primary), one alone, or none.
const tool = (code, primary) => ({ ...coded('assessment-tool', code), ...(primary ? { primary: true } : {}) })
const ASSESSMENTS = [[tool('mmpi-a', true), tool('sct'), tool('htp')], null, tool('sct'), null, [tool('k-wisc-v', true), tool('bgt')], null, null]
const TITLES = { learning: '학업 고민 상담', relation: '교우 관계 상담', family: '가족 갈등 상담', anxiety: '불안 상담', depression: '우울감 상담', anger: '분노 조절 상담', crisis: '위기 상담' }

/** What each locale needs: the screens' names, the track, and records that read naturally in it. */
const L = {
  ko: {
    track: 'school-kr',
    ui: {
      create: '새 기록 폴더 만들기', passphrase: '암호', again: '암호 다시 입력', track: '분야와 지역', make: '만들기', kit: '복구 키트',
      kitTail: '보관했는지 확인: 복구 키의 마지막 묶음(6자)을 입력하세요', confirm: '확인', newSubject: '＋ 새 대상자', subjectName: '대상자 이름', subjects: '대상자', date: '날짜', note: '상담 내용',
      report: '통계', year: '연도', month: '월', run: '산출', lists: '기록 목록', makeList: '목록 만들기', refresh: '다시 읽기',
      compareWith: '이전 산출과 비교', compare: '비교', devices: '기기', backup: '자동 백업', appSettings: '앱 설정', practitioner: '담당자',
      find: '기록 찾기', findLabel: '찾을 말', choices: '선택 목록', itemName: '항목 이름', countedAs: '통계에서 세는 항목', addToList: '목록에 더하기',
    },
    practitioners: ['상담교사 가', '전문상담사 나'],
    practitionerFields: (i) => ({ affiliation: ['전문상담교사', '전문상담사'][i % 2] }),
    subjects: ['가상 학생 1', '가상 학생 2', '가상 학생 3', '가상 학생 4', '가상 학생 5', '가상 학생 6', '가상 학생 7', '가상 학생 8'],
    subjectFields: (i) => ({ school: '가상중학교', grade: String((i % 3) + 1), class: String((i % 5) + 1), gender: i % 2 ? '여' : '남' }),
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
    // What the school track records beside topic and method: the student's grade and class that day
    // (the session form copies them from the student), the NEIS category, a title, the length,
    // who the session was with (the student unless said otherwise — now and then a parent), and now
    // and then the assessments given — a battery at a first meeting, one on its own later.
    sessionFields: (topic, n, subject) => ({
      grade: String((subject % 3) + 1),
      class: String((subject % 5) + 1),
      neis: coded('neis-counseling', `counseling/individual/${NEIS[topic]}`),
      title: TITLES[topic],
      minutes: [40, 50, 30][n % 3],
      ...(topic === 'family' && n % 2 ? { client_type: coded('client-type', 'parent') } : {}),
      ...(ASSESSMENTS[n % ASSESSMENTS.length] ? { assessments: ASSESSMENTS[n % ASSESSMENTS.length] } : {}),
    }),
    search: '친구',
    // Referrals kept under a student, and an assessment the school uses that the list lacks.
    referrals: [
      { subject: 1, date: '2026-04-20', to: 'mental-health', organisation: '가상 정신건강복지센터', outcome: 'taken-up' },
      { subject: 1, date: '2026-05-15', to: 'medical', organisation: '가상 소아청소년과의원', outcome: 'waiting' },
    ],
    // What an outside counsellor provided after the first referral, and what it cost.
    provisions: [
      { date: '2026-04-24', provider: '가상 외부 상담 전문가', sessions: 2, amount: 120000 },
      { date: '2026-04-28', provider: '가상 외부 상담 전문가', sessions: 1, amount: 60000 },
    ],
    // How each student's work began, and how some of it ended: a closing note says what was done.
    cases: {
      presenting: ['수업 집중이 어렵고 성적이 떨어졌다고 담임이 의뢰', '친구 관계가 힘들다며 직접 찾아옴', '집에서 다툼이 잦다고 보호자가 연락'],
      intakes: ['school', 'self', 'family', 'school', 'screening', 'service', 'self', 'school'],
      closings: [
        { subject: 1, date: '2026-05-20', reason: 'referred', summary: '정신건강복지센터 상담을 이어 가기로 하고 학교 상담은 마침' },
        { subject: 3, date: '2026-04-10', reason: 'completed', summary: '시험 불안이 줄었다고 스스로 말해 목표를 이룬 것으로 봄' },
        { subject: 5, date: '2026-04-17', reason: 'lost-contact', summary: '두 차례 약속에 오지 않고 연락이 닿지 않음' },
        { subject: 6, date: '2026-04-24', reason: 'completed', summary: '친구 관계가 회복되어 상담을 마침' },
        { subject: 7, date: '2026-04-28', reason: 'moved-away', summary: '전학으로 상담을 마침' },
      ],
    },
    extend: { list: 'assessment-tool', label: 'MMPI-A 단축형', anchor: 'other', form: 'local.assessment-tool.month-assessment-tool@1',
      fields: (value) => ({ assessments: [{ ...value, primary: true }] }) },
    crisis: { topic: 'crisis', note: '사라지고 싶다는 말을 해 안전 계획을 함께 세움' },
    draft: { subject: '가상 학생 3', date: '2026-05-21', note: '휴대전화 때문에 부모님과 또 다툼', crisisNote: '사라지고 싶다는 말을 다시 함' },
  },
  en: {
    track: 'care-en',
    ui: {
      create: 'Create a vault', passphrase: 'Passphrase', again: 'Passphrase again', track: 'Field and region', make: 'Create', kit: 'Recovery kit',
      kitTail: 'To confirm you kept it, type the last group of the recovery key (6 characters)', confirm: 'Confirm', newSubject: '+ New client', subjectName: 'Client name', subjects: 'Clients', date: 'Date',
      note: 'Notes', report: 'Statistics', year: 'Year', month: 'Month', run: 'Run', lists: 'Record lists', makeList: 'Make list', refresh: 'Reload',
      compareWith: 'Compare with an earlier run', compare: 'Compare', devices: 'Devices', backup: 'Automatic backup', appSettings: 'App settings', practitioner: 'Practitioner',
      find: 'Find records', findLabel: 'Words to find', choices: 'Choice lists', itemName: 'Item name', countedAs: 'Counted in statistics as',
      addToList: 'Add to the list',
    },
    practitioners: ['Counselor A', 'Counselor B'],
    subjects: ['Client One', 'Client Two', 'Client Three', 'Client Four', 'Client Five', 'Client Six'],
    subjectFields: () => ({}),
    practitionerFields: () => ({}),
    sessionFields: () => ({}),
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
    search: 'friend',
    referrals: [
      { subject: 1, date: '2026-04-20', to: 'mental-health', organisation: 'Synthetic Wellbeing Centre', outcome: 'taken-up' },
      { subject: 1, date: '2026-05-15', to: 'medical', organisation: 'Synthetic Family Practice', outcome: 'waiting' },
    ],
    provisions: [
      { date: '2026-04-24', provider: 'Synthetic Counselling Practice', sessions: 2, amount: 160 },
      { date: '2026-04-28', provider: 'Synthetic Counselling Practice', sessions: 1, amount: 80 },
    ],
    cases: {
      presenting: ['Finds it hard to concentrate; referred by a teacher', 'Came in on their own about friendships', 'Family called about frequent arguments at home'],
      intakes: ['school', 'self', 'family', 'screening', 'service', 'self'],
      closings: [
        { subject: 1, date: '2026-05-20', reason: 'referred', summary: 'Continuing with the wellbeing centre; our sessions end here' },
        { subject: 3, date: '2026-04-10', reason: 'completed', summary: 'Says the exam worry has eased; goals met' },
        { subject: 4, date: '2026-04-17', reason: 'lost-contact', summary: 'Missed two appointments and could not be reached' },
        { subject: 5, date: '2026-04-24', reason: 'completed', summary: 'Friendships back on track; work ended' },
      ],
    },
    extend: { list: 'care.concern', label: 'Exam pressure', anchor: 'study-work', form: 'local.care.concern.care.monthly-concern@1',
      fields: (value) => ({ concern: value }) },
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

// The words the window shows, one run of text to a line, read through every shadow root: only what is
// in view, as in the picture.
const SHOWN = `(() => {
  const lines = []
  const inView = (el) => {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false
    const s = getComputedStyle(el)
    return s.visibility !== 'hidden' && s.display !== 'none'
  }
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        const t = child.textContent.replace(/\\s+/g, ' ').trim()
        if (t && child.parentElement && inView(child.parentElement)) lines.push(t)
      } else if (child.nodeType === 1 && child.localName !== 'style' && child.localName !== 'script') {
        if (child.shadowRoot) walk(child.shadowRoot)
        walk(child)
      }
    }
  }
  walk(document.body)
  return lines.join('\\n')
})()`

async function shoot(name) {
  await sleep(600) // transitions and fonts settle
  const { data } = await app.cdp.send('Page.captureScreenshot', { format: 'png' })
  await writeFile(join(shots, `${name}.png`), Buffer.from(data, 'base64'))
  // The recovery key and the moments the app shows (the last backup, say — a day and a time) are new on every
  // run: they would read as a change each time. The records' own dates are days alone and stay.
  const shown = (await app.cdp.evaluate(SHOWN))
    .replaceAll(/AGE-SECRET-KEY-1[0-9A-Z ]+/g, 'AGE-SECRET-KEY-1 …')
    .replaceAll(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/g, '(moment)')
    .replaceAll(/\d{4}\. \d{1,2}\. \d{1,2}\.|\d{1,2}\/\d{1,2}\/\d{4}/g, '(day)')
    .replaceAll(/\d{1,2}:\d{2}(:\d{2})?/g, '(time)')
  await writeFile(join(shots, `${name}.txt`), `${shown}\n`)
  console.log(`  ✓ ${name}`)
}

const invoke = (command, args) => app.cdp.evaluate(`window.__TAURI_INTERNALS__.invoke(${q(command)}, ${q(args)})`)
// The entity a first change starts: a subject's folder, or the file's id in the flat list of practitioners.
const idOf = (path) => path.split('/')[1].split('.')[0]

const theme = option('--theme')

try {
  if (theme && !['light', 'dark'].includes(theme)) throw new Error(`--theme is light or dark, not ${theme}`)
  await frame()
  if (theme) await invoke('set_theme', { theme })
  // The settings say the language the pictures are in, as a person who chose it sees them, rather than the system's.
  await invoke('set_language', { language: locale })
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
  for (const [i, name] of L.practitioners.entries()) {
    practitioners.push(idOf(await invoke('record', { route: '/changes/practitioner', request: { fields: { name, ...L.practitionerFields(i) } } })))
  }
  const subjects = []
  for (const [i, name] of L.subjects.entries()) subjects.push(idOf(await invoke('record', { route: '/changes/subject', request: { fields: { name, ...L.subjectFields(i) } } })))
  let n = 0
  for (const month of ['03', '04', '05']) {
    for (let day = 2; day <= 28; day += 2) {
      if (month === '05' && day > 20) break
      const topic = L.sequence[n % L.sequence.length]
      const subject = (n * 5) % subjects.length
      const notes = L.notes[topic]
      const fields = {
        date: `2026-${month}-${String(day).padStart(2, '0')}`,
        practitioner: practitioners[Math.floor(n / 3) % practitioners.length],
        [locale === 'ko' ? 'topic' : 'concern']: coded(L.topic, topic),
        [locale === 'ko' ? 'method' : 'mode']: coded(L.method, L.methods[(n * 2) % L.methods.length]),
        note: notes[n % notes.length],
        // Where a school session was held: mostly the school's own room, now and then elsewhere.
        ...(locale === 'ko' ? { place: coded('place', ['wee-class', 'wee-class', 'wee-class', 'visiting-school', 'wee-center', 'home-visit'][n % 6]) } : {}),
        ...L.sessionFields(topic, n, subject),
      }
      await invoke('record', { route: '/changes/in-subject', request: { subjectId: subjects[subject], type: 'session', fields } })
      n++
    }
  }
  await app.folderAction(ui.refresh)
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
    date: '2026-05-14', practitioner: practitioners[1], [locale === 'ko' ? 'topic' : 'concern']: coded(L.topic, L.crisis.topic), note: L.crisis.note,
    ...L.sessionFields(L.crisis.topic, 0, 1) } } })
  await app.folderAction(ui.refresh)
  await app.cdp.waitFor(`!!__e2e.one(${q(`textarea[aria-label="${ui.note}"]`)})`, 'the form again')
  await app.write(ui.note, L.draft.crisisNote)
  await app.cdp.waitFor(`!!__e2e.one('[data-suggestions] dc-button[data-confirm]')`, 'a suggestion to be confirmed')
  await app.cdp.evaluate(`(__e2e.one('[data-suggestions]')?.scrollIntoView({ block: 'center' }), true)`)
  await shoot('confirm')
  await app.write(ui.note, '')

  // The monthly report, and what one count is made of.
  await app.click('button', ui.report)
  await app.click(`nav[aria-label] button[data-entry="${locale === 'ko' ? 'monthly-topic@1' : 'care.monthly-concern@1'}"]`)
  await app.choose(ui.year, '2026')
  await app.choose(ui.month, '4')
  await app.click('dc-button', ui.run)
  await app.cdp.waitFor(`!!__e2e.one('[data-role=period]')`, 'the report')
  await shoot('report')
  // The largest count: what one number in the table is made of.
  await app.cdp.evaluate(`(() => { const cells = __e2e.all('tr[data-row] button.cell'); cells.sort((a, b) => parseInt(b.textContent) - parseInt(a.textContent))[0].click(); return true })()`)
  await app.cdp.waitFor(`__e2e.all('tr[data-evidence]').length > 0`, 'the evidence')
  // The section from its heading, so the table's header row shows above its first records.
  await app.cdp.evaluate(`(__e2e.one('section[data-role=evidence]')?.scrollIntoView({ block: 'start' }), true)`)
  await shoot('evidence')

  // The month's sessions in the export form, ready to paste, before any revision of the topics.
  await app.click('button', ui.lists)
  await app.cdp.evaluate(`(__e2e.all('nav[aria-label] button[data-entry^="session-list@"]').at(-1)?.click(), true)`)
  await app.choose(ui.year, '2026')
  await app.choose(ui.month, '4')
  await app.click('dc-button', ui.makeList)
  await app.cdp.waitFor(`__e2e.all('tr[data-export-row]').length > 0`, 'the list')
  await shoot('export')

  // Finding sessions by a word of what they say.
  await app.click('button', ui.find)
  await app.type(ui.findLabel, L.search)
  await app.cdp.waitFor(`__e2e.all('tr[data-hit]').length > 1`, 'the sessions found')
  await shoot('search')

  // Records besides sessions, kept under a subject: how each one's work began, referrals, and how some of it ended.
  for (const [i, source] of L.cases.intakes.entries()) {
    await invoke('record', { route: '/changes/in-subject', request: { subjectId: subjects[i], type: 'intake', fields: {
      date: `2026-03-0${i + 1}`, practitioner: practitioners[i % practitioners.length], source: coded('care.intake-source', source),
      presenting: L.cases.presenting[i % L.cases.presenting.length] } } })
  }
  for (const [i, c] of L.cases.closings.entries()) {
    await invoke('record', { route: '/changes/in-subject', request: { subjectId: subjects[c.subject], type: 'closing', fields: {
      date: c.date, practitioner: practitioners[i % practitioners.length], reason: coded('care.closing-reason', c.reason), summary: c.summary } } })
  }
  const referrals = []
  for (const r of L.referrals) {
    const path = await invoke('record', { route: '/changes/in-subject', request: { subjectId: subjects[r.subject], type: 'referral', fields: {
      date: r.date, practitioner: practitioners[0], to: coded('care.service', r.to), organisation: r.organisation,
      outcome: coded('care.referral-outcome', r.outcome) } } })
    referrals.push(path.split('/').at(-1).split('.')[0])
  }
  // Provisions following the first referral: the outside counsellor's sessions and what they cost.
  for (const p of L.provisions) {
    await invoke('record', { route: '/changes/in-subject', request: { subjectId: subjects[L.referrals[0].subject], type: 'provision', fields: {
      date: p.date, practitioner: practitioners[0], referral: referrals[0], programme: coded('care.programme', 'external-counselling'), provider: p.provider,
      sessions: p.sessions, amount: p.amount } } })
  }
  await app.folderAction(ui.refresh)
  await sleep(1500)
  await app.click('button', ui.subjects)
  await app.click('li button .label', L.subjects[L.referrals[0].subject])
  await app.cdp.waitFor(`__e2e.all('section[data-kind="referral"] tr[data-record]').length === ${L.referrals.length}`, 'the referrals')
  await app.cdp.evaluate(`(__e2e.one('section[data-kind="referral"]')?.scrollIntoView({ block: 'center' }), true)`)
  await shoot('referral')
  // The same page from its first kind of record: the intake, the referrals and the closing together.
  await app.cdp.evaluate(`(__e2e.one('section[data-kind="intake"]')?.scrollIntoView({ block: 'start' }), true)`)
  await shoot('case')
  await app.cdp.waitFor(`__e2e.all('section[data-kind="provision"] tr[data-record]').length === ${L.provisions.length}`, 'the provisions')
  await app.cdp.evaluate(`(__e2e.one('section[data-kind="provision"]')?.scrollIntoView({ block: 'center' }), true)`)
  await shoot('provision')
  // What asks for something above the list: the people with a referral still waiting for its outcome, and since when.
  await app.click('dc-button[data-attention="awaiting"]')
  await app.cdp.waitFor(`__e2e.all('.pane.list li').length === 1`, 'the list narrowed to who waits for an answer')
  await shoot('waiting')
  await app.click('dc-button[data-attention="awaiting"]')

  // The month's provisions by programme: how many, for how many people, the sessions and the amount added up.
  await app.click('button', ui.report)
  await app.click('nav[aria-label] button[data-entry="care.monthly-provision@1"]')
  await app.choose(ui.year, '2026')
  await app.choose(ui.month, '4')
  await app.click('dc-button', ui.run)
  await app.cdp.waitFor(`!!__e2e.one('[data-section="0"] tr[data-row="external-counselling"]')`, 'the month by programme')
  await shoot('provided')

  // Where the month's sessions were held, by practitioner.
  if (locale === 'ko') {
    await app.click('button', ui.report)
    await app.click('nav[aria-label] button[data-entry="month-practitioner-place@1"]')
    await app.choose(ui.year, '2026')
    await app.choose(ui.month, '4')
    await app.click('dc-button', ui.run)
    await app.cdp.waitFor(`!!__e2e.one('[data-section="0"] tr[data-row="wee-class"]')`, 'the month by place')
    await shoot('place')
  }

  // Work about no one — a school vault keeps trainings, meetings and events in the activity folder.
  if (locale === 'ko') {
    const activities = [
      { date: '2026-04-08', kind: 'training-given', title: '가상 학부모 연수 — 마음 읽기', hours: 2 },
      { date: '2026-04-15', kind: 'meeting', title: '가상 학교폭력 대책 협의회', hours: 1.5 },
      { date: '2026-04-22', kind: 'training-taken', title: '가상 위기 개입 직무 연수', hours: 15 },
      { date: '2026-04-29', kind: 'event', title: '가상 생명 존중 주간 행사', hours: 3 },
    ]
    for (const [i, a] of activities.entries()) {
      await invoke('record', { route: '/changes/activity', request: { type: 'activity', fields: {
        date: a.date, practitioner: practitioners[i % practitioners.length], kind: coded('activity-kind', a.kind), title: a.title, hours: a.hours } } })
    }
    await app.folderAction(ui.refresh)
    await app.click('button', '활동')
    await app.cdp.waitFor(`__e2e.all('section[data-kind="activity"] tr[data-record]').length === ${4}`, 'the activities listed')
    await shoot('activities')
  }

  // The month's closings by reason, per practitioner.
  await app.click('button', ui.report)
  await app.click('nav[aria-label] button[data-entry="care.monthly-closing@1"]')
  await app.choose(ui.year, '2026')
  await app.choose(ui.month, '4')
  await app.click('dc-button', ui.run)
  await app.cdp.waitFor(`!!__e2e.one('[data-section="0"] tr[data-row="completed"]')`, 'the month by closing reason')
  await shoot('closing')

  // A choice list: an item the list lacks, added to this vault and counted as an item of the list.
  await app.click('button', ui.choices)
  await app.click(`nav[aria-label="${ui.choices}"] button[data-entry="${L.extend.list}"]`)
  await app.type(ui.itemName, L.extend.label)
  await app.choose(ui.countedAs, L.extend.anchor)
  await app.click('dc-button', ui.addToList)
  await app.cdp.waitFor(`!!__e2e.one('tr[data-local-item]') || !!__e2e.one('[data-role=raise-format-confirm]')`, 'the item added, or the format asked about')
  if (await app.cdp.evaluate(`!!__e2e.one('[data-role=raise-format-confirm]')`)) {
    await app.click('[data-role=raise-format-confirm]')
    await app.cdp.waitFor(`!!__e2e.one('tr[data-local-item]')`, 'the item added')
  }
  await shoot('choices')

  // Sessions that used the added item, and the form that came with the list counting them by name.
  const added = { scheme: `local.${L.extend.list}`, version: 1, code: 'local-1' }
  for (const [i, day] of ['06', '13', '20'].entries()) {
    const topic = L.sequence[i]
    await invoke('record', { route: '/changes/in-subject', request: { subjectId: subjects[i], type: 'session', fields: {
      date: `2026-04-${day}`, practitioner: practitioners[i % practitioners.length],
      [locale === 'ko' ? 'topic' : 'concern']: coded(L.topic, topic),
      [locale === 'ko' ? 'method' : 'mode']: coded(L.method, L.methods[0]),
      note: L.notes[topic][0], ...L.sessionFields(topic, i, i), ...L.extend.fields(added) } } })
  }
  await app.folderAction(ui.refresh)
  await sleep(1500)
  await app.click('button', ui.report)
  await app.click(`nav[aria-label] button[data-entry="${L.extend.form}"]`)
  await app.choose(ui.year, '2026')
  await app.choose(ui.month, '4')
  await app.click('dc-button', ui.run)
  await app.cdp.waitFor(`!!__e2e.one('[data-section="0"] tr[data-row="local-1"]')`, 'the month by added item')
  await shoot('added')

  if (locale === 'ko') {
    // A school-year form: the sessions of the year by grade and class.
    await app.click('button', ui.report)
    await app.click('nav[aria-label="보고 양식"] button[data-entry="year-grade-class@1"]')
    await app.choose('학년도', '2026')
    await app.click('dc-button', ui.run)
    await app.cdp.waitFor(`!!__e2e.one('[data-section="0"] tr[data-row]')`, 'the school year by grade and class')
    await shoot('year')

    // Each assessment given in a month, by practitioner: a battery counts each of its assessments.
    await app.click('nav[aria-label="보고 양식"] button[data-entry="month-assessment-tool@1"]')
    await app.choose(ui.year, '2026')
    await app.choose(ui.month, '4')
    await app.click('dc-button', ui.run)
    await app.cdp.waitFor(`!!__e2e.one('[data-section="0"] tr[data-row="sct"]')`, 'the month by assessment')
    await shoot('assessment')
    await app.click('nav[aria-label="보고 양식"] button[data-entry="monthly-topic@1"]')

    // The NEIS upload list: the month's sessions in the upload's seventeen columns.
    await app.click('button', ui.lists)
    await app.click('nav[aria-label="목록 양식"] button[data-entry="neis-upload@1"]')
    await app.choose(ui.year, '2026')
    await app.choose(ui.month, '4')
    await app.click('dc-button', ui.makeList)
    await app.cdp.waitFor(`__e2e.all('tr[data-export-row]').length > 0 && __e2e.all('tr[data-export-row]')[0].children.length === 17`, 'the upload list')
    await shoot('neis')
    await app.click('button', ui.report)

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
    await app.cdp.evaluate(`(__e2e.one('section[data-role=comparison]')?.scrollIntoView({ block: 'start' }), true)`)
    await shoot('compare')
  }


  // Who the practitioner meets today: two sessions a week ago set today as the next session's day. Taken after the
  // forms, so no month or school year they lay out counts these sessions.
  const here = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const now = new Date()
  const weekAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7)
  for (const [i, subject] of [2, 4].entries()) {
    const topic = L.sequence[i]
    await invoke('record', { route: '/changes/in-subject', request: { subjectId: subjects[subject], type: 'session', fields: {
      date: here(weekAgo), practitioner: practitioners[i % practitioners.length],
      [locale === 'ko' ? 'topic' : 'concern']: coded(L.topic, topic),
      [locale === 'ko' ? 'method' : 'mode']: coded(L.method, L.methods[0]),
      note: L.notes[topic][0], ...L.sessionFields(topic, i, subject), next: here(now) } } })
  }
  await app.folderAction(ui.refresh)
  await sleep(1500)
  await app.click('button', ui.subjects)
  await app.click('dc-button[data-attention="today"]')
  await app.cdp.waitFor(`__e2e.all('.pane.list li').length === 2`, 'the list narrowed to who is met today')
  await app.click('li button .label', L.subjects[2])
  await shoot('today')
  await app.click('dc-button[data-attention="today"]')

  // Adding a person whose name is already here: who it may be, and a way to open them instead.
  await app.click('dc-button', ui.newSubject)
  await app.type(ui.subjectName, L.subjects[1])
  await app.cdp.waitFor(`!!__e2e.one('[data-role=already-here]')`, 'the person already here')
  await shoot('already')

  // The automatic backup, in another folder.
  const copy = join(work, locale === 'ko' ? '백업' : 'Backup')
  await mkdir(copy)
  await app.click('button', ui.devices)
  await app.click('button', ui.backup)
  await app.cdp.evaluate(`__e2e.one('oc-vault').setBackup(${q(copy)}).then(() => true)`)
  await app.cdp.waitFor(`!!__e2e.one('[data-role=backup-status]')`, 'the backup')
  await sleep(1500)
  await shoot('backup')

  // The app's own settings: its colours, language, new versions, the idle lock, what it sends.
  await app.click('button', ui.appSettings)
  await app.cdp.waitFor(`!!__e2e.one('[data-role=theme]')`, 'the settings')
  await shoot('settings')

  // What the vault holds that the scenes were not decided over: a kind of record or a form new since.
  const held = await app.cdp.evaluate(
    `(() => { const s = __e2e.one('oc-vault').store; return { kinds: s.kinds.map((k) => k.type), forms: [...s.summary.reports, ...s.summary.exports].map((f) => f.name) } })()`,
  )
  const knownFile = join(root, 'e2e', 'pictures-known.json')
  const known = existsSync(knownFile) ? JSON.parse(readFileSync(knownFile, 'utf8')) : {}
  if (args.includes('--update-known')) {
    known[locale] = { kinds: [...new Set(held.kinds)].sort(), forms: [...new Set(held.forms)].sort() }
    await writeFile(knownFile, `${JSON.stringify(known, null, 2)}\n`)
    console.log(`wrote what the ${locale} vault holds to ${knownFile}`)
  } else {
    const was = known[locale] ?? { kinds: [], forms: [] }
    const newKinds = held.kinds.filter((k) => !was.kinds.includes(k))
    const newForms = held.forms.filter((f) => !was.forms.includes(f))
    if (newKinds.length + newForms.length > 0)
      console.log(
        `note: new since the scenes were decided — ${[...newKinds.map((k) => `kind ${k}`), ...newForms.map((f) => `form ${f}`)].join(', ')}.` +
          ' Give each a scene, or add it to e2e/pictures-known.json (--update-known).',
      )
  }
} finally {
  if (theme) await invoke('set_theme', { theme: 'system' }).catch(() => {})
  await invoke('set_language', { language: null }).catch(() => {})
  await app.quit()
  await rm(work, { recursive: true, force: true }).catch(() => {})
}
console.log(`pictures in ${shots}`)

// The scenes whose text differs from an earlier run's: a line counts once for each time it shows.
const before = option('--compare')
if (before) {
  const read = (dir, name) => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8').split('\n').filter(Boolean) : null)
  const minus = (a, b) => {
    const left = [...b]
    return a.filter((line) => {
      const i = left.indexOf(line)
      if (i < 0) return true
      left.splice(i, 1)
      return false
    })
  }
  const scenes = [...new Set([...readdirSync(shots), ...readdirSync(resolve(before))].filter((f) => f.endsWith('.txt') && f !== 'changes.txt'))].sort()
  const report = []
  for (const file of scenes) {
    const scene = file.slice(0, -'.txt'.length)
    const [was, now] = [read(resolve(before), file), read(shots, file)]
    if (!was) report.push(`${scene}: new scene`)
    else if (!now) report.push(`${scene}: no longer taken`)
    else {
      const [added, gone] = [minus(now, was), minus(was, now)]
      if (added.length + gone.length === 0) continue
      report.push(`${scene}: +${added.length} -${gone.length}`, ...added.map((l) => `  + ${l}`), ...gone.map((l) => `  - ${l}`))
    }
  }
  await writeFile(join(shots, 'changes.txt'), report.length ? `${report.join('\n')}\n` : 'no scene changed\n')
  const changed = report.filter((l) => !l.startsWith('  '))
  console.log(changed.length ? `changed since ${before}:\n${changed.map((l) => `  ${l}`).join('\n')}` : `no scene changed since ${before}`)
}
