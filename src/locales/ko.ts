// The app's words in Korean. Every table in this folder has the same keys (a test holds them to it);
// what a data pack names — scheme items, fields, forms — comes from the vault, not from here.
import native from '../native-strings.json'
import type { VaultFileKind } from '../shell.js'

// 을 after a final consonant, 를 after a vowel; a word that does not end in Hangul gets both.
const objectParticle = (word: string) => {
  const last = word.trim().charCodeAt(word.trim().length - 1)
  if (last < 0xac00 || last > 0xd7a3) return '을(를)'
  return (last - 0xac00) % 28 === 0 ? '를' : '을'
}

export const ko = {
  appName: 'Openquote Care',
  tagline: '이어지는 기록, 근거 있는 통계',
  /** Shown by the shell, not the window: the web view runtime the window needs is missing. */
  webviewMissing: native.ko.webviewMissing,
  diagnosticsNotice:
    '이 설치본은 앱 자체 오류가 나면 오류 종류·코드 위치·앱 버전만 발행자에게 보냅니다. 기록 내용·파일 경로·폴더 이름은 보내지 않으며, 인터넷이 없으면 보내지 않고 버립니다.',

  createVault: '새 기록 폴더 만들기',
  openVault: '기록 폴더 열기',
  pickFolder: '폴더 선택',
  pickCreateFolderTitle: '기록 폴더로 쓸 빈 폴더 선택',
  pickOpenFolderTitle: '열 기록 폴더 선택',
  folder: '폴더',
  noFolder: '선택한 폴더가 없습니다',
  passphrase: '암호',
  passphraseAgain: '암호 다시 입력',
  recoveryKey: '복구 키',
  recoveryKeyHint: '복구 키트에 적힌 복구 키(AGE-SECRET-KEY-1로 시작)를 입력하세요. 띄어쓰기와 대소문자는 상관없습니다.',
  openWithKey: '암호를 잊었나요? 복구 키 입력',
  openWithPassphrase: '암호 입력으로 돌아가기',
  passphraseHint: (min: number) => `${min}자 이상. 기록 폴더를 열 때마다 입력합니다.`,
  create: '만들기',
  track: '분야와 지역',
  trackHint: '기록 폴더가 처음 갖출 칸·분류·양식의 묶음입니다. 만든 뒤에도 데이터 팩을 적용해 넓힐 수 있습니다.',
  open: '열기',
  back: '뒤로',
  working: '처리하고 있습니다…',

  kitTitle: '복구 키트',
  kitLead: '암호를 잊으면 이 키로만 기록을 열 수 있습니다. 지금 인쇄하거나 옮겨 적어 보관하세요.',
  kitKey: '복구 키',
  kitWarnings: [
    '이 키를 가진 사람은 이 기록 폴더의 모든 기록을 읽을 수 있습니다.',
    '잠금장치가 있는 곳에 보관하세요(상담일지 수기 기록과 같은 기준).',
    '암호와 이 키를 모두 잃으면 누구도, 개발사도 기록을 열 수 없습니다.',
  ],
  kitWithoutApp: '앱 없이 여는 방법(전산 담당자에게 보여 주세요): 공개 도구 age로 복구 키를 key.txt에 저장한 뒤 age -d -i key.txt <파일>.age 를 실행합니다.',
  kitPassphraseChange: '암호를 바꿔도 이 키는 그대로 유효합니다.',
  print: '인쇄',
  kitConfirmLabel: (n: number) => `보관했는지 확인: 복구 키의 마지막 묶음(${n}자)을 입력하세요`,
  kitConfirm: '확인',

  unreadable: (n: number) => `읽지 못한 파일 ${n}개 — 다른 기기에서 쓰는 중이거나 손상되었을 수 있습니다.`,
  /** What an unreadable file held; `holder` is the subject's or group's name when the vault knows it. */
  unreadableWhat: (f: VaultFileKind, holder?: string): string | undefined => {
    switch (f.kind) {
      case 'subject':
        return holder ? `대상자 ${holder}의 기록` : '이름을 읽지 못한 대상자의 기록'
      case 'group':
        return holder ? `집단 ${holder}의 기록` : '이름을 읽지 못한 집단의 기록'
      case 'practitioners':
        return '담당자 기록'
      case 'devices':
        return '기기 이름 기록'
      case 'scheme':
        return `분류 ${f.name} ${f.version}판`
      case 'crosswalk':
        return `분류 ${f.name} ${f.from}판→${f.to}판 연계표`
      case 'report':
        return `보고 양식 ${f.name} ${f.version}판`
      case 'export':
        return `내보내기 양식 ${f.name} ${f.version}판`
      case 'pack':
        return `데이터 팩 ${f.name} ${f.version}판의 목록`
      case 'labels':
        return `데이터 팩 ${f.name} ${f.version}판의 이름표`
      case 'fields':
        return `데이터 팩 ${f.name} ${f.version}판의 ${f.type} 칸 정의`
      case 'run':
        return `${f.year}년 보고 산출 기록`
      case 'other':
        return undefined
    }
  },
  unreadableReason: {
    Undecryptable: '열 수 없음 — 동기화 중 잘렸거나 다른 기록 폴더의 파일일 수 있습니다',
    Malformed: '내용이 끊김 — 다른 기기에서 쓰는 중이거나 손상되었을 수 있습니다',
    UnknownFormat: '이 버전의 앱이 모르는 형식입니다',
    Invalid: '필요한 값이 없거나 잘못되었습니다',
    NameMismatch: '이름이 내용과 맞지 않음 — 동기화 프로그램이 만든 충돌 사본일 수 있습니다. 원본과 비교해 필요 없으면 지우세요',
    DuplicateId: '같은 기록 ID의 서로 다른 파일이 있습니다',
  } as Record<string, string>,
  closeVault: '기록 폴더 닫기',
  lockNow: '지금 잠그기',
  locked: '기록 폴더를 잠갔습니다. 계속하려면 암호를 입력하세요. 기록하지 않은 입력은 남지 않습니다.',
  idleLock: '자동 잠금',
  idleOption: (minutes: number) => (minutes === 0 ? '사용 안 함' : `${minutes}분 동안 사용하지 않으면`),
  idleLockLead: '이 컴퓨터에만 적용됩니다. 잠기면 열려 있던 기록이 화면에서 사라지고, 암호를 입력해야 다시 볼 수 있습니다.',
  cancel: '취소',
  backToList: '← 목록으로',
  refresh: '다시 읽기',
  toggleSidebar: '메뉴 접기/펼치기',
  navLabel: '탐색',
  navSubjects: '대상자',
  navGroups: '집단',
  navPractitioners: '담당자',
  navReport: '월 보고',
  navExport: '기록 목록',
  navDevices: '기기',

  report: '월 보고',
  reportForms: '보고 양식',
  pickReportForm: '양식을 고르면 그 양식의 월 보고가 여기에 보입니다.',
  reportForm: '양식',
  reportFormOption: (label: string, version: number) => `${label} (v${version})`,
  year: '연도',
  month: '월',
  monthOption: (m: number) => `${m}월`,
  runReport: '산출',
  noReports: '이 기록 폴더에는 보고 양식이 없습니다.',
  reportPeriod: (from: string, to: string) => `기간 ${from} ~ ${to} · 산출 결과를 기록 폴더에 남겼습니다.`,
  reportRow: '분류',
  reportTotal: '계',

  exportTitle: '기록 목록 내보내기',
  exportForms: '목록 양식',
  pickExportForm: '양식을 고르면 그 양식의 기록 목록이 여기에 보입니다.',
  exportLead: '한 달의 회기를 양식의 열 순서대로 늘어놓습니다. 표를 복사해 기관 업로드 엑셀이나 다른 양식에 붙여 넣으세요. 기록 폴더에는 아무것도 남지 않습니다.',
  exportForm: '목록 양식',
  makeExport: '목록 만들기',
  copyExport: '표 복사',
  exportCopied: (n: number) => `${n}행과 제목 행을 복사했습니다. 엑셀에 붙여 넣으세요.`,
  exportPeriod: (from: string, to: string, n: number) => `기간 ${from} ~ ${to} · ${n}행`,
  exportEmpty: '이 기간에 기록한 회기가 없습니다.',
  plainCopyEntry: '전체 기록 사본 (앱 없이 읽기)',
  plainCopyLead:
    '이 기록 폴더의 모든 대상자·회기·집단·담당자를 앱 없이 읽을 수 있는 파일로 고른 폴더에 남깁니다. 브라우저로 여는 기록 한 장과 엑셀로 여는 표 두 개, 설명 한 장입니다. 앱을 쓸 수 없게 되어도 기록을 읽을 수 있게 오래 보관할 때 씁니다.',
  plainCopyWarning: '이 사본에는 암호가 걸려 있지 않습니다. 누구나 열 수 있는 곳(공유 폴더·메일·클라우드 동기화 폴더)에 두지 마세요.',
  plainCopyNarrative: '상담 내용도 넣기',
  plainCopyNarrativeLead: '넣지 않으면 상담 내용 칸은 빠지고, 날짜·분류·담당자 같은 칸만 들어갑니다.',
  plainCopyMake: '사본 만들 폴더 선택',
  plainCopyPickTitle: '사본을 만들 폴더',
  plainCopyDone: (folder: string) => `사본을 만들었습니다: ${folder}`,
  plainCopy: {
    folder: (at: string) => `Openquote 기록 사본 ${at}`,
    files: { page: '기록.html', subjects: '대상자.csv', sessions: '회기.csv', readMe: '읽어보기.txt' },
    title: 'Openquote Care 기록 사본',
    made: (vault: string, at: string, device: string) => `기록 폴더 「${vault}」 · ${at} · ${device}에서 만듦`,
    unprotected: '이 사본에는 암호가 걸려 있지 않습니다. 보관하는 곳을 조심하세요.',
    narrativeLeftOut: '상담 내용 칸은 넣지 않았습니다.',
    subjects: '대상자',
    groups: '집단',
    practitioners: '담당자',
    name: '이름',
    people: '대상자',
    group: '집단',
    members: '구성원',
    noSessions: '회기가 없습니다.',
    readMe: (files: { page: string; subjects: string; sessions: string; readMe: string }, withNarrative: boolean) =>
      [
        'Openquote Care 기록 사본',
        '',
        '이 폴더는 Openquote Care 기록 폴더의 내용을 앱 없이 읽을 수 있게 풀어 쓴 사본입니다.',
        '암호가 걸려 있지 않으므로 보관하는 곳을 조심하세요. 원본은 여전히 기록 폴더입니다.',
        '',
        `${files.page} — 브라우저로 여세요. 대상자마다 칸 값과 회기(오래된 것부터)가 있습니다. 인쇄할 수 있습니다.`,
        `${files.subjects}, ${files.sessions} — 엑셀 등 표 프로그램으로 여세요(UTF-8).`,
        '',
        '분류 값은 「이름 (코드 · 분류 체계 v판)」으로 적었습니다. 분류 체계가 개정되어도 기록할 때의 코드와 판이 남습니다.',
        withNarrative ? '상담 내용 칸을 넣었습니다.' : '상담 내용 칸은 넣지 않았습니다.',
        '',
      ].join('\n'),
  },
  exportWithheld: (columns: string[]) => `${columns.join(', ')} 열은 상담 내용을 담는 칸이라 비워 두었습니다. 내용은 앱 밖으로 옮기지 않습니다.`,
  exportGaps: (pending: number, unmapped: number) =>
    `분류 칸을 비운 행이 있습니다 — 재분류 대기 ${pending}건, 이 양식의 분류 버전에 없음 ${unmapped}건. 대기는 월 보고에서 고르고, 분류가 개정되었다면 새 버전의 목록 양식을 쓰세요.`,
  noExports: '이 기록 폴더에는 목록 양식이 없습니다. 데이터 팩을 적용하면 생깁니다.',
  headCount: (n: number) => ` (${n}명)`,
  headCountHint: '건수 옆 괄호는 인원입니다 — 같은 사람은 한 번, 집단 상담은 참여자마다 셉니다.',
  noValue: (label: string) => `(${label} 없음)`,
  reportCount: '건수',
  pending: '재분류 대기',
  pendingHint: '분류 체계가 바뀌어 한 기록이 여러 새 분류로 갈 수 있습니다. 사람이 골라야 칸에 들어갑니다.',
  unmapped: '연계 없음',
  unmappedHint: '연계표에 없는 옛 분류의 기록입니다. 분류 체계 자료를 확인하세요.',
  blankHint: '이 칸을 비워 두고 기록했습니다. 전체에는 들고, 어느 줄에도 들지 않습니다.',
  grandTotal: '전체',
  evidence: (what: string, n: number) => `${what} — 근거 기록 ${n}건`,
  evidenceSubject: '대상자',
  pickCell: '칸의 수를 누르면 그 수를 이룬 기록이 여기에 보입니다.',
  reclassifyTitle: (n: number) => `재분류 대기 ${n}건 — 새 분류를 고르세요`,
  reclassifyLead: '분류 체계가 바뀌며 한 옛 분류가 여러 새 분류로 나뉘었습니다. 앱은 추정하지 않습니다. 기록마다 하나를 고르면 원래 분류는 그대로 남고 새 분류가 덧붙습니다.',
  reclassifyWas: '기존 분류',
  reclassifyTo: '새 분류',
  reclassified: '확정',
  reclassifiedNotice: (n: number) => `재분류 ${n}건을 확정했습니다. 산출을 다시 누르면 표에 반영됩니다.`,
  compareWith: '이전 산출과 비교',
  compare: '비교',
  noEarlierRun: '같은 양식·기간의 이전 산출 기록이 없습니다.',
  runOption: (at: string, version: number, total: number) => `${at.slice(0, 16).replace('T', ' ')} · v${version} · 전체 ${total}`,
  comparisonTitle: (earlierVersion: number, laterVersion: number) => `이전 산출(v${earlierVersion})과 지금 산출(v${laterVersion})의 차이`,
  comparisonCounts: (late: number, removed: number, revised: number, moved: number, unchanged: number) =>
    `늦게 입력 ${late} · 빠짐 ${removed} · 분류 개정 ${revised} · 기록 수정 ${moved} · 그대로 ${unchanged}`,
  changeKind: { late: '늦게 입력', removed: '빠짐', revised: '분류 개정', moved: '기록 수정' },
  changeKindHeader: '구분',
  noDifference: '두 산출의 기록이 모두 같은 자리에 있습니다.',
  changeKindHint: {
    late: '이전 산출 뒤에 입력된 기록입니다.',
    removed: '이전 산출 뒤에 지워졌거나 기간에서 벗어난 기록입니다.',
    revised: '기록은 그대로이고, 분류 체계 개정의 연계표가 새 자리로 옮겼습니다.',
    moved: '기록의 분류나 담당자를 사람이 고쳐 자리가 바뀌었습니다.',
  },
  before: '이전',
  after: '지금',
  nowhere: '—',
  applyPack: '분류 개정 적용',
  applyPackTitle: '적용할 분류 자료(데이터 팩) 폴더 선택',
  packAdded: (items: string[]) => `추가했습니다: ${items.join(', ')}`,
  packNothingNew: '이 자료에는 기록 폴더에 없는 새 분류·양식이 없습니다.',
  packFormsBehind: (forms: string[]) =>
    `새 분류 버전에 맞춘 양식이 없습니다: ${forms.join(', ')}. 개정 뒤 기록은 이 양식에서 빈칸이나 정리 대기로 남습니다 — 새 버전 양식이 든 자료를 적용하세요.`,
  packSchemeUnlinked: (versions: string[]) =>
    `이전 버전에서 이어지는 연계표가 없는 분류가 있습니다: ${versions.join(', ')}. 이름만 바꾼 개정이어도 연계표가 있어야 예전 기록이 새 버전으로 옮겨집니다 — 없으면 새 버전 양식에서 '연계 없음'이 됩니다.`,
  formBehind: (lags: { scheme: string; version: number; latest: number }[]) =>
    `이 양식은 ${lags.map((l) => `분류 ${l.scheme} v${l.version}`).join(', ')} 기준입니다(최신은 ${lags.map((l) => `v${l.latest}`).join(', ')}). 개정 전 달에는 그대로 쓰고, 개정 뒤 기록은 새 버전 양식으로 내세요.`,
  definition: {
    scheme: (name: string, version: number) => `분류 ${name} v${version}`,
    crosswalk: (name: string, from: number, to: number) => `연계표 ${name} v${from}→v${to}`,
    report: (name: string, version: number) => `양식 ${name} v${version}`,
    export: (name: string, version: number) => `내보내기 양식 ${name} v${version}`,
    pack: (name: string, version: number) => `데이터 팩 ${name} v${version}`,
    labels: (name: string, version: number, locale: string) => `이름표 ${name} v${version} (${locale})`,
    fields: (name: string, version: number, type: string) => `칸 정의 ${name} v${version} (${type})`,
  },
  /** A pack whose manifest came along: named by its label rather than by its files. */
  packApplied: (label: string, version: number) => `데이터 팩 「${label}」 ${version}판을 적용했습니다.`,
  adopted: (tracks: string[]) => `이 기록 폴더를 「${tracks.join(', ')}」 데이터 팩으로 맞추고 칸 정의를 더했습니다. 있던 기록과 분류는 그대로입니다.`,
  packIssues: (n: number) => `데이터 팩끼리 맞지 않는 곳이 ${n}곳 있습니다. 빠진 팩이나 파일이 있는지 확인하세요.`,

  subjects: '대상자',
  noSubjects: '대상자가 없습니다. 「새 대상자」로 추가하세요.',
  newSubject: '＋ 새 대상자',
  subjectName: '대상자 이름',
  addSubject: '대상자 추가',
  pickSubject: '대상자를 고르면 회기가 여기에 보입니다.',
  importPaste: '📋 엑셀의 대상자 표(제목 행 포함)를 복사해 여기에 붙여 넣으면 여러 명을 한 번에 추가합니다',
  importTitle: '붙여 넣은 대상자',
  importTally: (create: number, update: number, same: number, problem: number) =>
    `추가 ${create} · 갱신 ${update} · 그대로 ${same} · 문제 ${problem}`,
  importMissingName: '이름 열이 없습니다. 제목 행에 "이름" 열을 넣어 다시 붙여 넣으세요.',
  importUnknown: (headings: string[]) => `읽지 않는 열: ${headings.join(', ')} — 이 앱이 보관하지 않는 칸입니다.`,
  importCreate: '추가',
  importUpdate: '갱신',
  importSame: '그대로',
  importNoName: '이름이 비었습니다',
  importRepeated: (line: number) => `${line}행과 같은 대상자입니다`,
  importAmbiguous: (name: string) => `"${name}" 대상자가 여럿입니다 — 관리번호 열을 넣으세요`,
  importApply: (create: number, update: number) => `가져오기 (추가 ${create} · 갱신 ${update})`,
  imported: (create: number, update: number) => `대상자 ${create}명을 추가하고 ${update}명을 갱신했습니다.`,
  sessions: (name: string) => `${name} — 회기`,
  noSessions: '기록한 회기가 없습니다.',
  newSession: '새 회기',
  none: '(없음)',
  noFieldDefinitions: '이 기록 폴더에는 회기 칸 정의가 없습니다. 칸 정의가 담긴 데이터 팩을 적용하세요.',
  addFirst: (label: string) => `회기를 기록하려면 ${label}${objectParticle(label)} 먼저 추가하세요.`,
  missing: (label: string) => `‘${label}’ 칸을 채우세요.`,
  showNote: (label: string) => `${label} 보기`,
  hideNote: (label: string) => `${label} 접기`,
  recordSession: '회기 기록',
  sessionCount: (n: number) => `회기 ${n}건`,
  conflict: '동시 수정',
  conflictTitle: '두 기기에서 서로 모르게 고친 칸',
  conflictLead: '둘 다 보존되어 있습니다. 맞는 값을 고르면 모든 기기에서 그 값으로 정리됩니다.',
  conflictMissingBase: '다른 기기에서 쓴 변경 일부가 아직 이 기기에 오지 않았습니다. 동기화가 끝나면 이 동시 수정이 저절로 풀릴 수 있으니, 급하지 않다면 잠시 기다렸다 고르세요.',
  conflictFrom: (device: string) => device,
  conflictResolved: '동시 수정을 정리했습니다.',

  devices: '기기',
  settingsList: '설정 항목',
  passphraseSection: '암호',
  devicesLead: '이 기록 폴더를 쓰는 기기마다 이름을 붙여 두면, 두 기기에서 서로 모르게 고친 칸이 어느 기기의 것인지 이름으로 보입니다. 이름은 기록 폴더에 저장되어 모든 기기가 봅니다.',
  deviceName: '이 기기 이름',
  saveDeviceName: '저장',
  deviceNameSaved: '이 기기 이름을 저장했습니다.',
  thisDevice: '이 기기',
  thisDeviceNamed: (name: string) => `이 기기(${name})`,
  unnamedDevice: (id: string) => `이름 없는 기기 ${id}`,
  knownDevices: '이름이 붙은 기기',
  changePassphrase: '암호 바꾸기',
  changePassphraseLead: '이 기록 폴더를 함께 쓰는 모든 기기에서 새 암호로 열게 되고, 이전 암호로는 더 열리지 않습니다. 기록과 복구 키트는 그대로입니다.',
  newPassphrase: '새 암호',
  newPassphraseAgain: '새 암호 다시 입력',
  passphraseChanged: '암호를 바꿨습니다. 다른 기기에서도 새 암호로 여세요.',
  openedWithKey: '복구 키로 열었습니다. 암호를 잊었다면 지금 새로 정하세요.',
  goChangePassphrase: '새 암호 정하기',
  nameThisDevice: '이 기록 폴더를 다른 기기와 함께 쓰고 있습니다. 이 기기에도 이름을 붙이면 누가 고친 칸인지 이름으로 보입니다.',
  goNameThisDevice: '이름 붙이기',
  noNamedDevices: '아직 이름이 붙은 기기가 없습니다.',
  backup: '자동 백업',
  backupLead:
    '이 기록 폴더의 사본을 다른 폴더에 계속 맞춰 둡니다. 사본도 같은 암호와 복구 키로 열리는 기록 폴더이고, 암호를 바꾸면 사본도 새 암호로 열립니다. 이 기록 폴더와 떨어진 곳(다른 드라이브, USB 메모리)을 고르세요. 이 컴퓨터에만 적용됩니다.',
  backupChoose: '백업 폴더 선택',
  backupPickTitle: '백업을 둘 빈 폴더 선택',
  backupStop: '백업 끄기',
  backupOff: '사용하지 않습니다.',
  backupTo: (folder: string) => `백업 폴더: ${folder}`,
  backupDone: (at: string, copied: number) => `마지막 백업 ${at} · 새 파일 ${copied}개`,
  backupFailed: (reason: string) => `백업이 되지 않았습니다. ${reason} 기록은 이 기록 폴더에 그대로 저장됩니다.`,
  backupDiffers: (n: number) => `사본에 내용이 다른 파일이 ${n}개 있어 덮어쓰지 않았습니다. 새 빈 폴더에 백업을 다시 만드는 것이 안전합니다.`,

  groups: '집단',
  noGroups: '집단이 없습니다. 「새 집단」으로 추가하세요. 여러 대상자를 한 번에 만나는 집단 상담을 여기에 기록합니다.',
  newGroup: '＋ 새 집단',
  groupName: '집단 이름',
  addGroup: '집단 추가',
  pickGroup: '집단을 고르면 구성원과 회기가 여기에 보입니다.',
  groupMembers: '구성원',
  saveMembers: '구성원 저장',
  attendees: '참여자',

  practitioners: '담당자',
  noPractitioners: '담당자가 없습니다. 「새 담당자」로 추가하세요. 월 보고의 열은 담당자별로 나뉩니다.',
  newPractitioner: '＋ 새 담당자',
  pickPractitioner: '담당자를 고르면 맡은 회기가 여기에 보입니다.',
  practitionerName: '담당자 이름',
  addPractitioner: '담당자 추가',

  problems: {
    'passphrase-short': (min: number) => `암호는 ${min}자 이상이어야 합니다.`,
    'passphrase-mismatch': '두 암호가 다릅니다.',
    'no-folder': '폴더를 먼저 선택하세요.',
    'no-name': '이름을 입력하세요.',
    'no-attendees': '참여자를 한 명 이상 고르세요.',
  },
  errors: {
    'no-vault': '열린 기록 폴더가 없습니다.',
    'kit-not-confirmed': '복구 키트를 먼저 확인하세요.',
    'kit-mismatch': '복구 키의 마지막 글자와 다릅니다. 다시 확인하세요.',
    'not-a-pack': '이 폴더에는 분류나 보고 양식 자료가 없습니다.',
    'pack-conflict': '기록 폴더에 같은 이름의 다른 분류·양식이 이미 있어 아무것도 적용하지 않았습니다. 자료의 버전을 확인하세요.',
    'already-exists': '이 폴더는 이미 기록 폴더입니다. 기록 폴더 열기를 쓰세요.',
    'not-a-vault': '이 폴더는 기록 폴더가 아닙니다.',
    'newer-format': '이 기록 폴더는 더 새 버전의 앱으로 만들어졌습니다. 앱을 업데이트한 뒤 여세요.',
    'not-encrypted': '암호가 걸리지 않은 기록 폴더는 아직 열 수 없습니다.',
    'wrong-passphrase': '암호가 맞지 않습니다. 다른 기기에서 바꿨다면 새 암호를 입력하세요.',
    'damaged-key-file': '암호로 여는 데 쓰는 파일이 손상되었습니다. 복구 키로 여세요.',
    'recovery-key': '복구 키가 맞지 않습니다.',
    'invalid-path': '기록 폴더 밖의 파일입니다.',
    'backup-overlaps': '백업 폴더는 기록 폴더 안이나, 기록 폴더를 품은 폴더일 수 없습니다. 떨어진 폴더를 고르세요.',
    'backup-holds-other': '이 폴더에는 다른 파일이 있습니다. 빈 폴더나 이 기록 폴더의 백업 폴더를 고르세요.',
    'plain-copy-overlaps': '사본은 기록 폴더 안이나, 기록 폴더를 품은 폴더에 만들 수 없습니다. 떨어진 폴더를 고르세요.',
    'plain-copy-exists': '그 폴더에 같은 이름의 사본이 이미 있습니다. 잠시 뒤 다시 만들거나 다른 폴더를 고르세요.',
    'plain-copy-name': '사본 파일 이름을 만들 수 없습니다.',
    'not-a-choice': '이 기록은 더 이상 그 분류를 기다리지 않습니다. 다른 기기에서 이미 골랐을 수 있습니다. 대기 목록을 다시 여세요.',
    bundle: '앱에 들어 있는 데이터 팩을 읽지 못했습니다. 앱을 다시 설치해야 할 수 있습니다.',
    'engine-start': '기록 엔진이 시작되지 않았습니다. 앱을 다시 설치해야 할 수 있습니다.',
    engine: '기록 엔진이 요청을 처리하지 못했습니다.',
    io: '파일을 읽거나 쓰지 못했습니다.',
    unknown: '작업을 끝내지 못했습니다.',
  },
  errorDetail: (message: string) => `자세한 내용: ${message}`,
}
