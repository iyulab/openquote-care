import { describe, expect, it } from 'vitest'
import type { Entity } from '../records.js'
import { searchSessions, searchWords, type SessionText } from '../search.js'

const session = (id: string, fields: Record<string, unknown>): Entity => ({ type: 'session', id, subject: 's1', group: null, people: ['s1'], fields, conflicts: {} })

const describeIt = (s: Entity): SessionText[] =>
  Object.entries(s.fields).map(([label, value]) => ({ label, text: typeof value === 'string' ? value : '' }))

describe('finding sessions by what they say', () => {
  const sessions = [
    session('a', { 제목: '성적 하락', 상담내용: '합성 상담 내용: 기말고사 뒤 성적이 떨어져 걱정이 많다고 함. 수면도 부족하다고 이야기함.' }),
    session('b', { 제목: '친구 관계', 상담내용: '합성 상담 내용: 반 친구와 다툼' }),
    session('c', { 제목: '', 대상자: '가상 학생 1' }),
  ]

  it('finds a session holding every word, wherever each is', () => {
    expect(searchSessions(sessions, '성적 수면', describeIt).map((h) => h.session.id)).toEqual(['a'])
    expect(searchSessions(sessions, '친구', describeIt).map((h) => h.session.id)).toEqual(['b'])
    expect(searchSessions(sessions, '성적 친구', describeIt)).toEqual([])
  })

  it('says where the first word was found, with the words around it in a long text', () => {
    const [hit] = searchSessions(sessions, '수면', describeIt)
    expect(hit.label).toBe('상담내용')
    expect(hit.snippet.startsWith('…')).toBe(true)
    expect(hit.snippet).toContain('수면도 부족하다고')
    const [title] = searchSessions(sessions, '하락', describeIt)
    expect([title.label, title.snippet]).toEqual(['제목', '성적 하락'])
  })

  it('reads names and ignores case and how letters were composed', () => {
    expect(searchSessions(sessions, '학생 1', describeIt).map((h) => h.session.id)).toEqual(['c'])
    const latin = [session('d', { note: 'Exam STRESS' })]
    expect(searchSessions(latin, 'stress', describeIt)).toHaveLength(1)
    // 「성적」 typed as separate jamo-composed code points still finds the composed text.
    expect(searchSessions(sessions, '성적'.normalize('NFD'), describeIt).map((h) => h.session.id)).toEqual(['a'])
  })

  it('finds nothing for a query of only spaces', () => {
    expect(searchWords('   ')).toEqual([])
    expect(searchSessions(sessions, '  ', describeIt)).toEqual([])
  })
})
