import { describe, expect, it } from 'vitest'
import { describeError } from '../errors.js'
import { strings } from '../strings.js'
import { en } from '../locales/en.js'
import { ko } from '../locales/ko.js'
import feedbackSource from '../../src-tauri/src/feedback.rs?raw'

describe('describeError', () => {
  it('words a known code without the shell text', () => {
    expect(describeError({ code: 'wrong-passphrase', message: 'the passphrase does not open this vault' })).toEqual({
      text: strings.errors['wrong-passphrase'],
    })
  })
  it('keeps the shell text as detail for an unknown code or a thrown error', () => {
    expect(describeError({ code: 'new-code', message: 'm' })).toEqual({ text: strings.errors.unknown, detail: 'm' })
    expect(describeError(new Error('boom')).detail).toBe('boom')
  })
})

describe('feedback failures', () => {
  it('has a sentence in every language for each code the shell gives a failed send', () => {
    const codes = [...feedbackSource.matchAll(/=> "(feedback-[a-z-]+)"/g)].map((m) => m[1])
    expect(codes.length).toBeGreaterThan(5)
    for (const table of [ko, en]) for (const code of codes) expect((table.errors as Record<string, string>)[code], code).toBeTruthy()
  })
})
