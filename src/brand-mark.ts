import { svg } from 'lit'

// The brand's comma: a round-ended tail, the way a pen lifts off the page.
const COMMA = 'M6 72C6 38 28 14 62 4A5.6 5.6 0 0 1 67 14C48 22 38 34 35 48.5A24 24 0 1 1 6 72Z'

/** The dialogue mark: two commas facing each other in the two voices, rose where they meet. Inline, not a file: the window's policy loads images from the app only, and a mark this small would be inlined as a data URI. */
export function dialogueMark(size: number) {
  return svg`<svg viewBox="0 0 512 512" width=${size} height=${size} aria-hidden="true">
    <g transform="translate(-19.25 96.09) scale(3.2768)">
      <mask id="oq-meet"><path d=${COMMA} fill="#fff" transform="translate(28 0)" /></mask>
      <path d=${COMMA} fill="#f3b39c" transform="translate(28 0)" />
      <path d=${COMMA} fill="#a9bbec" transform="translate(140 0) scale(-1 1)" />
      <g mask="url(#oq-meet)"><path d=${COMMA} fill="#c890b6" transform="translate(140 0) scale(-1 1)" /></g>
    </g>
  </svg>`
}

/** The plain mark — an opening quote, no closing one — in the text color. */
export function quoteMark(size: number) {
  return svg`<svg viewBox="0 0 512 512" width=${size} height=${size} aria-hidden="true">
    <g transform="translate(76.8 131.07) scale(2.56)">
      <path d=${COMMA} fill="currentColor" />
      <path d=${COMMA} fill="currentColor" transform="translate(66 0)" />
    </g>
  </svg>`
}

/**
 * The dialogue mark in ink alone, as markup — for documents written to be read without the app (the plain copy),
 * where it closes the last page: two commas facing, no colours, so an ending is marked and never celebrated.
 */
export function endMarkMarkup(size: number): string {
  // As the brand's mono mark: the second comma cuts a thin gap out of the first, or in one ink they would run together.
  return `<svg viewBox="0 0 512 512" width="${size}" height="${size}" aria-hidden="true"><g transform="translate(-19.25 96.09) scale(3.2768)" fill="currentColor"><mask id="end-cut" maskUnits="userSpaceOnUse" x="-20" y="-20" width="180" height="140"><rect x="-20" y="-20" width="180" height="140" fill="#fff"/><path d="${COMMA}" fill="#000" stroke="#000" stroke-width="7" stroke-linejoin="round" transform="translate(140 0) scale(-1 1)"/></mask><g mask="url(#end-cut)"><path d="${COMMA}" transform="translate(28 0)"/></g><path d="${COMMA}" transform="translate(140 0) scale(-1 1)"/></g></svg>`
}
