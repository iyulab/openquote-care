import { describe, expect, it } from 'vitest'
import { SuggestionWatch } from '../vault/suggestion-watch.js'

function clock(...times: number[]) {
  let i = 0
  return () => times[Math.min(i++, times.length - 1)]
}

describe('what a person does with the suggestions of a field', () => {
  it('counts the first suggestion kept as accepted, with the time between showing and the first value', () => {
    const watch = new SuggestionWatch(clock(1000, 3500))
    watch.show([{ field: 'topic', top: 'T1' }])
    watch.valued('topic', 'T1')
    expect(watch.finish('session', ['topic'], { topic: 'T1' })).toEqual([{ field: 'session.topic', shown: true, decision: 'accepted', trusted: false, waitMs: 2500 }])
  })

  it('counts another value as corrected, and a value where nothing was shown as entered', () => {
    const watch = new SuggestionWatch(clock(0, 400))
    watch.show([{ field: 'topic', top: 'T1' }])
    watch.valued('topic', 'T2')
    const uses = watch.finish('session', ['topic', 'mode', 'place'], { topic: 'T2', mode: 'M1' })
    expect(uses.map((u) => [u.field, u.shown, u.decision])).toEqual([
      ['session.topic', true, 'corrected'],
      ['session.mode', false, 'entered'],
      ['session.place', false, 'none'],
    ])
    expect(uses[0].waitMs).toBe(400)
    expect(uses[1].waitMs).toBeNull()
  })

  it('keeps what a field first showed: a later change of the suggestions does not move the count', () => {
    const watch = new SuggestionWatch(clock(0, 1))
    watch.show([{ field: 'topic', top: 'T1' }])
    watch.show([{ field: 'topic', top: 'T9' }])
    expect(watch.finish('session', ['topic'], { topic: 'T9' })[0].decision).toBe('corrected')
  })

  it('reads the first of several values, counts a shown field left empty, and starts over', () => {
    const watch = new SuggestionWatch(clock(0))
    watch.show([{ field: 'assessments', top: 'A1' }, { field: 'topic', top: 'T1' }])
    const uses = watch.finish('session', ['assessments', 'topic'], { assessments: ['A1', 'A2'] })
    expect(uses.map((u) => [u.decision, u.shown])).toEqual([['accepted', true], ['none', true]])
    watch.reset()
    expect(watch.finish('session', ['topic'], { topic: 'T1' })[0]).toMatchObject({ shown: false, decision: 'entered' })
  })

  it('carries nothing but names, a decision and a time', () => {
    const watch = new SuggestionWatch(clock(0, 10))
    watch.show([{ field: 'topic', top: 'T1' }])
    watch.valued('topic', 'T1')
    const text = JSON.stringify(watch.finish('session', ['topic'], { topic: 'T1', note: '가상 학생이 한 말' }))
    expect(text).not.toContain('T1')
    expect(text).not.toContain('가상')
  })
})
