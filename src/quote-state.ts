import { LitElement, css, html, svg, unsafeCSS } from 'lit'
import { customElement, property } from 'lit/decorators.js'

// The brand's comma and its three states — the same geometry, colours and timing as the brand's
// state assets (getting ready: the open quote typed; in progress: the ellipsis in the two voices;
// done: the second comma turns to face the first). Drawn inline: the window's policy loads images
// from the app only.
const COMMA = 'M6 72C6 38 28 14 62 4A5.6 5.6 0 0 1 67 14C48 22 38 34 35 48.5A24 24 0 1 1 6 72Z'
const PEACH = '#f3b39c'
const PERIWINKLE = '#a9bbec'
const RAPPORT = '#c890b6'
/** The two voices, for the styles (constants of this file, never input). */
const VOICE = { a: unsafeCSS(PEACH), b: unsafeCSS(PERIWINKLE) }

/** The open quote spans this much of the 512 square; the small cut fills more of it, for 16–24 px. */
const FRAME = { regular: 'translate(76.8 131.07) scale(2.56)', small: 'translate(-1.6 76.42) scale(3.68)' }
const DOTS = { regular: { r: 34, gap: 116 }, small: { r: 48.88, gap: 166.75 } }
/** At or under this size the small cut is drawn. */
const SMALL_AT = 24

export type QuoteState = 'opening' | 'ongoing' | 'done'

/**
 * A state shown by the brand's quote, with its words beside it (the slot) — the words are what says
 * the state; the mark is decoration and hidden from screen readers. Getting ready and in progress
 * appear only after a moment, so a quick action does not flash them; done plays once.
 */
@customElement('oq-quote-state')
export class OqQuoteState extends LitElement {
  @property({ reflect: true }) state: QuoteState = 'opening'
  @property({ type: Number }) size = 18

  static styles = css`
    :host {
      display: inline-flex;
      align-items: center;
      gap: 0.4em;
    }
    :host([state='opening']),
    :host([state='ongoing']) {
      opacity: 0;
      animation: appear 0s linear 0.4s forwards;
    }
    @keyframes appear {
      to {
        opacity: 1;
      }
    }
    svg {
      flex: none;
      overflow: visible;
    }
    .a,
    .b {
      fill: currentColor;
    }
    .opening .a,
    .opening .b {
      opacity: 0;
      animation: 1.8s ease-in-out infinite both;
    }
    .opening .a {
      animation-name: type-a;
    }
    .opening .b {
      animation-name: type-b;
    }
    @keyframes type-a {
      0% { opacity: 0; }
      6%, 72% { opacity: 1; }
      92%, 100% { opacity: 0; }
    }
    @keyframes type-b {
      0%, 18% { opacity: 0; }
      24%, 72% { opacity: 1; }
      92%, 100% { opacity: 0; }
    }
    .ongoing .d {
      animation: wave 1.2s cubic-bezier(0.45, 0, 0.55, 1) infinite both;
      transform-box: fill-box;
      transform-origin: center;
    }
    .ongoing .d1 { animation-delay: 0.16s; }
    .ongoing .d2 { animation-delay: 0.32s; }
    @keyframes wave {
      0%, 60%, 100% { transform: translateY(0) scale(1); }
      25% { transform: translateY(-20px) scale(1.12); }
    }
    .done .a {
      transform: translate(14px, 0) scale(1, 1);
      fill: ${VOICE.a};
      animation: turn-a 1.15s cubic-bezier(0.6, 0.05, 0.25, 1) 1 both;
    }
    .done .b {
      transform: translate(126px, 0) scale(-1, 1);
      fill: ${VOICE.b};
      animation: turn-b 1.15s cubic-bezier(0.6, 0.05, 0.25, 1) 1 both;
    }
    @keyframes turn-a {
      0% { transform: translate(0, 0) scale(1, 1); fill: currentColor; }
      45% { fill: color-mix(in srgb, currentColor 30%, transparent); }
      80%, 100% { transform: translate(14px, 0) scale(1, 1); fill: ${VOICE.a}; }
    }
    @keyframes turn-b {
      0% { transform: translate(66px, 0) scale(1, 1); fill: currentColor; }
      45% { fill: color-mix(in srgb, currentColor 30%, transparent); }
      80%, 100% { transform: translate(126px, 0) scale(-1, 1); fill: ${VOICE.b}; }
    }
    .done .meet {
      animation: meet 1.15s ease-out 1 both;
    }
    @keyframes meet {
      0%, 70% { opacity: 0; }
      100% { opacity: 1; }
    }
    @media (prefers-reduced-motion: reduce) {
      :host([state='opening']),
      :host([state='ongoing']) {
        animation: none;
        opacity: 1;
      }
      .opening .a,
      .opening .b,
      .ongoing .d,
      .done .a,
      .done .b,
      .done .meet {
        animation: none;
        opacity: 1;
      }
    }
  `

  render() {
    const cut = this.size <= SMALL_AT ? 'small' : 'regular'
    return html`<svg class=${this.state} viewBox="0 0 512 512" width=${this.size} height=${this.size} aria-hidden="true">
        ${this.mark(cut)}</svg
      ><slot></slot>`
  }

  private mark(cut: 'small' | 'regular') {
    if (this.state === 'ongoing') {
      const { r, gap } = DOTS[cut]
      return [PEACH, RAPPORT, PERIWINKLE].map((fill, i) => svg`<circle class=${`d d${i}`} cx=${256 + (i - 1) * gap} cy="256" r=${r} fill=${fill} />`)
    }
    if (this.state === 'done') {
      return svg`<g transform=${FRAME[cut]}>
        <mask id="meet"><path d=${COMMA} fill="#fff" transform="translate(14 0)" /></mask>
        <path class="a" d=${COMMA} />
        <path class="b" d=${COMMA} />
        <g class="meet" mask="url(#meet)"><path d=${COMMA} fill=${RAPPORT} transform="translate(126 0) scale(-1 1)" /></g>
      </g>`
    }
    return svg`<g transform=${FRAME[cut]}><path class="a" d=${COMMA} /><path class="b" d=${COMMA} transform="translate(66 0)" /></g>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'oq-quote-state': OqQuoteState
  }
}
