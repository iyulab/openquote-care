import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Entity } from '../records.js'
import type { VaultSummary } from '../shell.js'

vi.mock('../shell.js', () => ({
  shell: {
    entities: vi.fn(),
    schemes: vi.fn(),
    summary: vi.fn(),
    refresh: vi.fn(),
    onVaultChanged: vi.fn(),
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

const summary: VaultSummary = { unreadable: [], reports: [], exports: [], unlinked: [], device: 'd1', devices: {}, packs: [], packIssues: [], locales: [] }

/** Every read answers at once: `subjects` for subjects, nothing for the rest. */
function vaultHolds(subjects: Entity[]) {
  vi.mocked(shell.entities).mockImplementation(async (type) => (type === 'subject' ? subjects : []))
}

describe('VaultStore', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vaultHolds([])
    vi.mocked(shell.schemes).mockResolvedValue([])
    vi.mocked(shell.summary).mockResolvedValue(summary)
    vi.mocked(shell.refresh).mockResolvedValue(summary)
  })

  it('never shows a form the vault does not offer, nor picks it first', async () => {
    const form = (name: string, offered: boolean) => ({ name, version: 1, label: name, behind: [], offered })
    vi.mocked(shell.summary).mockResolvedValue({ ...summary, reports: [form('hidden', false), form('shown', true)], exports: [form('hidden', false)] })
    const store = new VaultStore()

    await store.load()

    expect(store.summary?.reports.map((f) => f.name)).toEqual(['shown'])
    expect(store.summary?.exports).toEqual([])
    expect(store.reportKey).toBe('shown@1')
    expect(store.exportKey).toBeFalsy()
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
})
