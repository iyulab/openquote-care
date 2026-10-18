import type { DcCheckbox } from '@iyulab/desktop-compact/checkbox'
import { html, nothing } from 'lit'
import { caseReport, choosableSubjectFields, type ReportLine, type ReportNameMask } from '../case-report.js'
import { caseTimeline } from '../cases.js'
import { text, today, type Entity } from '../records.js'
import { strings } from '../strings.js'
import { caseScaleWords } from './case-parts.js'
import { printEnd } from './parts.js'
import { valueText } from './session-parts.js'
import type { VaultStore } from './store.js'

/** What the counsellor chose for a case report: how the name shows, whether content goes in, the consent mark, the person's fields. */
export interface CaseReportChoices {
  mask: ReportNameMask
  withContent: boolean
  consent: boolean
  fields: ReadonlySet<string>
}

export const defaultReportChoices: CaseReportChoices = { mask: 'initial', withContent: false, consent: false, fields: new Set() }

/**
 * A report of one of a subject's cases (its index among them, oldest first), for supervision or a case conference:
 * the choices above it, on screen only, and the document under them — what goes on paper.
 */
export function caseReportDocument(
  store: VaultStore,
  subject: Entity,
  index: number,
  choices: CaseReportChoices,
  change: (next: Partial<CaseReportChoices>) => void,
  back: () => void,
) {
  const c = store.cases.get(subject.id)?.cases[index]
  if (!c) return nothing
  const busy = store.busy
  const entries = caseTimeline(c, (id) => {
    const r = store.recordById(id)
    return r ? store.dayOf(r) : ''
  })
  const subjectFields = store.fieldsOf(subject.type)
  const choosable = choosableSubjectFields(subjectFields).filter((f) => valueText(store, f, subject.fields[f.name]) !== '')
  const report = caseReport({
    name: text(subject, 'name'),
    mask: choices.mask,
    subject: subjectFields.map((f) => ({ field: f, text: valueText(store, f, subject.fields[f.name]) })),
    chosen: choices.fields,
    withContent: choices.withContent,
    records: entries.flatMap((e) => {
      const r = store.recordById(e.id)
      return r ? [{ id: r.id, type: r.type, day: e.day, after: e.after, group: r.group !== null, fields: r.fields }] : []
    }),
    kinds: store.kinds.map((k, i) => ({ type: k.type, label: store.labelOf(k), role: k.role ?? null, order: i, dated: store.datedOf(k.type) })),
    fieldsOf: (type) => store.fieldsOf(type),
    text: (f, v) => valueText(store, f, v),
    scaleType: store.scaleResponses?.type ?? null,
  })
  const scales = caseScaleWords(store, subject.id, index, c.records)
  const n = index + 1
  const toggle = (name: string, on: boolean) => {
    const fields = new Set(choices.fields)
    if (on) fields.add(name)
    else fields.delete(name)
    change({ fields })
  }
  return html`<dp-page-header heading=${strings.caseReportHeading(n)}></dp-page-header>
    <p class="muted no-print">${strings.caseReportLead}</p>
    <div class="toolbar no-print">
      <dc-button variant="secondary" data-role="case-report-back" @click=${back}>${strings.back}</dc-button>
      <dc-segmented-control
        data-role="case-report-mask"
        aria-label=${strings.nameMask}
        .options=${[
          { value: 'initial', label: strings.nameMaskInitial },
          { value: 'none', label: strings.nameMaskNone },
        ]}
        .value=${choices.mask}
        @change=${(e: Event) => change({ mask: (e.target as HTMLInputElement).value as ReportNameMask })}
      ></dc-segmented-control>
      <dc-button variant="primary" data-role="print" ?disabled=${busy} @click=${() => window.print()}>${strings.print}</dc-button>
    </div>
    <div class="report-choices no-print">
      <dc-checkbox data-role="case-report-consent" .checked=${choices.consent} @change=${(e: Event) => change({ consent: (e.target as DcCheckbox).checked })}
        >${strings.caseReportConsent}</dc-checkbox
      >
      <dc-checkbox data-role="case-report-content" .checked=${choices.withContent} @change=${(e: Event) => change({ withContent: (e.target as DcCheckbox).checked })}
        >${strings.caseReportContent}</dc-checkbox
      >
      ${choosable.length > 0
        ? html`<div class="report-pick" data-role="case-report-fields">
            <span class="muted">${strings.caseReportPick}</span>
            ${choosable.map(
              (f) => html`<dc-checkbox data-field=${f.name} .checked=${choices.fields.has(f.name)} @change=${(e: Event) => toggle(f.name, (e.target as DcCheckbox).checked)}
                >${f.label}</dc-checkbox
              >`,
            )}
          </div>`
        : nothing}
    </div>
    <article class="case-report" data-role="case-report">
      <header>
        <p class="report-eyebrow">${strings.caseReportPurpose}</p>
        <h2>${report.person} · ${strings.caseTitle(n)}</h2>
        <p class="muted">${strings.caseReportPeriod(c.start, c.end)} · ${strings.caseReportMade(today())}</p>
        <p data-role="case-report-consent-line">${choices.consent ? `☑ ${strings.caseReportConsent}` : strings.caseReportConsentNone}</p>
        ${choices.withContent ? html`<p class="report-note" data-role="case-report-content-note">${strings.caseReportContentNote}</p>` : nothing}
      </header>
      <section data-section="person">
        <h3>${strings.caseReportPerson}</h3>
        <dl>
          <dt>${strings.caseReportName}</dt>
          <dd data-role="case-report-person">${report.person}</dd>
          ${report.personFields.map((v) => html`<dt>${v.label}</dt><dd>${v.text}</dd>`)}
        </dl>
      </section>
      ${report.sections.map(
        (s) => html`<section data-section=${s.type}>
          <h3>${s.title}</h3>
          <ol>
            ${s.lines.map((l) => reportLine(l))}
          </ol>
        </section>`,
      )}
      ${scales.length > 0
        ? html`<section data-section="scales">
            <h3>${strings.caseReportScales}</h3>
            <ul>
              ${scales.map((line) => html`<li>${line}</li>`)}
            </ul>
          </section>`
        : nothing}
      ${[strings.caseReportUnderstanding, strings.caseReportQuestions].map(
        (title) => html`<section class="report-write">
          <h3>${title}</h3>
          <div class="report-blank"><span class="muted no-print">${strings.caseReportWriteHere}</span></div>
        </section>`,
      )}
      ${printEnd()}
    </article>`
}

/** A record of the report: its day, marks for a group record and one after the case ended, its values, then its content. */
function reportLine(l: ReportLine) {
  return html`<li>
    <span class="day">${l.day}</span>
    <span class="report-values">
      ${l.group ? html`<span class="report-mark">${strings.caseReportGroup}</span>` : nothing}
      ${l.after ? html`<span class="report-mark">${strings.caseTimelineAfter}</span>` : nothing}
      ${l.values.map((v, i) => html`${i > 0 ? ' · ' : ''}<span class="muted">${v.label}</span> ${v.text}`)}
    </span>
    ${l.content.map((v) => html`<p class="report-content"><span class="muted">${v.label}</span> ${v.text}</p>`)}
  </li>`
}

