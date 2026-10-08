import { shell } from './shell.js'

/**
 * Tells the shell which screen is shown, so the session keeps time on each one (by its fixed name
 * only — see `SCREENS` in the shell's diagnostics). Says so once per change; while the window is
 * hidden or minimised no screen is shown.
 */
export function screenTime(report: (name: string | null) => void, hidden: () => boolean) {
  let shown: string | null = null
  let last: string | null | undefined
  const tell = () => {
    const now = hidden() ? null : shown
    if (now === last) return
    last = now
    report(now)
  }
  return {
    /** The screen the window shows now. */
    show(name: string) {
      shown = name
      tell()
    },
    /** The window was hidden or shown again. */
    visibilityChanged: tell,
  }
}

const hasDocument = typeof document !== 'undefined'
const time = screenTime(
  (name) => void shell.screenShown(name).catch(() => {}),
  () => hasDocument && document.visibilityState === 'hidden',
)
if (hasDocument) document.addEventListener('visibilitychange', time.visibilityChanged)

/** The screen the window shows now, by its fixed name. */
export const showScreen = (name: string) => time.show(name)
