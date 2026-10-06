import { css } from 'lit'
import { tableStyles } from '@iyulab/desktop-compact/table-styles'
import { desktopMedia } from '@iyulab/desktop-patterns/breakpoints'

/** The layout every vault screen shares; the look comes from the library parts and the app theme. */
export const vaultStyles = [
  tableStyles,
  css`
    .pane {
      display: flex;
      flex-direction: column;
      gap: var(--dc-space-6, 24px);
      box-sizing: border-box;
      min-height: 100%;
    }
    .pane.document {
      min-width: 0;
      padding-block: var(--dc-space-5, 20px) var(--dc-space-6, 24px);
    }
    /* Above a list: what adds to it at the start, the way to fold it away at the end (while wide only). */
    .list-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--dc-space-2, 8px);
      padding: var(--dc-space-3, 12px);
      border-bottom: 1px solid var(--dc-color-rule, #e2e2e4);
    }
    .pane.list {
      gap: 0;
    }
    /* Finding in a list: the words on a line of their own under the add and fold buttons, then what narrows it. */
    .list-tools {
      order: 1;
      flex-basis: 100%;
      display: flex;
      flex-direction: column;
      gap: var(--dc-space-2, 8px);
    }
    .list-filters {
      display: flex;
      gap: var(--dc-space-2, 8px);
    }
    .list-filters > dc-select {
      flex: 1 1 0;
      min-width: 0;
    }
    .pane.list ul {
      padding: var(--dc-space-2, 8px);
    }
    /* Folding the list is for a wide window, where list and document stand side by side. */
    .list-head .fold,
    .unfold {
      display: none;
    }
    .list-head .fold {
      margin-left: auto;
    }
    @media ${desktopMedia} {
      .back {
        display: none;
      }
      .list-head .fold {
        display: inline-block;
      }
      .unfold {
        display: block;
        margin-bottom: calc(-1 * var(--dc-space-3, 12px));
      }
      .pane.document {
        padding-inline: var(--dc-space-6, 24px);
      }
    }
    section {
      display: flex;
      flex-direction: column;
      gap: var(--dc-space-3, 12px);
      min-width: 0;
    }
    p {
      margin: 0;
    }
    .muted,
    .detail {
      color: var(--dc-color-text-muted, #8a8a92);
    }
    .detail {
      font-size: var(--dc-font-size-sm, 12px);
    }
    .error {
      color: var(--dc-color-danger-text, #b91c1c);
    }
    /* Bottom-aligned, unlike the welcome screens' rows: here a row lines buttons up with labelled fields. */
    .row {
      display: flex;
      gap: var(--dc-space-2, 8px);
      align-items: end;
      flex-wrap: wrap;
    }
    .row > dc-field {
      flex: 1 1 160px;
    }
    /* A grid of fields: four across when wide, one when narrow; written content spans the row. */
    .fields {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: var(--dc-space-3, 12px) var(--dc-space-4, 16px);
    }
    .fields > .wide {
      grid-column: 1 / -1;
    }
    /* The body of a card or callout: its parts one under another. */
    .stack {
      display: flex;
      flex-direction: column;
      gap: var(--dc-space-4, 16px);
    }
    .stack h3 {
      margin: 0;
      font-size: var(--dc-font-size-md, 14px);
    }
    /* A subject's cases, one to an item: its name, days and state on a line, and under them what it holds. */
    ul.cases {
      gap: var(--dc-space-3, 12px);
    }
    ul.cases li {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--dc-space-1, 4px) var(--dc-space-3, 12px);
    }
    ul.cases li > div {
      flex-basis: 100%;
    }
    /* A subject's list split by case: the case's heading as a row over its records, quieter than the column heads. */
    tr.case-head > th {
      font-size: var(--dc-font-size-sm, 12px);
      font-weight: var(--dc-font-weight-semibold, 600);
      color: var(--dc-color-text-muted, #8a8a92);
      padding-top: var(--dc-space-3, 12px);
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    li button {
      all: unset;
      box-sizing: border-box;
      position: relative;
      width: 100%;
      display: grid;
      gap: 1px;
      padding: var(--dc-space-2, 8px) var(--dc-space-3, 12px);
      border-radius: var(--dc-radius-md, 6px);
      cursor: pointer;
    }
    li button .label {
      font-weight: var(--dc-font-weight-medium, 500);
    }
    li button .meta {
      font-size: var(--dc-font-size-sm, 12px);
      color: var(--dc-color-text-muted, #8a8a92);
    }
    li button:hover {
      background: var(--dc-color-surface-hover, #ececed);
    }
    li button:focus-visible {
      outline: 2px solid var(--dc-color-accent, #2563eb);
    }
    li button[aria-current='true'] {
      background: var(--dc-selection-bg, var(--dc-color-surface, #f7f7f8));
    }
    li button[aria-current='true']::before {
      content: '';
      position: absolute;
      left: 2px;
      top: 9px;
      bottom: 9px;
      width: 3px;
      border-radius: 3px;
      background: var(--dc-indicator-color, var(--dc-color-accent, #2563eb));
    }
    /* A heading among a list's entries, quieter than they are: the entries under it go together. */
    li.list-group {
      padding: var(--dc-space-3, 12px) var(--dc-space-3, 12px) var(--dc-space-1, 4px);
      font-size: var(--dc-font-size-xs, 11px);
      font-weight: var(--dc-font-weight-semibold, 600);
      color: var(--dc-color-text-muted, #8a8a92);
    }
    li.list-group:first-child {
      padding-top: var(--dc-space-1, 4px);
    }
    .plain li {
      padding: var(--dc-space-2, 8px) var(--dc-space-3, 12px);
    }
    .scroll {
      overflow-x: auto;
    }
    dc-card > .scroll {
      margin: calc(-1 * var(--dc-space-4, 16px));
    }
    /*
     * A long table scrolls in a box of its own, so its header row stays in view (the header is sticky to the box
     * that scrolls). An edge that has more beyond it shades: the shade sits under the cells and a cover the
     * width of the shade travels with the content, hiding it at either end.
     */
    .scroll.bounded {
      max-height: max(320px, calc(100vh - 260px));
      overflow: auto;
      background:
        linear-gradient(to right, var(--dc-card-bg, #ffffff) 40%, transparent) left / 32px 100%,
        linear-gradient(to left, var(--dc-card-bg, #ffffff) 40%, transparent) right / 32px 100%,
        radial-gradient(farthest-side at 0 50%, rgba(60, 45, 30, 0.16), transparent) left / 12px 100%,
        radial-gradient(farthest-side at 100% 50%, rgba(60, 45, 30, 0.16), transparent) right / 12px 100%;
      background-repeat: no-repeat;
      background-attachment: local, local, scroll, scroll;
    }
    table.export td,
    table.export th {
      white-space: nowrap;
    }
    td.wrap {
      white-space: normal;
    }
    fieldset.picker {
      border: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-wrap: wrap;
      gap: var(--dc-space-2, 8px) var(--dc-space-4, 16px);
    }
    fieldset.picker legend {
      padding: 0;
      margin-bottom: var(--dc-space-1, 4px);
      font-size: var(--dc-field-label-size, 13px);
      font-weight: var(--dc-field-label-weight, 500);
      color: var(--dc-field-label-color, #55555c);
    }
    tr[data-note] td {
      background: var(--dc-color-surface, #f7f7f8);
      white-space: normal;
    }
    .note p {
      margin: var(--dc-space-1, 4px) 0 0;
      white-space: pre-wrap;
    }
    .people {
      margin-left: 2px;
      font-size: var(--dc-font-size-sm, 12px);
      color: var(--dc-color-text-muted, #8a8a92);
    }
    button.cell {
      all: unset;
      cursor: pointer;
      padding: 1px var(--dc-space-1, 4px);
      margin: -1px calc(-1 * var(--dc-space-1, 4px));
      border-radius: var(--dc-radius-sm, 4px);
      color: var(--dc-color-accent-text, #1d4ed8);
    }
    button.cell:hover {
      background: var(--dc-color-accent-subtle, #e0e7ff);
    }
    button.cell:focus-visible {
      outline: 2px solid var(--dc-color-accent, #2563eb);
    }
    button.conflict {
      margin-left: var(--dc-space-2, 8px);
      color: var(--dc-color-danger-text, #b91c1c);
      font-size: var(--dc-font-size-sm, 12px);
    }
    button.conflict:hover {
      background: var(--dc-color-danger-subtle, #fee2e2);
    }
    /* A report split by a third dimension: one section on screen, every one of them on paper, each under its label. */
    .print-only,
    .section[hidden] {
      display: none;
    }
    .section-label {
      margin: var(--dc-space-3, 12px) 0 var(--dc-space-1, 4px);
      font-weight: var(--dc-font-weight-semibold, 600);
    }
    /* What a subject's or practitioner's record holds, under its name: short values run on one line, label then
       value, and wrap as a line would; written content takes a line of its own. */
    dl.record-fields {
      display: flex;
      flex-wrap: wrap;
      gap: var(--dc-space-1, 4px) var(--dc-space-5, 20px);
      margin: 0;
    }
    dl.record-fields div {
      display: flex;
      align-items: baseline;
      gap: var(--dc-space-2, 8px);
    }
    dl.record-fields div:has(dd.narrative) {
      flex-basis: 100%;
      flex-direction: column;
      gap: var(--dc-space-1, 4px);
    }
    dl.record-fields dt {
      font-size: var(--dc-font-size-sm, 12px);
      color: var(--dc-color-text-muted, #8a8a92);
    }
    dl.record-fields dd {
      margin: 0;
      font-weight: var(--dc-font-weight-medium, 500);
    }
    dl.record-fields dd.narrative {
      white-space: pre-wrap;
      font-weight: inherit;
    }
    dl.legend {
      display: grid;
      gap: 2px;
      margin: 0;
      font-size: var(--dc-font-size-sm, 12px);
    }
    dl.legend div {
      display: flex;
      gap: var(--dc-space-2, 8px);
    }
    dl.legend dt {
      font-weight: var(--dc-font-weight-semibold, 600);
      min-width: 5em;
    }
    dl.legend dd {
      margin: 0;
      color: var(--dc-color-text-secondary, #55555c);
    }
    /* The figures over a report, all on one line at the document's width. */
    .metrics {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: var(--dc-space-3, 12px);
    }
    /* A figure that asks for attention only when it is above nought: at nought it steps back to a plain line. */
    .metrics dc-metric.quiet {
      --dc-card-bg: transparent;
      --dc-card-elevation: none;
      --dc-card-border: 1px dashed var(--dc-color-rule, #e2e2e4);
      --dc-metric-size: var(--dc-font-size-xl, 18px);
      color: var(--dc-color-text-muted, #8a8a92);
    }
    /* A document's controls under its heading, on one line: bottom-aligned, so a labelled date field and a button share it. */
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: end;
      gap: var(--dc-space-2, 8px) var(--dc-space-3, 12px);
    }
    .toolbar > dc-field {
      flex: 0 1 180px;
    }
    /* A month: a step back, its year and month, a step on. */
    .period {
      display: inline-flex;
      align-items: center;
      gap: var(--dc-space-1, 4px);
    }
    .period > dc-select {
      width: 9em;
    }
    .period > dc-select + dc-select {
      width: 6.5em;
    }
    /* A count of nought is a fact, not a finding: it reads in the quiet text, away from the counts that lead somewhere. */
    td.num.zero {
      color: var(--dc-color-text-muted, #8a8a92);
    }
    /*
     * A report's table and what a count is made of: one under the other, and side by side once the document is
     * wide enough for both (the list folded, the menu at its icons) — the records stay in view beside the table.
     */
    .pane.document {
      container-type: inline-size;
    }
    /* A switch above a table is as wide as its words: a press beside them is not a press on it. */
    section > dc-checkbox {
      align-self: flex-start;
    }
    .report-body,
    .report-aside {
      display: flex;
      flex-direction: column;
      gap: var(--dc-space-6, 24px);
      min-width: 0;
    }
    @container (min-width: 960px) {
      .report-body {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(320px, 36%);
        align-items: start;
      }
      .report-aside {
        position: sticky;
        top: 0;
        max-height: calc(100vh - 140px);
        overflow: auto;
      }
    }
    /* The count whose records are listed beside or below the table. */
    button.cell[aria-pressed='true'] {
      background: var(--dc-selection-bg, var(--dc-color-accent-subtle, #e0e7ff));
      outline: 2px solid var(--dc-color-accent, #2563eb);
      outline-offset: -1px;
    }
    /* On paper, and last so it outranks the rules above: the document alone — no way back to the list, no controls — and wide tables wrap instead of scrolling. */
    @media print {
      .print-only,
      .section[hidden] {
        display: block;
      }
      .no-print,
      .back {
        display: none;
      }
      /* Paper keeps the form whole: rows counting nothing come back, and the records follow the table. */
      tr.empty[hidden] {
        display: table-row;
      }
      .report-body {
        display: block;
      }
      .report-aside {
        position: static;
        max-height: none;
        overflow: visible;
      }
      .scroll,
      .scroll.bounded {
        overflow: visible;
        max-height: none;
        background: none;
      }
      table.export td,
      table.export th {
        white-space: normal;
      }
    }
  `,
]
