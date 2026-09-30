import { describe, expect, it } from 'vitest'
import { ko as strings } from '../locales/ko.js'

describe('unreadableWhat', () => {
  it('names the subject or group a record belongs to, when the vault knows the name', () => {
    expect(strings.unreadableWhat({ kind: 'subject', id: 's1' }, '가상 학생 1')).toBe('대상자 가상 학생 1의 기록')
    expect(strings.unreadableWhat({ kind: 'group', id: 'g1' }, '또래 집단')).toBe('집단 또래 집단의 기록')
    expect(strings.unreadableWhat({ kind: 'subject', id: 's9' })).toBe('이름을 읽지 못한 대상자의 기록')
  })
  it('names definitions and run records by what the engine read from their paths', () => {
    expect(strings.unreadableWhat({ kind: 'scheme', name: 'topic', version: 2 })).toBe('분류 topic 2판')
    expect(strings.unreadableWhat({ kind: 'crosswalk', name: 'topic', from: 1, to: 2 })).toBe('분류 topic 1판→2판 연계표')
    expect(strings.unreadableWhat({ kind: 'report', name: 'monthly', version: 1 })).toBe('보고 양식 monthly 1판')
    expect(strings.unreadableWhat({ kind: 'export', name: 'session-list', version: 1 })).toBe('내보내기 양식 session-list 1판')
    expect(strings.unreadableWhat({ kind: 'run', year: 2026 })).toBe('2026년 보고 산출 기록')
  })
  it('names what an unreadable pack, labels or fields file was for', () => {
    expect(strings.unreadableWhat({ kind: 'pack', name: 'care.school', version: 1 })).toBe('데이터 팩 care.school 1판의 목록')
    expect(strings.unreadableWhat({ kind: 'labels', name: 'kr', version: 1 })).toBe('데이터 팩 kr 1판의 이름표')
    expect(strings.unreadableWhat({ kind: 'fields', name: 'care', version: 1, type: 'session' })).toBe('데이터 팩 care 1판의 session 칸 정의')
  })
  it('leaves anything else to its path', () => {
    expect(strings.unreadableWhat({ kind: 'other' })).toBeUndefined()
  })
})
