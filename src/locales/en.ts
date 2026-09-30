// The app's words in English — the table used when the system language has no table of its own.
import native from '../native-strings.json'
import type { VaultFileKind } from '../shell.js'
import type { Strings } from './index.js'

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export const en: Strings = {
  appName: 'Openquote Care',
  tagline: 'Records that carry on, figures you can trace',
  /** Shown by the shell, not the window: the web view runtime the window needs is missing. */
  webviewMissing: native.en.webviewMissing,
  diagnosticsNotice:
    'When the app itself fails, this installation sends the publisher only the kind of error, where in the code it happened and the app version. It never sends record content, file paths or vault names, and with no internet it drops the report instead of sending it.',

  createVault: 'Create a vault',
  openVault: 'Open a vault',
  pickFolder: 'Choose folder',
  pickCreateFolderTitle: 'Choose an empty folder for the new vault',
  pickOpenFolderTitle: 'Choose the vault folder to open',
  folder: 'Folder',
  noFolder: 'No folder chosen',
  passphrase: 'Passphrase',
  passphraseAgain: 'Passphrase again',
  recoveryKey: 'Recovery key',
  recoveryKeyHint: 'Type the vault key from the recovery kit (it begins with AGE-SECRET-KEY-1). Spaces and letter case do not matter.',
  openWithKey: 'Forgot the passphrase? Use the recovery key',
  openWithPassphrase: 'Back to the passphrase',
  passphraseHint: (min: number) => `At least ${min} characters. You type it each time you open the vault.`,
  create: 'Create',
  open: 'Open',
  back: 'Back',
  working: 'Working…',

  kitTitle: 'Recovery kit',
  kitLead: 'If you forget the passphrase, this key is the only way to open the records. Print it or copy it down now, and keep it safe.',
  kitKey: 'Vault key',
  kitWarnings: [
    'Anyone who has this key can read every record in the vault.',
    'Keep it under lock, as you would paper case notes.',
    'If both the passphrase and this key are lost, no one — not even the publisher — can open the records.',
  ],
  kitWithoutApp: 'To open without the app: save the vault key to key.txt and run the public tool age: age -d -i key.txt <file>.age',
  kitPassphraseChange: 'Changing the passphrase later leaves this key valid.',
  print: 'Print',
  kitConfirmLabel: (n: number) => `To confirm you kept it, type the last group of the vault key (${n} characters)`,
  kitConfirm: 'Confirm',

  unreadable: (n: number) => `${plural(n, 'file')} could not be read — another device may be writing ${n === 1 ? 'it' : 'them'}, or ${n === 1 ? 'it is' : 'they are'} damaged.`,
  /** What an unreadable file held; `holder` is the subject's or group's name when the vault knows it. */
  unreadableWhat: (f: VaultFileKind, holder?: string): string | undefined => {
    switch (f.kind) {
      case 'subject':
        return holder ? `Records of client ${holder}` : 'Records of a client whose name could not be read'
      case 'group':
        return holder ? `Records of group ${holder}` : 'Records of a group whose name could not be read'
      case 'practitioners':
        return 'Practitioner records'
      case 'devices':
        return 'Device names'
      case 'scheme':
        return `Classification ${f.name}, version ${f.version}`
      case 'crosswalk':
        return `Crosswalk for classification ${f.name}, version ${f.from} → ${f.to}`
      case 'report':
        return `Report form ${f.name}, version ${f.version}`
      case 'export':
        return `Export form ${f.name}, version ${f.version}`
      case 'pack':
        return `Contents of data pack ${f.name}, version ${f.version}`
      case 'labels':
        return `Labels of data pack ${f.name}, version ${f.version}`
      case 'fields':
        return `${f.type} fields of data pack ${f.name}, version ${f.version}`
      case 'run':
        return `Report runs of ${f.year}`
      case 'other':
        return undefined
    }
  },
  unreadableReason: {
    Undecryptable: 'Cannot be decrypted — it may have been cut short while syncing, or belong to another vault',
    Malformed: 'Content is cut short — another device may be writing it, or it is damaged',
    UnknownFormat: 'A format this version of the app does not know',
    Invalid: 'A required value is missing or wrong',
    NameMismatch: 'The name does not match the content — it may be a conflicted copy made by a sync program. Compare it with the original and delete it if it is not needed',
    DuplicateId: 'Different files carry the same record ID',
  } as Record<string, string>,
  closeVault: 'Close vault',
  lockNow: 'Lock now',
  locked: 'The vault is locked. Type the passphrase to go on. Anything not yet recorded was not kept.',
  idleLock: 'Automatic lock',
  idleOption: (minutes: number) => (minutes === 0 ? 'Never' : `After ${plural(minutes, 'minute')} without use`),
  idleLockLead: 'Applies to this computer only. When it locks, the vault key is cleared from memory and the passphrase opens it again.',
  cancel: 'Cancel',
  refresh: 'Reload',
  toggleSidebar: 'Collapse or expand the sidebar',
  navLabel: 'Navigation',
  navSubjects: 'Clients',
  navGroups: 'Groups',
  navPractitioners: 'Practitioners',
  navReport: 'Monthly report',
  navExport: 'Record lists',
  navDevices: 'Devices',

  report: 'Monthly report',
  reportForm: 'Form',
  reportFormOption: (label: string, version: number) => `${label} (v${version})`,
  year: 'Year',
  month: 'Month',
  monthOption: (m: number) => new Date(2000, m - 1, 1).toLocaleString('en', { month: 'long' }),
  runReport: 'Run',
  noReports: 'This vault has no report forms.',
  reportPeriod: (from: string, to: string) => `Period ${from} – ${to} · The run is kept in the vault.`,
  reportRow: 'Category',
  reportTotal: 'Total',

  exportTitle: 'Export a record list',
  exportLead: "Lists a month's sessions in the form's column order. Copy the table and paste it into your organization's upload spreadsheet or another form. Nothing is kept in the vault.",
  exportForm: 'List form',
  makeExport: 'Make list',
  copyExport: 'Copy table',
  exportCopied: (n: number) => `Copied ${plural(n, 'row')} and the heading row. Paste into a spreadsheet.`,
  exportPeriod: (from: string, to: string, n: number) => `Period ${from} – ${to} · ${plural(n, 'row')}`,
  exportEmpty: 'No sessions were recorded in this period.',
  exportWithheld: (columns: string[]) =>
    `The ${columns.join(', ')} ${columns.length === 1 ? 'column is' : 'columns are'} left empty because ${columns.length === 1 ? 'it holds' : 'they hold'} session content. Content does not leave the app.`,
  exportGaps: (pending: number, unmapped: number) =>
    `Some rows have an empty category — ${pending} awaiting reclassification, ${unmapped} not in this form's classification version. Settle those awaiting in the monthly report; if the classification was revised, use the new version of the list form.`,
  noExports: 'This vault has no list forms. Applying a data pack adds them.',
  headCount: (n: number) => ` (${plural(n, 'person', 'people')})`,
  headCountHint: 'The number in brackets is people — each person once, and each participant of a group session.',
  noValue: (label: string) => `(No ${label.toLowerCase()})`,
  reportCount: 'Count',
  pending: 'Awaiting reclassification',
  pendingHint: 'The classification changed and a record could go to more than one new category. It is counted once a person chooses.',
  unmapped: 'Not mapped',
  unmappedHint: 'Records in an old category that the crosswalk does not carry forward. Check the classification material.',
  grandTotal: 'All',
  evidence: (what: string, n: number) => `${what} — ${plural(n, 'record')} behind it`,
  evidenceSubject: 'Client',
  pickCell: 'Select a count in the table to see the records it is made of.',
  reclassifyTitle: (n: number) => `${plural(n, 'record')} awaiting reclassification — choose the new category`,
  reclassifyLead:
    'The classification was revised and one old category split into several new ones. The app does not guess. Choose one for each record: the original category stays, and the new one is added.',
  reclassifyWas: 'Earlier category',
  reclassifyTo: 'New category',
  reclassified: 'Confirm',
  reclassifiedNotice: (n: number) => `Confirmed ${plural(n, 'reclassification')}. Run the report again to see ${n === 1 ? 'it' : 'them'} in the table.`,
  compareWith: 'Compare with an earlier run',
  compare: 'Compare',
  noEarlierRun: 'There is no earlier run of this form and period.',
  runOption: (at: string, version: number, total: number) => `${at.slice(0, 16).replace('T', ' ')} · v${version} · all ${total}`,
  comparisonTitle: (earlierVersion: number, laterVersion: number) => `How this run (v${laterVersion}) differs from the earlier run (v${earlierVersion})`,
  comparisonCounts: (late: number, removed: number, revised: number, moved: number, unchanged: number) =>
    `Entered late ${late} · Dropped ${removed} · Classification revised ${revised} · Record edited ${moved} · Unchanged ${unchanged}`,
  changeKind: { late: 'Entered late', removed: 'Dropped', revised: 'Classification revised', moved: 'Record edited' },
  changeKindHeader: 'Change',
  noDifference: 'Every record sits in the same place in both runs.',
  changeKindHint: {
    late: 'Recorded after the earlier run.',
    removed: 'Deleted after the earlier run, or no longer in the period.',
    revised: 'The record is unchanged; the crosswalk of a classification revision moved it.',
    moved: 'A person edited the category or practitioner of the record, so it moved.',
  },
  before: 'Earlier',
  after: 'Now',
  nowhere: '—',
  applyPack: 'Apply classification revision',
  applyPackTitle: 'Choose the data pack folder to apply',
  packAdded: (items: string[]) => `Added: ${items.join(', ')}`,
  packNothingNew: 'This material has no classifications or forms the vault does not already hold.',
  packFormsBehind: (forms: string[]) =>
    `No form follows the new classification version yet: ${forms.join(', ')}. Records after the revision stay empty or awaiting in these forms — apply material with new versions of the forms.`,
  packSchemeUnlinked: (versions: string[]) =>
    `Some classifications have no crosswalk from their previous version: ${versions.join(', ')}. Even a revision that only renames needs a crosswalk to carry earlier records forward — without one they are 'Not mapped' in forms on the new version.`,
  formBehind: (lags: { scheme: string; version: number; latest: number }[]) =>
    `This form follows ${lags.map((l) => `classification ${l.scheme} v${l.version}`).join(', ')} (the vault holds ${lags.map((l) => `v${l.latest}`).join(', ')}). Use it for months before the revision, and a form on the new version for records after it.`,
  definition: {
    scheme: (name: string, version: number) => `classification ${name} v${version}`,
    crosswalk: (name: string, from: number, to: number) => `crosswalk ${name} v${from}→v${to}`,
    report: (name: string, version: number) => `form ${name} v${version}`,
    export: (name: string, version: number) => `export form ${name} v${version}`,
    pack: (name: string, version: number) => `data pack ${name} v${version}`,
    labels: (name: string, version: number, locale: string) => `labels ${name} v${version} (${locale})`,
    fields: (name: string, version: number, type: string) => `field definitions ${name} v${version} (${type})`,
  },
  /** A pack whose manifest came along: named by its label rather than by its files. */
  packApplied: (label: string, version: number) => `Applied data pack “${label}”, version ${version}.`,
  adopted: (tracks: string[]) =>
    `Brought this vault onto the “${tracks.join(', ')}” data packs, which define its fields. Records and classifications already here are unchanged.`,
  packIssues: (n: number) => `Data packs disagree in ${plural(n, 'place')}. Check whether a pack or file is missing.`,

  subjects: 'Clients',
  noSubjects: 'No clients yet. Type a name to add one.',
  subjectName: 'Client name',
  addSubject: 'Add client',
  pickSubject: 'Choose a client to see their sessions here.',
  importPaste: '📋 Copy a table of clients from a spreadsheet (with its heading row) and paste it here to add many at once',
  importTitle: 'Pasted clients',
  importTally: (create: number, update: number, same: number, problem: number) =>
    `New ${create} · Updated ${update} · Unchanged ${same} · Problems ${problem}`,
  importMissingName: 'There is no name column. Add a column headed "Name" and paste again.',
  importUnknown: (headings: string[]) => `Columns not read: ${headings.join(', ')} — the app does not keep these fields.`,
  importCreate: 'New',
  importUpdate: 'Update',
  importSame: 'Unchanged',
  importNoName: 'The name is empty',
  importRepeated: (line: number) => `Same client as row ${line}`,
  importAmbiguous: (name: string) => `More than one client is called "${name}" — add an ID column`,
  importApply: (create: number, update: number) => `Import (new ${create} · updated ${update})`,
  imported: (create: number, update: number) => `Added ${plural(create, 'client')} and updated ${update}.`,
  sessions: (name: string) => `${name} — sessions`,
  noSessions: 'No sessions recorded.',
  newSession: 'New session',
  none: '(None)',
  noFieldDefinitions: 'This vault has no session field definitions. Apply a data pack that defines them.',
  addFirst: (label: string) => `Before recording a session, add at least one: ${label}.`,
  missing: (label: string) => `Fill in “${label}”.`,
  showNote: (label: string) => `Show ${label}`,
  hideNote: (label: string) => `Hide ${label}`,
  recordSession: 'Record session',
  sessionCount: (n: number) => plural(n, 'session'),
  conflict: 'Edited on two devices',
  conflictTitle: 'Fields changed on two devices without seeing each other',
  conflictLead: 'Both values are kept. Choose the right one and every device settles on it.',
  conflictMissingBase:
    'Some changes written on another device have not reached this one yet. When syncing finishes this may clear by itself — if it is not urgent, wait a little before choosing.',
  conflictFrom: (device: string) => device,
  conflictResolved: 'The conflicting edit is settled.',

  devices: 'Devices',
  devicesLead:
    'Name each device that uses this vault, and a field changed on two devices without seeing each other shows which device each value came from. Names are recorded in the vault, so every device sees them.',
  deviceName: 'Name of this device',
  saveDeviceName: 'Save',
  deviceNameSaved: 'The name of this device is saved.',
  thisDevice: 'This device',
  thisDeviceNamed: (name: string) => `This device (${name})`,
  unnamedDevice: (id: string) => `Unnamed device ${id}`,
  knownDevices: 'Named devices',
  changePassphrase: 'Change passphrase',
  changePassphraseLead:
    'Every device sharing the vault will open it with the new passphrase, and the previous one stops working. The records and the recovery kit stay as they are.',
  newPassphrase: 'New passphrase',
  newPassphraseAgain: 'New passphrase again',
  passphraseChanged: 'The passphrase is changed. Use the new passphrase on other devices too.',
  openedWithKey: 'Opened with the recovery key. If you forgot the passphrase, set a new one now.',
  goChangePassphrase: 'Set a new passphrase',
  nameThisDevice: 'This vault is shared with other devices. Name this device too, and edits show which device made them.',
  goNameThisDevice: 'Name it',
  noNamedDevices: 'No device is named yet.',

  groups: 'Groups',
  noGroups: 'No groups yet. Type a name to add one. Record group sessions — meeting several clients at once — here.',
  groupName: 'Group name',
  addGroup: 'Add group',
  pickGroup: 'Choose a group to see its members and sessions here.',
  groupMembers: 'Members',
  saveMembers: 'Save members',
  attendees: 'Participants',

  practitioners: 'Practitioners',
  noPractitioners: 'No practitioners yet. The columns of the monthly report are split by practitioner.',
  practitionerName: 'Practitioner name',
  addPractitioner: 'Add practitioner',

  problems: {
    'passphrase-short': (min: number) => `The passphrase needs at least ${min} characters.`,
    'passphrase-mismatch': 'The two passphrases differ.',
    'no-folder': 'Choose a folder first.',
    'no-name': 'Type a name.',
    'no-attendees': 'Choose at least one participant.',
  },
  errors: {
    'no-vault': 'No vault is open.',
    'kit-not-confirmed': 'Confirm the recovery kit first.',
    'kit-mismatch': 'That does not match the end of the vault key. Check it again.',
    'not-a-pack': 'This folder holds no classification or report form material.',
    'pack-conflict': 'The vault already holds a different classification or form under the same name, so nothing was applied. Check the version of the material.',
    'already-exists': 'This folder already holds a vault. Use Open a vault.',
    'not-a-vault': 'This folder is not a vault.',
    'newer-format': 'This vault was made by a newer version of the app. Update the app, then open it.',
    'not-encrypted': 'A vault without encryption cannot be opened yet.',
    'wrong-passphrase': 'The passphrase is not right. If it was changed on another device, type the new passphrase.',
    'damaged-key-file': 'The vault key file is damaged. Open the vault with the recovery kit.',
    'recovery-key': 'The recovery key is not right.',
    'invalid-path': 'That path is outside the vault.',
    'not-a-choice': 'This record no longer awaits that category — another device may have chosen already. Open the list of records awaiting again.',
    bundle: 'The data packs that come with the app could not be read. The app may need to be installed again.',
    'engine-start': 'The record engine did not start. The app may need to be installed again.',
    engine: 'The record engine could not handle the request.',
    io: 'A file could not be read or written.',
    unknown: 'The task could not be finished.',
  },
  errorDetail: (message: string) => `Details: ${message}`,
}
