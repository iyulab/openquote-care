import { describe, expect, it } from 'vitest'
import { shortcutOf, typingIn } from '../shortcuts.js'

const press = (key: string, more: Partial<KeyboardEvent> = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...more })

describe('the keys the vault answers to', () => {
  it('finds and adds with the command key, typing or not, in either case', () => {
    expect(shortcutOf(press('k', { ctrlKey: true }), true)).toBe('find')
    expect(shortcutOf(press('K', { metaKey: true }), false)).toBe('find')
    expect(shortcutOf(press('n', { ctrlKey: true }), false)).toBe('new-record')
  })

  it('steps the month and lists the keys only while nothing is being typed', () => {
    expect(shortcutOf(press('ArrowLeft'), false)).toBe('previous-month')
    expect(shortcutOf(press('ArrowRight'), false)).toBe('next-month')
    expect(shortcutOf(press('?', { shiftKey: true }), false)).toBe('help')
    expect(shortcutOf(press('ArrowLeft'), true)).toBeUndefined()
    expect(shortcutOf(press('?', { shiftKey: true }), true)).toBeUndefined()
  })

  it('leaves every other press to the page', () => {
    expect(shortcutOf(press('k'), false)).toBeUndefined()
    expect(shortcutOf(press('k', { ctrlKey: true, shiftKey: true }), false)).toBeUndefined()
    expect(shortcutOf(press('n', { ctrlKey: true, altKey: true }), false)).toBeUndefined()
    expect(shortcutOf(press('ArrowLeft', { ctrlKey: true }), false)).toBeUndefined()
    expect(shortcutOf(press('ArrowLeft', { shiftKey: true }), false)).toBeUndefined()
  })
})

describe('typing in a field', () => {
  it('is a text field, a list to pick from or editable text', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) expect(typingIn({ tagName } as unknown as EventTarget)).toBe(true)
    expect(typingIn({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true)
    expect(typingIn({ tagName: 'BUTTON', isContentEditable: false } as unknown as EventTarget)).toBe(false)
    expect(typingIn(null)).toBe(false)
  })
})
