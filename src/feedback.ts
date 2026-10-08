import { LitElement, css, html, nothing } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { describeError } from './errors.js'
import { shell, type FeedbackStatus } from './shell.js'
import { strings } from './strings.js'
import { errorCallout } from './vault/parts.js'
import './quote-state.js'

/**
 * A message to the publisher, written and sent by the person: what they write, a reply address if
 * they want one, and — listed before sending — what goes along with it. Nothing is sent until
 * they press send; a send that fails keeps what they wrote.
 */
/** The operating system as people name it, from the shell's `<os> <arch>` (what is sent). */
export function osName(os: string): string {
  const name = os.split(' ')[0]
  return ({ windows: 'Windows', macos: 'macOS', linux: 'Linux' } as Record<string, string>)[name] ?? name
}

@customElement('oc-feedback')
export class OcFeedback extends LitElement {
  static styles = css`
    :host {
      display: block;
    }
    .stack {
      display: flex;
      flex-direction: column;
      gap: var(--dc-space-3, 12px);
    }
    p {
      margin: 0;
    }
    .muted {
      color: var(--dc-color-text-muted);
    }
    .count {
      font-size: var(--dc-font-size-sm, 12px);
      text-align: end;
    }
    .over {
      color: var(--dc-color-danger-text);
    }
    .row {
      display: flex;
      justify-content: flex-end;
      gap: var(--dc-space-2, 8px);
    }
  `

  /** What this installation sends along with a message (the shell's feedback status). */
  @property({ attribute: false }) status!: FeedbackStatus

  @state() private message = ''
  @state() private email = ''
  @state() private sending = false
  @state() private sent = false
  @state() private error?: { text: string; detail?: string }

  private async send() {
    this.error = undefined
    this.sent = false
    this.sending = true
    try {
      await shell.sendFeedback(this.message, this.email.trim() || undefined)
      this.message = ''
      this.sent = true
    } catch (e) {
      this.error = describeError(e)
    } finally {
      this.sending = false
    }
  }

  render() {
    const { version, os, maxMessage } = this.status
    const length = [...this.message].length
    const over = length > maxMessage
    return html`<div class="stack" data-role="feedback">
      <p>${strings.feedbackLead}</p>
      <dc-callout role="note"><p>${strings.feedbackCaution}</p></dc-callout>
      <dc-field label=${strings.feedbackMessage} required>
        <dc-textarea
          aria-label=${strings.feedbackMessage}
          data-field="message"
          .value=${this.message}
          .rows=${8}
          ?disabled=${this.sending}
          @input=${(e: Event) => ((this.message = (e.target as HTMLTextAreaElement).value), (this.sent = false))}
        ></dc-textarea>
      </dc-field>
      <p class="muted count ${over ? 'over' : ''}" data-role="count">${strings.feedbackCount(length, maxMessage)}</p>
      <dc-field label=${strings.feedbackEmail}>
        <dc-input
          type="email"
          aria-label=${strings.feedbackEmail}
          data-field="email"
          .value=${this.email}
          ?disabled=${this.sending}
          @input=${(e: Event) => (this.email = (e.target as HTMLInputElement).value)}
        ></dc-input>
      </dc-field>
      <p class="muted" data-role="what">${strings.feedbackWhat(version, osName(os))}</p>
      <p class="muted">${strings.feedbackWhere}</p>
      ${errorCallout(this.error)}
      ${this.sent ? html`<dc-callout role="status" data-role="sent"><p><oq-quote-state state="done" size="18">${strings.feedbackSent}</oq-quote-state></p></dc-callout>` : nothing}
      <div class="row">
        <dc-button variant="primary" data-role="send" ?disabled=${this.sending || !this.message.trim() || over} @click=${() => void this.send()}
          >${this.sending ? strings.feedbackSending : strings.feedbackSend}</dc-button
        >
      </div>
    </div>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'oc-feedback': OcFeedback
  }
}
