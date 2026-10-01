import { describe, it, expect } from 'vitest'
import raw from '../styles.css?raw'

const css = raw.replace(/\/\*[\s\S]*?\*\//g, '')

/** Rule bodies that set the background: light, dark-by-preference, dark-by-choice. */
// The print block sets the background too but never the accent — it is not a palette.
const palettes = () => [...css.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]).filter((b) => /--dc-color-bg\s*:/.test(b) && /--dc-color-accent\s*:/.test(b))
const get = (body: string, token: string) => body.match(new RegExp(`${token}\\s*:\\s*(#[0-9a-fA-F]{6})`))?.[1]
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

/** Text on ground: every pair the screens put together. */
const PAIRS: [string, string][] = [
  ['--dc-color-text', '--dc-color-bg'], ['--dc-color-text-secondary', '--dc-color-bg'], ['--dc-color-text-muted', '--dc-color-bg'],
  ['--dc-color-text-muted', '--oq-sidebar'], ['--dc-color-text-muted', '--dc-color-surface-raised'], ['--dc-color-text-muted', '--oq-cream'],
  ['--dc-color-accent-text', '--dc-color-bg'], ['--dc-color-accent-contrast', '--dc-color-accent'],
  ['--dc-color-secondary-text', '--dc-color-surface-raised'], ['--dc-color-secondary-text', '--oq-secondary-subtle'],
  ['--dc-color-accent-text', '--oq-accent-subtle'], ['--dc-color-success-text', '--oq-success-subtle'],
  ['--dc-color-warning-text', '--oq-warning-subtle'], ['--dc-color-danger-text', '--oq-danger-subtle'],
]

describe('the app theme', () => {
  it('has a light palette and two dark ones', () => expect(palettes()).toHaveLength(3))

  it('gives every palette the same color tokens', () => {
    const names = (b: string) => [...b.matchAll(/(--(?:dc|oq)-color-[a-z-]+|--oq-[a-z-]+)\s*:\s*#/g)].map((m) => m[1]).sort()
    const [light, ...dark] = palettes()
    for (const d of dark) expect(names(d)).toEqual(names(light))
  })

  it.each(PAIRS)('%s reads at 4.5:1 on %s in every palette', (text, ground) => {
    for (const body of palettes()) {
      const t = get(body, text)!, g = get(body, ground)!
      expect(t, `${text}`).toBeTruthy(); expect(g, `${ground}`).toBeTruthy()
      expect(contrast(t, g), `${t} on ${g}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('prints ink on paper whatever the palette, with a selector that outranks the dark ones', () => {
    const print = css.match(/@media print\s*\{\s*([^{}]*)\{([^{}]*)\}/)
    expect(print, 'a print block').toBeTruthy()
    expect(print![1].trim()).toBe(':root:root:root')
    expect(get(print![2], '--dc-color-text')).toBe('#000000')
    expect(get(print![2], '--dc-color-bg')).toBe('#ffffff')
  })

  it('prints no grounds and no shadows, including those a screen sets on its own parts', () => {
    const print = css.match(/@media print\s*\{\s*[^{}]*\{([^{}]*)\}/)![1]
    // The menu and the selected entry lie on grounds of their own.
    expect(get(print, '--oq-sidebar')).toBe('#ffffff')
    expect(print).toMatch(/--dc-selection-bg\s*:\s*transparent/)
    // A card that raises itself (the welcome and setup cards) reads the base elevations, not the card role.
    for (const level of [1, 2, 3]) expect(print).toMatch(new RegExp(`--dc-elevation-${level}\\s*:\\s*none`))
  })
})
