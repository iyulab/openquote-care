// The menu's icons: one line-drawn set, drawn here so the app carries no icon library. Each takes the color
// of the text around it.

import { html, svg, type SVGTemplateResult } from 'lit'

/** The drawing of each place in the menu, on a 24-unit square. */
const DRAWINGS: Record<string, SVGTemplateResult> = {
  subjects: svg`<circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" />`,
  groups: svg`<circle cx="9" cy="8" r="3.5" /><circle cx="17" cy="9" r="2.5" /><path d="M2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5" /><path d="M16.5 14.5c2.8 0 5 1.6 5 4.5" />`,
  practitioners: svg`<rect x="4" y="3" width="16" height="18" rx="2" /><circle cx="12" cy="10" r="3" /><path d="M8 17c.8-1.8 2.2-2.5 4-2.5s3.2.7 4 2.5" />`,
  search: svg`<circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" />`,
  report: svg`<path d="M3 20h18" /><path d="M6 20v-8" /><path d="M12 20V5" /><path d="M18 20v-5" />`,
  export: svg`<rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8" /><path d="M8 12h8" /><path d="M8 16h5" />`,
  lists: svg`<path d="M9 6h11" /><path d="M9 12h11" /><path d="M9 18h11" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" />`,
  devices: svg`<rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8" /><path d="M12 16v4" />`,
  feedback: svg`<path d="M4 5h16v11H9l-5 4z" />`,
}

/** The places that have an icon. */
export const ICONS = Object.keys(DRAWINGS)

/** The icon of a place in the menu, for the menu's `icon-<id>` slot; none for a place without one. */
export function menuIcon(id: string) {
  const drawing = DRAWINGS[id]
  if (!drawing) return undefined
  return html`<svg slot=${`icon-${id}`} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${drawing}</svg>`
}
