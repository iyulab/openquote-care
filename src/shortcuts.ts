// The keys the open vault answers to, and which of them a key press is.

/** What a key press asks of the open vault. */
export type Shortcut = 'find' | 'new-record' | 'previous-month' | 'next-month' | 'help'

/** Whether keys pressed now go into a field a person is typing in. */
export function typingIn(target: EventTarget | null | undefined): boolean {
  const el = target as HTMLElement | null | undefined
  if (!el || typeof el.tagName !== 'string') return false
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable === true
}

/**
 * The shortcut a key press is, if any: Ctrl+K (⌘K) finds, Ctrl+N (⌘N) adds a record, ← and → step the month and
 * ? lists them — those three only while nothing is being typed, where the keys move in the text.
 */
export function shortcutOf(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>, typing: boolean): Shortcut | undefined {
  const command = e.ctrlKey || e.metaKey
  if (e.altKey) return undefined
  if (command && !e.shiftKey) {
    const key = e.key.toLowerCase()
    if (key === 'k') return 'find'
    if (key === 'n') return 'new-record'
    return undefined
  }
  if (command || typing) return undefined
  if (e.key === 'ArrowLeft' && !e.shiftKey) return 'previous-month'
  if (e.key === 'ArrowRight' && !e.shiftKey) return 'next-month'
  if (e.key === '?') return 'help'
  return undefined
}
