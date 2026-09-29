import { describe, expect, it } from 'vitest'
import { createProblem, groupKey, KIT_TAIL, MIN_PASSPHRASE, passphraseProblem } from '../flow.js'

describe('createProblem', () => {
  const good = 'x'.repeat(MIN_PASSPHRASE)
  it('asks for a folder first', () => expect(createProblem(undefined, good, good)).toBe('no-folder'))
  it('refuses a short passphrase, counting characters not bytes', () => {
    expect(createProblem('C:/v', 'x'.repeat(MIN_PASSPHRASE - 1), '')).toBe('passphrase-short')
    const korean = '가'.repeat(MIN_PASSPHRASE)
    expect(createProblem('C:/v', korean, korean)).toBeUndefined()
  })
  it('refuses two different passphrases', () => expect(createProblem('C:/v', good, good + 'y')).toBe('passphrase-mismatch'))
  it('accepts a complete form', () => expect(createProblem('C:/v', good, good)).toBeUndefined())
})

describe('passphraseProblem', () => {
  const good = 'x'.repeat(MIN_PASSPHRASE)
  it('holds a new passphrase to the same rules as a new vault', () => {
    expect(passphraseProblem('x'.repeat(MIN_PASSPHRASE - 1), '')).toBe('passphrase-short')
    expect(passphraseProblem(good, good + 'y')).toBe('passphrase-mismatch')
    expect(passphraseProblem(good, good)).toBeUndefined()
  })
})

describe('groupKey', () => {
  it('keeps the prefix whole and counts groups of six from the end', () => {
    const key = 'AGE-SECRET-KEY-1' + 'ABCDEFGHIJKLMN'
    expect(groupKey(key)).toEqual(['AGE-SECRET-KEY-1', 'AB', 'CDEFGH', 'IJKLMN'])
    expect(groupKey(key).join('')).toBe(key)
  })
  it('ends on exactly the characters typed back', () => {
    const key = 'AGE-SECRET-KEY-1' + 'Q'.repeat(52) + 'XNQ4XP'
    expect(groupKey(key).at(-1)).toBe(key.slice(-KIT_TAIL))
  })
})
