import { html } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { yearStart } from '../forms.js'
import { text, today, type Entity } from '../records.js'
import { strings } from '../strings.js'
import './record-kinds.js'
import { VaultScreen } from './screen.js'

/** Every year, or every practitioner: the choice that filters nothing. */
const ALL = ''

/**
 * Work about no one in particular — a training given or attended, a meeting, an event — each kind the vault's packs
 * keep in the activity folder with its records, newest first, and a form to add one. The records shown are a year's
 * (from the month the vault's year forms start in) and, when picked, one practitioner's.
 */
@customElement('oc-activities')
export class OcActivities extends VaultScreen {
  /** The first year of the period shown, or every year; the year holding today until a person picks. */
  @state() private year?: string
  @state() private practitioner = ALL

  private get startMonth() {
    return yearStart(this.store?.summary?.reports ?? [])
  }

  /** The year a day falls in, counted from the vault's start month. */
  private yearOf(day: string): number {
    const [y, m] = day.split('-').map(Number)
    return m >= this.startMonth ? y : y - 1
  }

  private shown = (r: Entity): boolean => {
    const day = this.store.dayOf(r)
    const year = this.year ?? String(this.yearOf(today()))
    if (year !== ALL && (!day || String(this.yearOf(day)) !== year)) return false
    return this.practitioner === ALL || r.fields.practitioner === this.practitioner
  }

  protected screen() {
    const store = this.store
    const records = store.kindsUnder('activity').flatMap((k) => store.recordsOf(k.type)).filter((r) => !r.subject && !r.group)
    const years = [...new Set([this.yearOf(today()), ...records.map((r) => store.dayOf(r)).filter(Boolean).map((d) => this.yearOf(d))])].sort((a, b) => b - a)
    const schoolYear = this.startMonth !== 1
    const yearLabel = schoolYear ? strings.schoolYear : strings.year
    const option = schoolYear ? strings.schoolYearOption : strings.yearOption
    // The toolbar names the screen; each kind's own heading carries the button that adds a record of it.
    return html`<div class="stack">
      <p class="muted" data-role="activities-lead">${strings.activitiesLead}</p>
      <div class="toolbar" data-role="activities-filter">
        <dc-select
          aria-label=${yearLabel}
          .options=${[{ value: ALL, label: strings.activitiesEveryYear }, ...years.map((y) => ({ value: String(y), label: option(y) }))]}
          .value=${this.year ?? String(this.yearOf(today()))}
          @change=${(e: Event) => (this.year = (e.target as HTMLSelectElement).value)}
        ></dc-select>
        <dc-select
          aria-label=${strings.activitiesPractitioner}
          .options=${[{ value: ALL, label: strings.activitiesEveryPractitioner }, ...store.practitioners.map((p) => ({ value: p.id, label: text(p, 'name') }))]}
          .value=${this.practitioner}
          @change=${(e: Event) => (this.practitioner = (e.target as HTMLSelectElement).value)}
        ></dc-select>
      </div>
      <oc-record-kinds .store=${store} .holder=${{ kind: 'activity' } as const} .only=${this.shown}></oc-record-kinds>
    </div>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'oc-activities': OcActivities
  }
}
