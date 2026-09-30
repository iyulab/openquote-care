import { css } from 'lit'

/** The look every vault screen shares. */
export const vaultStyles = css`
  .columns {
    display: grid;
    grid-template-columns: minmax(200px, 280px) 1fr;
    gap: var(--dc-space-5, 24px);
    align-items: start;
  }
  section {
    display: flex;
    flex-direction: column;
    gap: var(--dc-space-3, 12px);
    min-width: 0;
  }
  h2,
  h3 {
    margin: 0;
    font-weight: 600;
  }
  h2 {
    font-size: 16px;
  }
  h3 {
    font-size: 14px;
  }
  p {
    margin: 0;
  }
  .muted {
    color: var(--dc-color-text-secondary, #5e5c57);
  }
  .row {
    display: flex;
    gap: var(--dc-space-2, 8px);
    align-items: end;
    flex-wrap: wrap;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  li button {
    all: unset;
    box-sizing: border-box;
    width: 100%;
    padding: var(--dc-space-2, 8px) var(--dc-space-3, 12px);
    border-radius: var(--dc-radius-md, 6px);
    cursor: pointer;
  }
  li button:hover {
    background: var(--dc-color-surface-hover, #eee);
  }
  li button:focus-visible {
    outline: 2px solid var(--dc-color-accent, #4a5bd4);
  }
  .scroll {
    overflow-x: auto;
  }
  table.export td,
  table.export th {
    white-space: nowrap;
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
    font-size: 13px;
  }
  li button[aria-current='true'] {
    background: var(--dc-color-surface, #f2f2f2);
    font-weight: 600;
  }
  .plain li {
    padding: var(--dc-space-2, 8px) var(--dc-space-3, 12px);
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 13px;
  }
  th,
  td {
    text-align: left;
    padding: var(--dc-space-2, 8px);
    border-bottom: 1px solid var(--dc-color-border, #e2e2e4);
  }
  th {
    font-weight: 600;
    color: var(--dc-color-text-secondary, #5e5c57);
  }
  label {
    display: flex;
    flex-direction: column;
    gap: var(--dc-space-1, 4px);
    font-size: 13px;
    flex: 1 1 160px;
  }
  label.wide {
    flex-basis: 100%;
  }
  tr[data-note] td {
    background: var(--dc-color-surface-hover, #f7f7f5);
  }
  .note p {
    margin: var(--dc-space-1, 4px) 0 0;
    white-space: pre-wrap;
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: var(--dc-space-3, 12px);
    padding: var(--dc-space-4, 16px);
    border: 1px solid var(--dc-color-border, #e2e2e4);
    border-radius: var(--dc-radius-md, 6px);
  }
  .error {
    color: var(--dc-color-danger, #b00020);
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .people {
    color: var(--dc-color-text-muted, #666);
  }
  tbody th {
    font-weight: 400;
    color: inherit;
  }
  tfoot th,
  tfoot td {
    font-weight: 600;
    border-top: 2px solid var(--dc-color-border, #e2e2e4);
  }
  .groups {
    width: auto;
  }
  button.cell {
    all: unset;
    cursor: pointer;
    padding: 0 var(--dc-space-1, 4px);
    border-radius: var(--dc-radius-sm, 4px);
    color: var(--dc-color-accent, #4a5bd4);
    text-decoration: underline;
  }
  button.conflict {
    margin-left: var(--dc-space-2, 8px);
    color: var(--dc-color-danger, #b00020);
    font-size: 12px;
  }
  button.cell:focus-visible {
    outline: 2px solid var(--dc-color-accent, #4a5bd4);
  }
  .detail {
    font-size: 12px;
  }
  dl.legend {
    display: grid;
    gap: 2px;
    margin: 0 0 8px;
    font-size: 12px;
  }
  dl.legend div {
    display: flex;
    gap: 8px;
  }
  dl.legend dt {
    font-weight: 600;
    min-width: 5em;
  }
  dl.legend dd {
    margin: 0;
    color: var(--dc-color-text-secondary, #5e5c57);
  }
`
