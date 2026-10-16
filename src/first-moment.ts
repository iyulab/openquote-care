import { LitElement, css, html, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import './quote-state.js'

/** The moments a records folder has once: its first record, and the first statistics it keeps. */
export type FirstMoment = 'first-record' | 'first-report'

/** How long a first moment stays: the quotes turning to face, the warmth coming in and going. */
export const FIRST_MOMENT_FOR = 2400

/**
 * A first moment of a records folder, marked once and quietly: the two quotes turn to face each other, large, over
 * a warmth that comes in and goes, in the middle of the window. It is decoration — the words that say the record
 * was saved or the report run stay where they always are — so it never takes a click or speaks to a screen reader.
 */
@customElement('oc-first-moment')
export class OcFirstMoment extends LitElement {
  @state() private playing?: FirstMoment
  private ends?: ReturnType<typeof setTimeout>

  static styles = css`
    :host {
      position: fixed;
      inset: 0;
      pointer-events: none;
      display: grid;
      place-content: center;
      z-index: 50;
    }
    .glow {
      position: absolute;
      inset: 0;
      background: radial-gradient(circle at 50% 48%, color-mix(in srgb, #f6e2b3 55%, transparent) 0, transparent 38%),
        radial-gradient(circle at 38% 44%, color-mix(in srgb, #f3b39c 30%, transparent) 0, transparent 30%),
        radial-gradient(circle at 62% 52%, color-mix(in srgb, #a9bbec 28%, transparent) 0, transparent 30%);
      animation: warm 2.4s ease-in-out both;
    }
    oq-quote-state {
      position: relative;
      animation: stay 2.4s ease-in-out both;
    }
    @keyframes warm {
      0% { opacity: 0; }
      35%, 65% { opacity: 1; }
      100% { opacity: 0; }
    }
    @keyframes stay {
      0%, 70% { opacity: 1; }
      100% { opacity: 0; }
    }
    @media (prefers-reduced-motion: reduce) {
      .glow { animation: none; opacity: 0.6; }
      oq-quote-state { animation: none; }
    }
  `

  /** Marks `moment`; a moment already showing is not started again. */
  play(moment: FirstMoment) {
    if (this.playing) return
    this.playing = moment
    this.ends = setTimeout(() => (this.playing = undefined), FIRST_MOMENT_FOR)
  }

  disconnectedCallback() {
    clearTimeout(this.ends)
    super.disconnectedCallback()
  }

  render() {
    return this.playing
      ? html`<div class="glow" aria-hidden="true"></div>
          <oq-quote-state aria-hidden="true" data-moment=${this.playing} state="done" size="96"></oq-quote-state>`
      : nothing
  }
}

/**
 * Which first moment a change of the folder makes, if any: its first record, from none — counted on what the folder
 * held before and after, so it is a fact of the folder (any device), not of this computer.
 */
export function firstRecordMoment(before: number, after: number): FirstMoment | null {
  return before === 0 && after > 0 ? 'first-record' : null
}

declare global {
  interface HTMLElementTagNameMap {
    'oc-first-moment': OcFirstMoment
  }
}
