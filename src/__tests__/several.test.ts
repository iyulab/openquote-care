import { describe, expect, it } from 'vitest'
import { alsoKey, othersOf, primaryAndOthers, recordedValues } from '../several.js'

const coded = (code: string, primary?: boolean) => ({ scheme: 'topic', version: 1, code, ...(primary ? { primary } : {}) })

describe('primaryAndOthers', () => {
  it('takes a single value as its own primary', () => {
    expect(primaryAndOthers(coded('a'))).toEqual({ primary: coded('a'), others: [] })
    expect(primaryAndOthers([coded('a')])).toEqual({ primary: coded('a'), others: [] })
  })
  it('takes the marked value as primary and keeps the others in order', () => {
    expect(primaryAndOthers([coded('a'), coded('b', true), coded('c')])).toEqual({ primary: coded('b', true), others: [coded('a'), coded('c')] })
  })
  it('names no primary among several unmarked values: a person picks one', () => {
    expect(primaryAndOthers([coded('a'), coded('b')])).toEqual({ primary: undefined, others: [coded('a'), coded('b')] })
  })
  it('holds nothing for anything else', () => {
    expect(primaryAndOthers(null)).toEqual({ primary: undefined, others: [] })
    expect(primaryAndOthers('a')).toEqual({ primary: undefined, others: [] })
  })
})

describe('othersOf', () => {
  it('reads the other codes without repeats, empty lines or the primary one', () => {
    expect(othersOf({ topic: 'a', [alsoKey('topic')]: 'b\n\na\nc\nb' }, 'topic')).toEqual(['b', 'c'])
    expect(othersOf({ topic: 'a' }, 'topic')).toEqual([])
  })
})

describe('recordedValues', () => {
  it('records one value as one value, and several with the primary first and marked', () => {
    expect(recordedValues('topic', 1, 'a', [])).toEqual(coded('a'))
    expect(recordedValues('topic', 1, 'a', ['b', 'c'])).toEqual([coded('a', true), coded('b'), coded('c')])
  })
})
