import { html, nothing } from 'lit'
import { byCase, caseCounts, caseDays, caseHead, caseStateBesideDays, caseTimeline, followUpWords, scaleLine, scaleSeries, showsCases, type CaseGroup, type ScalePoint } from '../cases.js'
import { listColumns } from '../fields.js'
import { labelOf } from '../records.js'
import type { PlainCase } from '../plain-copy.js'
import type { Entity } from '../records.js'
import { strings } from '../strings.js'
import { valueText } from './session-parts.js'
import type { VaultStore } from './store.js'

/**
 * A subject's cases, newest first: each with its days, its state, its records counted by kind, and what came
 * after it ended. Shown only when some record opened or closed a case, and only when the packs say which kinds do.
 */
export function caseSection(store: VaultStore, subject: string) {
  const subjectCases = store.cases.get(subject)
  const { opens, closes } = store.caseKinds()
  if (!opens || !closes || !showsCases(subjectCases)) return nothing
  const opening = store.labelOf(opens)
  const closing = store.labelOf(closes)
  const kinds = store.kinds.map((k) => ({ type: k.type, label: store.labelOf(k) }))
  const typeOf = (id: string) => store.recordById(id)?.type
  const numbered = subjectCases.cases.map((c, i) => ({ c, n: i + 1 })).reverse()
  const latest = subjectCases.cases.length
  return html`<section data-role="cases">
    <dc-section-heading marker size="lg" heading=${strings.cases}></dc-section-heading>
    <p class="muted">${strings.caseLead(opening, closing)}</p>
    <dc-card>
      <ul class="cases">
        ${numbered.map(
          ({ c, n }) => html`<li data-case=${n} data-open=${c.open ? 'yes' : 'no'}>
            <strong>${strings.caseTitle(n)}</strong>
            <span>${caseDays(c)}</span>
            <span>${caseStateBesideDays(c, opening)}</span>
            ${followUpWords(c) ? html`<span data-role="follow-up" data-follow-up=${c.followUp}>${followUpWords(c)}</span>` : nothing}
            ${c.opening === null ? html`<span class="muted">${strings.caseWithoutOpening(opening)}</span>` : nothing}
            <div class="muted">${caseCounts(c, kinds, typeOf)}${c.afterClosing.length > 0 ? html` · <span data-role="after-closing">${strings.caseAfterClosing(c.afterClosing.length)}</span>` : nothing}</div>
            ${scaleRows(store, subject, n - 1, [...c.records])}
            ${timeline(store, caseTimeline(c, (id) => { const r = store.recordById(id); return r ? store.dayOf(r) : '' }), n === latest)}
          </li>`,
        )}
      </ul>
      ${subjectCases.undated.length > 0 ? html`<p class="muted" data-role="undated">${strings.caseUndated(subjectCases.undated.length)}</p>` : nothing}
    </dc-card>
  </section>`
}

/**
 * How a subject's lists split their records by case, newest case first — or undefined when the subject's cases are
 * not shown, and the lists stay one run of rows.
 */
export function recordsByCase(store: VaultStore, subject: string): ((records: Entity[]) => CaseGroup<Entity>[]) | undefined {
  const subjectCases = store.cases.get(subject)
  const { opens, closes } = store.caseKinds()
  if (!opens || !closes || !showsCases(subjectCases)) return undefined
  const opening = store.labelOf(opens)
  return (records) => byCase(records, subjectCases, opening)
}

/**
 * A subject's cases in words for the copy that reads without the app, newest first — each one's heading, what it
 * holds by kind, what came after it ended, and each scale's first and last score; none when the subject's cases are not shown.
 */
export function plainCases(store: VaultStore, subject: string): PlainCase[] {
  const subjectCases = store.cases.get(subject)
  const { opens, closes } = store.caseKinds()
  if (!opens || !closes || !showsCases(subjectCases)) return []
  const opening = store.labelOf(opens)
  const kinds = store.kinds.map((k) => ({ type: k.type, label: store.labelOf(k) }))
  const typeOf = (id: string) => store.recordById(id)?.type
  return subjectCases.cases
    .map((c, i) => ({
      start: c.start,
      end: c.end,
      line: [
        caseHead(c, i + 1, opening),
        caseCounts(c, kinds, typeOf),
        ...(c.afterClosing.length > 0 ? [strings.caseAfterClosing(c.afterClosing.length)] : []),
        ...(store.scaleCases.get(subject)?.[i]?.scales ?? []).map((s) => scaleLine(s, scaleLabel(store, s.baseline.record, s.scale))),
      ]
        .filter(Boolean)
        .join(' · '),
    }))
    .reverse()
}

/** A scale as people read it: the label of the code a response names, in the version it was written in. */
export function scaleLabel(store: VaultStore, record: string, code: string): string {
  const entity = store.recordById(record)
  const value = entity && Object.values(entity.fields).find((v) => typeof v === 'object' && v !== null && (v as { code?: unknown }).code === code)
  return (value !== undefined && labelOf(store.schemes, value)) || code
}

/**
 * A case's scale scores, a line to a scale — the first score and the last, with the change between them — and the
 * responses whose score could not be read. Nothing when the case has none.
 */
function scaleRows(store: VaultStore, subject: string, index: number, records: string[]) {
  const caseScales = store.scaleCases.get(subject)?.[index]
  if (!caseScales || caseScales.scales.length + caseScales.unusable.length === 0) return nothing
  const labelFor = (record: string, code: string) => scaleLabel(store, record, code)
  const series = caseScaleSeries(store, records)
  return html`<ul class="scales" data-role="case-scales">
    ${caseScales.scales.map((s) => {
      const label = labelFor(s.baseline.record, s.scale)
      const points = series.get(s.scale) ?? []
      return html`<li data-scale=${s.scale} data-paired=${s.paired ? 'yes' : 'no'}>${scaleLine(s, label)}</li>
        ${points.length >= 3 ? seriesRow(store, s.scale, label, points) : nothing}`
    })}
    ${caseScales.unusable.length > 0 ? html`<li class="muted" data-role="unusable">${strings.caseScaleUnusable(caseScales.unusable.length)}</li>` : nothing}
  </ul>`
}

/** Every score each scale has among a case's records, by day — read from the records the vault keeps scale scores in. */
function caseScaleSeries(store: VaultStore, records: readonly string[]): Map<string, ScalePoint[]> {
  const responses = store.scaleResponses
  if (!responses) return new Map()
  return scaleSeries(
    records,
    (id) => {
      const r = store.recordById(id)
      if (!r || r.type !== responses.type) return undefined
      const code = (r.fields[responses.scale] as { code?: unknown } | undefined)?.code
      const score = Number(r.fields[responses.score])
      return typeof code === 'string' ? { scale: code, day: store.dayOf(r), score } : undefined
    },
    (scale) => store.scales.find((s) => s.code === scale),
  )
}

/**
 * A scale's every score in a case, when it has more than a first and a last: the scores in words, and a small line
 * drawn over the scale's whole range — no bands, no colours, nothing that says better or worse.
 */
function seriesRow(store: VaultStore, scale: string, label: string, points: ScalePoint[]) {
  const range = store.scales.find((s) => s.code === scale)!
  const span = range.max - range.min || 1
  const w = 96
  const h = 20
  const at = points.map((p, i) => `${((i / (points.length - 1)) * w).toFixed(1)},${(h - ((p.score - range.min) / span) * h).toFixed(1)}`).join(' ')
  const words = points.map((p) => strings.caseScalePoint(p.score, p.day)).join(' → ')
  return html`<li class="series" data-role="scale-series" data-scale=${scale}>
    <svg class="spark" viewBox="0 0 ${w} ${h}" width=${w} height=${h} aria-hidden="true"><polyline points=${at} fill="none" stroke="currentColor" stroke-width="1.5" /></svg>
    <span>${strings.caseScaleSeries(label, words)}</span>
  </li>`
}

/** A case's records by day, each with its kind and its first values; open for the latest case, folded for the others. */
function timeline(store: VaultStore, entries: ReturnType<typeof caseTimeline>, open: boolean) {
  if (entries.length === 0) return nothing
  return html`<details class="timeline" data-role="case-timeline" ?open=${open}>
    <summary>${strings.caseTimeline(entries.length)}</summary>
    <ol>
      ${entries.map((e) => {
        const r = store.recordById(e.id)
        if (!r) return nothing
        const kind = store.kinds.find((k) => k.type === r.type)
        const values = listColumns(store.fieldsOf(r.type))
          .filter((f) => f.kind !== 'date' && f.kind !== 'reference')
          .map((f) => valueText(store, f, r.fields[f.name]))
          .filter(Boolean)
          .slice(0, 2)
        return html`<li data-record=${e.id} data-type=${r.type} data-after=${e.after ? 'yes' : 'no'}>
          <span class="day">${e.day}</span>
          <strong>${kind ? store.labelOf(kind) : r.type}</strong>
          ${values.length > 0 ? html`<span>${values.join(' · ')}</span>` : nothing}
          ${e.after ? html`<span class="muted">${strings.caseTimelineAfter}</span>` : nothing}
        </li>`
      })}
    </ol>
  </details>`
}
