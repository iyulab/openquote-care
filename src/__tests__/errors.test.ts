import { describe, expect, it } from 'vitest'
import { describeError } from '../errors.js'
import { strings } from '../strings.js'

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
