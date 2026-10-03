import { describe, expect, it } from 'vitest'
import { osName } from '../feedback.js'

describe('osName', () => {
  it('names the operating system the way people do, and keeps one it does not know', () => {
    expect(osName('windows x86_64')).toBe('Windows')
    expect(osName('macos aarch64')).toBe('macOS')
    expect(osName('freebsd x86_64')).toBe('freebsd')
  })
})
