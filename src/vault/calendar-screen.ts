import { css, html, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { latestFollowUp } from '../cases.js'
import { type DayMarks, type Month, marksByDay, monthDays, monthOf, shiftMonth } from '../calendar.js'
import { text, today, type Entity } from '../records.js'
import { strings } from '../strings.js'
import { openSessionEvent, type OpenSession } from './parts.js'
import { StoreElement, VaultScreen } from './screen.js'

/**
 * A month at a glance: on each day, the people a session planned to meet then, the follow-ups due then and the records
 * made then — days the records already name; nothing is entered here. A day picked shows who and what, each opening
 * where it is kept. The arrow keys move between days, Page Up and Page Down between months.
 */
@customElement('oc-calendar')
export class OcCalendar extends VaultScreen {
  static styles = [
    ...StoreElement.styles,
    css`
      .calendar {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(16rem, 20rem);
        gap: var(--dc-space-5, 20px);
        align-items: start;
      }
      @media (max-width: 960px) {
        .calendar {
          grid-template-columns: minmax(0, 1fr);
        }
      }
      .head {
        display: flex;
        align-items: center;
        gap: var(--dc-space-2, 8px);
        flex-wrap: wrap;
        margin-bottom: var(--dc-space-3, 12px);
      }
      .head h2 {
        margin: 0 var(--dc-space-1, 4px);
        min-width: 7em;
        text-align: center;
        font-size: var(--dc-font-size-xl, 18px);
        font-weight: var(--dc-font-weight-semibold, 600);
        font-variant-numeric: tabular-nums;
      }
      .legend {
        display: flex;
        gap: var(--dc-space-4, 16px);
        margin-inline-start: auto;
        font-size: var(--dc-font-size-sm, 12px);
        color: var(--dc-color-text-muted);
      }
      .legend span,
      .mark {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        white-space: nowrap;
      }
      .dot {
        flex: none;
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: currentColor;
      }
      .meeting .dot {
        color: var(--oq-peach);
      }
      .follow-up .dot {
        color: var(--dc-color-warning);
      }
      .record .dot {
        color: var(--oq-periwinkle);
      }
      .month {
        display: grid;
        grid-template-columns: repeat(7, minmax(0, 1fr));
        background: var(--dc-color-surface-raised);
        border-radius: var(--dc-radius-lg, 10px);
        box-shadow: var(--dc-elevation-1);
        overflow: hidden;
      }
      .weekday {
        padding: var(--dc-space-2, 8px) var(--dc-space-3, 12px);
        font-size: var(--dc-font-size-sm, 12px);
        color: var(--dc-color-text-muted);
        border-bottom: 1px solid var(--dc-color-rule);
      }
      .sunday {
        color: var(--dc-color-danger-text);
      }
      .saturday {
        color: var(--dc-color-secondary-text);
      }
      button.day {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 3px;
        min-width: 0;
        min-height: 6.5rem;
        margin: 0;
        padding: var(--dc-space-2, 8px);
        border: none;
        border-top: 1px solid var(--dc-color-rule);
        border-inline-start: 1px solid var(--dc-color-rule);
        background: transparent;
        color: var(--dc-color-text);
        font: inherit;
        text-align: start;
        cursor: pointer;
      }
      button.day:nth-of-type(7n + 1) {
        border-inline-start: none;
      }
      button.day.first-week {
        border-top: none;
      }
      button.day:hover {
        background: var(--dc-color-surface-hover);
      }
      button.day[aria-pressed='true'] {
        background: var(--oq-accent-subtle);
        box-shadow: inset 0 0 0 2px var(--dc-color-accent);
      }
      button.day:focus-visible {
        outline: var(--dc-focus-ring-width, 2px) solid var(--dc-color-accent);
        outline-offset: -3px;
      }
      button.day.sunday .num {
        color: var(--dc-color-danger-text);
      }
      button.day.saturday .num {
        color: var(--dc-color-secondary-text);
      }
      button.day.outside .num,
      button.day.outside .marks {
        opacity: 0.45;
      }
      .num {
        display: inline-grid;
        place-items: center;
        min-width: 1.75rem;
        height: 1.75rem;
        margin: -2px 0 2px -4px;
        border-radius: 999px;
        font-weight: var(--dc-font-weight-semibold, 600);
        font-variant-numeric: tabular-nums;
      }
      button.day.today .num {
        background: var(--dc-color-accent);
        color: var(--dc-color-accent-contrast);
      }
      .marks {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
        font-size: var(--dc-font-size-sm, 12px);
        color: var(--dc-color-text-secondary);
      }
      .mark {
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .mark.overdue {
        color: var(--dc-color-warning-text);
      }
      aside {
        background: var(--dc-color-surface-raised);
        border-radius: var(--dc-radius-lg, 10px);
        box-shadow: var(--dc-elevation-1);
        padding: var(--dc-space-4, 16px) var(--dc-space-5, 20px);
      }
      aside h3 {
        margin: 0 0 var(--dc-space-3, 12px);
        font-size: var(--dc-font-size-lg, 15px);
        font-weight: var(--dc-font-weight-semibold, 600);
      }
      aside h4 {
        display: flex;
        align-items: center;
        gap: 6px;
        margin: var(--dc-space-4, 16px) 0 var(--dc-space-1, 4px);
        font-size: var(--dc-font-size-sm, 12px);
        font-weight: var(--dc-font-weight-medium, 500);
        color: var(--dc-color-text-muted);
      }
      aside h3 + section h4 {
        margin-top: 0;
      }
      aside ul {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      aside li {
        display: flex;
        align-items: baseline;
        gap: var(--dc-space-2, 8px);
        padding: 5px 0;
      }
      aside li + li {
        border-top: 1px solid var(--dc-color-rule);
      }
      aside li .what {
        color: var(--dc-color-text-muted);
        font-size: var(--dc-font-size-sm, 12px);
      }
      button.open {
        margin: 0;
        padding: 0;
        border: none;
        background: none;
        color: var(--dc-color-accent-text);
        font: inherit;
        text-align: start;
        cursor: pointer;
      }
      button.open:hover {
        text-decoration: underline;
      }
      button.open:focus-visible {
        outline: var(--dc-focus-ring-width, 2px) solid var(--dc-color-accent);
        outline-offset: 2px;
        border-radius: 2px;
      }
      aside .nothing,
      .note {
        color: var(--dc-color-text-muted);
        font-size: var(--dc-font-size-sm, 12px);
      }
      .note {
        margin: var(--dc-space-3, 12px) 0 0;
      }
    `,
  ]

  /** The day picked — today until a person picks another — and the month shown, the picked day's. */
  @state() private picked = today()

  private get month(): Month {
    return monthOf(this.picked)
  }

  private pick(day: string, focus = false) {
    this.picked = day
    if (focus) void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>(`button.day[data-day="${day}"]`)?.focus())
  }

  /** The same date in the month `by` away, or that month's last day when it has no such date. */
  private pickMonth(by: number, focus = false) {
    const m = shiftMonth(this.month, by)
    const last = new Date(m.year, m.month, 0).getDate()
    const date = Math.min(Number(this.picked.slice(8)), last)
    this.pick(`${m.year}-${String(m.month).padStart(2, '0')}-${String(date).padStart(2, '0')}`, focus)
  }

  /** Shows the month `by` away, for the window's ← and → while no day has the keys; true, as it always can. */
  stepPeriod(by: number): boolean {
    this.pickMonth(by)
    return true
  }

  private keydown(e: KeyboardEvent) {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]
    if (step !== undefined) {
      const d = new Date(`${this.picked}T00:00`)
      d.setDate(d.getDate() + step)
      const pad = (n: number) => String(n).padStart(2, '0')
      this.pick(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, true)
    } else if (e.key === 'PageUp' || e.key === 'PageDown') this.pickMonth(e.key === 'PageUp' ? -1 : 1, true)
    else return
    e.preventDefault()
  }

  private marks(): Map<string, DayMarks> {
    const store = this.store
    const records = store.kinds.flatMap((k) => store.recordsOf(k.type)).map((r) => ({ id: r.id, day: store.dayOf(r) }))
    const followUps = store.subjects.flatMap((s) => {
      const f = latestFollowUp(store.cases.get(s.id))
      return f ? [{ subject: s.id, due: f.followUpDue, state: f.followUp }] : []
    })
    return marksByDay({ planned: store.planned, followUps, records })
  }

  private openSubject(id: string) {
    const detail: OpenSession = { holder: 'subject', id, session: '' }
    this.dispatchEvent(new CustomEvent<OpenSession>('oc-open-session', { detail, bubbles: true, composed: true }))
  }

  private subjectName(id: string): string {
    const s = this.store.subjects.find((x) => x.id === id)
    return s ? text(s, 'name') : id
  }

  /** Who or what a record is about, as its line in the day's list names it. */
  private recordWho(r: Entity): string {
    if (r.group) {
      const g = this.store.groups.find((x) => x.id === r.group)
      return g ? text(g, 'name') : ''
    }
    const people = r.subject ? [r.subject] : r.people
    return people.length > 0 ? people.map((id) => this.subjectName(id)).join(', ') : text(r, 'name')
  }

  protected screen() {
    const store = this.store
    const marks = this.marks()
    const month = this.month
    const days = monthDays(month)
    const now = today()
    const inMonth = `${month.year}-${String(month.month).padStart(2, '0')}`
    const picked = marks.get(this.picked)
    return html`<div class="calendar" data-role="calendar">
      <div>
        <div class="head">
          <dc-button variant="ghost" aria-label=${strings.calendarPrevious} data-role="calendar-previous" @click=${() => this.pickMonth(-1)}>‹</dc-button>
          <h2 data-role="calendar-month" aria-live="polite">${strings.calendarMonth(month.year, month.month)}</h2>
          <dc-button variant="ghost" aria-label=${strings.calendarNext} data-role="calendar-next" @click=${() => this.pickMonth(1)}>›</dc-button>
          <dc-button variant="secondary" data-role="calendar-today" ?disabled=${this.picked === now} @click=${() => this.pick(now)}>${strings.calendarToday}</dc-button>
          <div class="legend" aria-hidden="true">
            <span class="meeting"><i class="dot"></i>${strings.calendarMeetingsHeading}</span>
            <span class="follow-up"><i class="dot"></i>${strings.calendarFollowUpsHeading}</span>
            <span class="record"><i class="dot"></i>${strings.calendarRecordsKey}</span>
          </div>
        </div>
        <div class="month" role="group" aria-label=${strings.calendarMonth(month.year, month.month)} @keydown=${this.keydown}>
          ${strings.calendarWeekdays.map((w, i) => html`<div class="weekday ${i === 0 ? 'sunday' : i === 6 ? 'saturday' : ''}" aria-hidden="true">${w}</div>`)}
          ${days.map((day, i) => {
            const m = marks.get(day)
            const weekday = i % 7
            const classes = [
              'day',
              day.startsWith(inMonth) ? '' : 'outside',
              day === now ? 'today' : '',
              i < 7 ? 'first-week' : '',
              weekday === 0 ? 'sunday' : weekday === 6 ? 'saturday' : '',
            ].filter(Boolean)
            const overdue = m?.followUps.some((f) => f.overdue)
            return html`<button
              class=${classes.join(' ')}
              data-day=${day}
              aria-pressed=${day === this.picked ? 'true' : 'false'}
              aria-label=${[strings.calendarDay(day), m?.meetings.length ? strings.calendarMeetings(m.meetings.length) : '', m?.followUps.length ? strings.calendarFollowUps(m.followUps.length) : '', m?.records.length ? strings.calendarRecords(m.records.length) : ''].filter(Boolean).join(', ')}
              tabindex=${day === this.picked ? 0 : -1}
              @click=${() => this.pick(day)}
            >
              <span class="num">${Number(day.slice(8))}</span>
              ${m
                ? html`<span class="marks">
                    ${m.meetings.length ? html`<span class="mark meeting"><i class="dot"></i>${strings.calendarMeetings(m.meetings.length)}</span>` : nothing}
                    ${m.followUps.length ? html`<span class="mark follow-up ${overdue ? 'overdue' : ''}"><i class="dot"></i>${strings.calendarFollowUps(m.followUps.length)}</span>` : nothing}
                    ${m.records.length ? html`<span class="mark record"><i class="dot"></i>${strings.calendarRecords(m.records.length)}</span>` : nothing}
                  </span>`
                : nothing}
            </button>`
          })}
        </div>
        <p class="note">${strings.calendarNote}</p>
      </div>
      <aside data-role="calendar-day" aria-live="polite">
        <h3>${strings.calendarDay(this.picked)}</h3>
        ${picked
          ? html`${picked.meetings.length
              ? html`<section data-role="calendar-meetings">
                  <h4 class="meeting"><i class="dot"></i>${strings.calendarMeetingsHeading}</h4>
                  <ul>
                    ${picked.meetings.map((id) => html`<li><button class="open" @click=${() => this.openSubject(id)}>${this.subjectName(id)}</button></li>`)}
                  </ul>
                </section>`
              : nothing}
            ${picked.followUps.length
              ? html`<section data-role="calendar-follow-ups">
                  <h4 class="follow-up"><i class="dot"></i>${strings.calendarFollowUpsHeading}</h4>
                  <ul>
                    ${picked.followUps.map(
                      (f) => html`<li>
                        <button class="open" @click=${() => this.openSubject(f.subject)}>${this.subjectName(f.subject)}</button>
                        ${f.overdue ? html`<dc-badge variant="warning">${strings.calendarOverdue}</dc-badge>` : nothing}
                      </li>`,
                    )}
                  </ul>
                </section>`
              : nothing}
            ${picked.records.length
              ? html`<section data-role="calendar-records">
                  <h4 class="record"><i class="dot"></i>${strings.calendarRecordsHeading}</h4>
                  <ul>
                    ${picked.records.map((id) => {
                      const r = store.recordById(id)
                      if (!r) return nothing
                      const kind = store.kinds.find((k) => k.type === r.type)
                      return html`<li>
                        <button class="open" @click=${() => this.dispatchEvent(openSessionEvent(r))}>${this.recordWho(r) || (kind ? store.labelOf(kind) : r.type)}</button>
                        <span class="what">${kind ? store.labelOf(kind) : r.type}</span>
                      </li>`
                    })}
                  </ul>
                </section>`
              : nothing}`
          : html`<p class="nothing">${strings.calendarNothing}</p>`}
      </aside>
    </div>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'oc-calendar': OcCalendar
  }
}
