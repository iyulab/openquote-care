import '@iyulab/desktop-patterns/shell'
import '@iyulab/desktop-patterns/sidebar'
import '@iyulab/desktop-patterns/toolbar'
import '@iyulab/desktop-patterns/page'
import '@iyulab/desktop-compact/button'
import '@iyulab/desktop-compact/checkbox'
import '@iyulab/desktop-compact/input'
import '@iyulab/desktop-compact/select'
import '@iyulab/desktop-compact/paste-rows-zone'
import { shell } from './shell.js'
import { useLocale } from './strings.js'

// The language is settled before the app's modules load, so everything they draw is in it.
const locale = useLocale(await shell.uiLocale().catch(() => navigator.language))
document.documentElement.lang = locale
await import('./app.js')
