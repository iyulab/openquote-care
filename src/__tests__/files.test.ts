import { describe, expect, it } from 'vitest'
import { fileKind } from '../files.js'

const names = { subjects: new Map([['s1', '가상 학생 1']]), groups: new Map([['g1', '또래 집단']]) }

describe('fileKind', () => {
  it('names the subject or group a record belongs to, when the vault knows the name', () => {
    expect(fileKind('subjects/s1/0199.pc01.json', names)).toEqual({ kind: 'subject', name: '가상 학생 1' })
    expect(fileKind('groups/g1/0199.pc01.json.age', names)).toEqual({ kind: 'group', name: '또래 집단' })
    expect(fileKind('subjects/s9/0199.pc01.json', names)).toEqual({ kind: 'subject', name: undefined })
  })
  it('reads definitions and run records from their paths', () => {
    expect(fileKind('schemes/topic/v2.json', names)).toEqual({ kind: 'scheme', scheme: 'topic', version: 2 })
    expect(fileKind('schemes/topic/v1-v2.json.age', names)).toEqual({ kind: 'crosswalk', scheme: 'topic', from: 1, to: 2 })
    expect(fileKind('reports/monthly/v1.json', names)).toEqual({ kind: 'report', report: 'monthly', version: 1 })
    expect(fileKind('exports/session-list/v1.json', names)).toEqual({ kind: 'export', form: 'session-list', version: 1 })
    expect(fileKind('runs/2026/0199.pc01.json', names)).toEqual({ kind: 'run', year: 2026 })
    expect(fileKind('practitioners/0199.pc01.json', names)).toEqual({ kind: 'practitioners' })
    expect(fileKind('devices/0199.pc01 (1).json', names)).toEqual({ kind: 'devices' })
  })
  it('reads a sync client conflict copy of a definition as that definition', () => {
    expect(fileKind('schemes/topic/v1.json (conflicted copy 2026-04-02).age', names)).toEqual({ kind: 'scheme', scheme: 'topic', version: 1 })
    expect(fileKind('schemes/topic/v1-v2 (1).json', names)).toEqual({ kind: 'crosswalk', scheme: 'topic', from: 1, to: 2 })
  })
  it('leaves anything else to its path', () => {
    expect(fileKind('schemes/topic/notes.json', names)).toEqual({ kind: 'other' })
    expect(fileKind('subjects/s1/deeper/x.json', names)).toEqual({ kind: 'other' })
  })
})
