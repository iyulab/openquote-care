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
    .list-head {
      display: flex;
      flex-direction: column;
      gap: var(--dc-space-2, 8px);
      padding: var(--dc-space-3, 12px);
      border-bottom: 1px solid var(--dc-color-rule, #e2e2e4);
    }
    .pane.list {
      gap: 0;
    }
    .pane.list ul {
      padding: var(--dc-space-2, 8px);
    }
    @media ${desktopMedia} {
      .back {
        display: none;
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
    .plain li {
      padding: var(--dc-space-2, 8px) var(--dc-space-3, 12px);
    }
    .scroll {
      overflow-x: auto;
    }
    dc-card > .scroll {
      margin: calc(-1 * var(--dc-space-4, 16px));
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
    .metrics {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: var(--dc-space-3, 12px);
    }
  `,
]
