import { describe, it, expect } from 'vitest'
import shellSource from '../../src-tauri/src/diagnostics.rs?raw'
import appSource from '../app.ts?raw'
import vaultSource from '../vault-view.ts?raw'
import { screenTime } from '../screen-time.js'

const quoted = (text: string) => [...text.matchAll(/'([^']+)'/g)].map((m) => m[1])

describe('screen time', () => {
  it('tells the shell once per change, and no screen while the window is hidden', () => {
    const told: (string | null)[] = []
    let hidden = false
    const time = screenTime((name) => told.push(name), () => hidden)
    time.show('welcome')
    time.show('welcome')
    time.show('vault:subjects')
    hidden = true
    time.visibilityChanged()
    time.show('vault:report')
    hidden = false
    time.visibilityChanged()
    expect(told).toEqual(['welcome', 'vault:subjects', null, 'vault:report'])
  })

  it('names only screens the shell keeps time under — a name it does not know would count as unrecognized', () => {
    const start = shellSource.indexOf('pub const SCREENS')
    const fixed = [...shellSource.slice(start, shellSource.indexOf('];', start)).matchAll(/"([^"]+)"/g)].map((m) => m[1])
    const screens = [...appSource.matchAll(/\| \{ name: '([^']+)'/g)].map((m) => m[1]).filter((n) => n !== 'vault')
    const at = vaultSource.indexOf('type View =')
    const views = quoted(vaultSource.slice(at, vaultSource.indexOf('\n', at)))
    const named = [...screens, ...views.map((v) => `vault:${v}`)]
    expect(named.length).toBeGreaterThan(10)
    expect([...named].sort()).toEqual([...fixed].sort())
  })
})
