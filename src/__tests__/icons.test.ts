import { describe, expect, it } from 'vitest'
import type { TemplateResult } from 'lit'
import raw from '../vault-view.ts?raw'
import { ICONS, menuIcon } from '../icons.js'

describe('the menu icons', () => {
  it('draw every place the menu lists, and nothing it does not', () => {
    const places = [...raw.matchAll(/\{ id: '([a-z]+)', icon: '',/g)].map((m) => m[1]).sort()
    expect(places.length).toBeGreaterThan(0)
    expect([...ICONS].sort()).toEqual(places)
  })

  it('fill the slot named for their place, and none for a place without one', () => {
    const icon = menuIcon('subjects') as TemplateResult
    expect(icon.values).toContain('icon-subjects')
    expect(menuIcon('nowhere')).toBeUndefined()
  })
})
