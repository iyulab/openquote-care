import { html, nothing } from 'lit'
import type { FieldView } from '../fields.js'
import { strings } from '../strings.js'

/** A choice a coded or reference field offers. */
export interface Choice {
  value: string
  label: string
}

/** What a form may add to a dropdown's field: a line under the label, and something after the dropdown. */
export interface FieldExtras {
  hint?: string
  after?: unknown
}

/**
 * The input for one field a vault's packs declare, by what the field holds: a line (or, for written
 * content, a box) for text, a date or a number; a dropdown of `choices` for a classification or a
 * reference, with "none" first unless the field is required.
 */
export function fieldInput(f: FieldView, value: string, set: (v: string) => void, busy: boolean, choices: Choice[] = [], extras: FieldExtras = {}) {
  switch (f.kind) {
    case 'date':
    case 'number':
    case 'text':
      if (f.tier === 'narrative')
        return html`<dc-field class="wide" label=${f.label} ?required=${f.required}>
          <dc-textarea
            aria-label=${f.label}
            data-field=${f.name}
            .value=${value}
            .rows=${4}
            ?disabled=${busy}
            @input=${(e: Event) => set((e.target as HTMLTextAreaElement).value)}
          ></dc-textarea>
        </dc-field>`
      return html`<dc-field label=${f.label} ?required=${f.required}>
        <dc-input
          type=${f.kind === 'text' ? 'text' : f.kind}
          aria-label=${f.label}
          data-field=${f.name}
          .value=${value}
          ?disabled=${busy}
          @input=${(e: Event) => set((e.target as HTMLInputElement).value)}
        ></dc-input>
      </dc-field>`
    case 'coded':
    case 'reference':
      return html`<dc-field label=${f.label} hint=${extras.hint ?? ''} ?required=${f.required}>
        <dc-select
          aria-label=${f.label}
          data-field=${f.name}
          .options=${f.required ? choices : [{ value: '', label: strings.none }, ...choices]}
          .value=${value}
          placeholder=${f.label}
          ?disabled=${busy}
          @change=${(e: Event) => set((e.target as HTMLSelectElement).value)}
        ></dc-select>
        ${extras.after ?? nothing}
      </dc-field>`
    default:
      return nothing
  }
}
