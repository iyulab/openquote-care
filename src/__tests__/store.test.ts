import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FieldView } from '../fields.js'
import { today, type Entity } from '../records.js'
import type { VaultSummary } from '../shell.js'
import { strings } from '../strings.js'

vi.mock('../shell.js', () => ({
  shell: {
    entities: vi.fn(),
    schemes: vi.fn(),
    fields: vi.fn(),
    summary: vi.fn(),
    refresh: vi.fn(),
    backupStatus: vi.fn(),
    history: vi.fn(),
    setBackup: vi.fn(),
    onVaultChanged: vi.fn(),
    applyPack: vi.fn(),
  },
}))

import { shell } from '../shell.js'
import { VaultStore } from '../vault/store.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

const subject = (id: string, name: string): Entity => ({ type: 'subject', id, subject: id, group: null, people: [id], fields: { name }, conflicts: {} })

const summary: VaultSummary = { unreadable: [], reports: [], exports: [], unlinked: [], device: 'd1', devices: {}, packs: [], packIssues: [], locales: [], kinds: [] }

/** Every read answers at once: `subjects` for subjects, nothing for the rest. */
function vaultHolds(subjects: Entity[]) {
  vi.mocked(shell.entities).mockImplementation(async (type) => (type === 'subject' ? subjects : []))
}

describe('VaultStore', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vaultHolds([])
    vi.mocked(shell.schemes).mockResolvedValue([])
    vi.mocked(shell.fields).mockResolvedValue([])
    vi.mocked(shell.summary).mockResolvedValue(summary)
    vi.mocked(shell.refresh).mockResolvedValue(summary)
    vi.mocked(shell.backupStatus).mockResolvedValue({ folder: null })
    vi.mocked(shell.history).mockResolvedValue([])
  })

  it('never shows a form the vault does not offer, nor picks it first', async () => {
    const form = (name: string, offered: boolean) => ({
      name, version: 1, label: name, behind: [], offered, counts: 'session', periodField: 'date', unit: 'month' as const, startMonth: 1,
      dimensions: [{ field: 'topic', scheme: 'topic', version: 1, ofSubject: false, all: false }], measures: ['records' as const], sums: [], filters: [],
    })
    vi.mocked(shell.summary).mockResolvedValue({ ...summary, reports: [form('hidden', false), form('shown', true)], exports: [form('hidden', false)] })
    const store = new VaultStore()

    await store.load()

    expect(store.summary?.reports.map((f) => f.name)).toEqual(['shown'])
    expect(store.summary?.exports).toEqual([])
    expect(store.reportKey).toBe('shown@1')
    expect(store.exportKey).toBeFalsy()
  })

  it('starts the form with today and the only practitioner, and keeps them when it clears', async () => {
    const field = (name: string, kind: FieldView['kind'], refType: string | null = null): FieldView => ({
      name, kind, scheme: kind === 'coded' ? name : null, refType, required: true, hidden: false, tier: 'structured', defaultFromSubject: null, label: name, aliases: [],
    })
    vi.mocked(shell.fields).mockImplementation(async (type) =>
      type === 'session' ? [field('date', 'date'), field('practitioner', 'reference', 'practitioner'), field('topic', 'coded')] : [],
    )
    vi.mocked(shell.entities).mockImplementation(async (type) => (type === 'practitioner' ? [{ ...subject('p1', 'Kim'), type: 'practitioner' }] : []))
    const store = new VaultStore()

    await store.load()
    expect(store.draft).toEqual({ date: today(), practitioner: 'p1' })

    store.editDraft({ topic: 'peer', date: '2026-04-02' })
    store.clearDraft()
    expect(store.draft).toEqual({ date: '2026-04-02', practitioner: 'p1' })
  })

  it('starts the form from the fixed values the vault gives fields, and again after it clears', async () => {
    const field = (name: string, kind: FieldView['kind'], more: Partial<FieldView> = {}): FieldView => ({
      name, kind, scheme: kind === 'coded' ? name : null, refType: null, required: false, hidden: false, tier: 'structured', defaultFromSubject: null, label: name, aliases: [], ...more,
    })
    vi.mocked(shell.fields).mockImplementation(async (type) =>
      type === 'session' ? [field('date', 'date', { required: true }), field('with', 'coded', { defaultValue: 'client' }), field('minutes', 'number', { defaultValue: '50' })] : [],
    )
    const store = new VaultStore()

    await store.load()
    expect(store.draft).toEqual({ date: today(), with: 'client', minutes: '50' })

    // A person's choice stands while the form is open, a vault read included.
    store.editDraft({ with: 'parent', minutes: '' })
    await store.load()
    expect(store.draft).toMatchObject({ with: 'parent', minutes: '' })

    store.clearDraft()
    expect(store.draft).toEqual({ date: today(), with: 'client', minutes: '50' })
  })

  it('knows a value came from a suggestion until a person changes it or the form clears', () => {
    const store = new VaultStore()

    store.editDraft({ topic: 'family' }, 'suggestion')
    store.editDraft({ note: 'words' })
    expect([...store.suggested]).toEqual(['topic'])

    store.editDraft({ topic: 'learning' })
    expect(store.suggested.size).toBe(0)

    store.editDraft({ topic: 'family' }, 'suggestion')
    store.clearDraft()
    expect(store.suggested.size).toBe(0)
  })

  it('reads every kind of record the packs keep under subjects or groups, with its fields and corrections', async () => {
    const field = (name: string, kind: FieldView['kind']): FieldView => ({
      name, kind, scheme: kind === 'coded' ? name : null, refType: null, required: kind === 'date', hidden: false, tier: 'structured', defaultFromSubject: null, label: name, aliases: [],
    })
    const referral: Entity = { type: 'referral', id: 'r1', subject: 's1', group: null, people: ['s1'], fields: { date: '2026-04-02', to: 'medical' }, conflicts: {} }
    vi.mocked(shell.summary).mockResolvedValue({
      ...summary,
      kinds: [
        { type: 'session', label: null, under: ['subject', 'group'] },
        { type: 'referral', label: 'Referral', under: ['subject'] },
      ],
    })
    vi.mocked(shell.entities).mockImplementation(async (type) => (type === 'referral' ? [referral] : []))
    vi.mocked(shell.fields).mockImplementation(async (type) => (type === 'referral' ? [field('date', 'date'), field('to', 'coded')] : []))
    vi.mocked(shell.history).mockImplementation(async (type) =>
      type === 'referral' ? [{ id: 'r1', changes: [{ op: 'create' }, { op: 'update' }] }] as Awaited<ReturnType<typeof shell.history>> : [],
    )
    const store = new VaultStore()

    await store.load()

    expect(store.kindsUnder('subject').map((k) => k.type)).toEqual(['session', 'referral'])
    expect(store.kindsUnder('group').map((k) => k.type)).toEqual(['session'])
    expect(store.recordsOf('referral')).toEqual([referral])
    expect(store.fieldsOf('referral').map((f) => f.name)).toEqual(['date', 'to'])
    expect(store.corrected.has('r1')).toBe(true)
    expect(store.draftOf('referral')).toEqual({ date: today() })
  })

  it('keeps a draft of its own for each kind of record', () => {
    const store = new VaultStore()

    store.editDraft({ topic: 'family' }, 'suggestion')
    store.editDraft({ to: 'medical' }, 'suggestion', 'referral')
    expect(store.draftOf('session')).toEqual({ topic: 'family' })
    expect(store.draftOf('referral')).toEqual({ to: 'medical' })
    expect([...store.suggestedOf('referral')]).toEqual(['to'])

    store.clearDraft('referral')
    expect(store.draftOf('referral')).toEqual({})
    expect(store.draft).toEqual({ topic: 'family' })
    expect([...store.suggested]).toEqual(['topic'])
  })

  it('drops a read overtaken by a newer one', async () => {
    const answers = [deferred<Entity[]>(), deferred<Entity[]>()]
    const reads = [...answers]
    vi.mocked(shell.entities).mockImplementation((type) => (type === 'subject' ? reads.shift()!.promise : Promise.resolve([])))
    const store = new VaultStore()

    const older = store.load()
    const newer = store.load()
    answers[1].resolve([subject('b', 'newer')])
    await newer
    answers[0].resolve([subject('a', 'older')])
    await older

    expect(store.subjects.map((s) => s.id)).toEqual(['b'])
  })

  it('run clears the error and holds busy until the action ends', async () => {
    const store = new VaultStore()
    await store.run(async () => {
      throw new Error('failed')
    })
    expect(store.error).toBeDefined()

    const seen: boolean[] = []
    store.addEventListener('change', () => seen.push(store.busy))
    const action = deferred<void>()
    const running = store.run(() => action.promise)
    expect(store.busy).toBe(true)
    expect(store.error).toBeUndefined()

    action.resolve()
    await running
    expect(store.busy).toBe(false)
    expect(seen[0]).toBe(true)
    expect(seen.at(-1)).toBe(false)
  })

  it('an outside change during an action is read after it', async () => {
    let outsideChange!: () => void
    vi.mocked(shell.onVaultChanged).mockImplementation(async (f) => {
      outsideChange = f
      return () => {}
    })
    const store = new VaultStore()
    store.connect()
    await vi.waitFor(() => expect(store.busy).toBe(false))

    const action = deferred<void>()
    const running = store.run(() => action.promise)
    vaultHolds([subject('a', 'written elsewhere')])
    outsideChange()
    expect(shell.refresh).not.toHaveBeenCalled()

    action.resolve()
    await running
    await vi.waitFor(() => expect(store.subjects.map((s) => s.id)).toEqual(['a']))
    expect(shell.refresh).toHaveBeenCalledTimes(1)
    store.disconnect()
  })

  it('reads the vault again when taken back to without making the window busy, so a click that brings it back still lands', async () => {
    const store = new VaultStore()
    await store.load()
    const busy: boolean[] = []
    store.addEventListener('change', () => busy.push(store.busy))
    vaultHolds([subject('a', 'written elsewhere')])
    await store.takeIn()
    expect(shell.refresh).toHaveBeenCalledTimes(1)
    expect(store.subjects.map((s) => s.id)).toEqual(['a'])
    expect(busy).not.toContain(true)
  })

  it('a change that arrives while another is taken in is read after it, so the window ends on the newest', async () => {
    let outsideChange!: () => void
    vi.mocked(shell.onVaultChanged).mockImplementation(async (f) => {
      outsideChange = f
      return () => {}
    })
    const store = new VaultStore()
    store.connect()
    await vi.waitFor(() => expect(store.busy).toBe(false))

    // The first reading fails part-way (a file went away while it was read); a second change
    // arrives meanwhile.
    const first = deferred<VaultSummary>()
    vi.mocked(shell.refresh).mockReturnValueOnce(first.promise)
    vaultHolds([subject('a', 'added elsewhere')])
    outsideChange()
    outsideChange()
    expect(shell.refresh).toHaveBeenCalledTimes(1)

    vaultHolds([])
    first.resolve(Promise.reject({ code: 'io', message: 'gone' }) as unknown as VaultSummary)
    await vi.waitFor(() => expect(shell.refresh).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(store.subjects).toEqual([]))
    store.disconnect()
  })

  it('asks before applying a pack that raises the vault to a newer format, and applies it once told to', async () => {
    const store = new VaultStore()
    await store.load()
    vi.mocked(shell.applyPack).mockRejectedValueOnce({ code: 'needs-new-format', message: 'the pack needs vault format 1' })

    await store.applyPack('D:/packs/v1')

    expect(store.raiseFormatFor).toBe('D:/packs/v1')
    expect(store.error).toBeUndefined()
    expect(shell.applyPack).toHaveBeenLastCalledWith('D:/packs/v1', false)

    vi.mocked(shell.applyPack).mockResolvedValueOnce(['fields/y/session/v1.json'])
    await store.applyPack('D:/packs/v1', true)

    expect(shell.applyPack).toHaveBeenLastCalledWith('D:/packs/v1', true)
    expect(store.raiseFormatFor).toBeUndefined()
  })

  it('offers a form a pack brought, unless the vault does not offer it', async () => {
    const form = (name: string, offered: boolean) => ({
      name, version: 1, label: name, behind: [], offered, counts: 'session', periodField: 'date', unit: 'month' as const, startMonth: 1,
      dimensions: [{ field: 'topic', scheme: 'topic', version: 1, ofSubject: false, all: false }], measures: ['records' as const], sums: [], filters: [],
    })
    vi.mocked(shell.summary).mockResolvedValue({ ...summary, reports: [form('monthly', true), form('by-level', true), form('hidden', false)] })
    const store = new VaultStore()
    await store.load()
    store.set({ reportKey: 'monthly@1' })

    vi.mocked(shell.applyPack).mockResolvedValueOnce(['reports/hidden/v1.json'])
    await store.applyPack('D:/packs/a')
    expect(store.reportKey).toBe('monthly@1')

    vi.mocked(shell.applyPack).mockResolvedValueOnce(['reports/hidden/v1.json', 'reports/by-level/v1.json'])
    await store.applyPack('D:/packs/b')
    expect(store.reportKey).toBe('by-level@1')
  })

  it("counts a pack's missing file as a disagreement, and not one the vault holds but could not read", async () => {
    const issue = (kind: string, detail: string) => ({ kind, pack: 'care', detail })
    vi.mocked(shell.summary).mockResolvedValue({ ...summary, packIssues: [issue('FileNotRead', 'exports/upload/v1.json')] })
    const store = new VaultStore()
    vi.mocked(shell.applyPack).mockResolvedValueOnce(['schemes/topic/v2.json'])
    await store.applyPack('D:/packs/a')
    expect(store.notice).not.toContain(strings.packIssues(1))

    vi.mocked(shell.summary).mockResolvedValue({
      ...summary,
      packIssues: [issue('FileNotRead', 'exports/upload/v1.json'), issue('MissingFile', 'schemes/mode/v1.json')],
    })
    vi.mocked(shell.applyPack).mockResolvedValueOnce(['schemes/topic/v2.json'])
    await store.applyPack('D:/packs/b')
    expect(store.notice).toContain(strings.packIssues(1))
  })
})
