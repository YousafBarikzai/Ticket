import { css, layer, mq } from '../styles/css.js';

/**
 * `HierNav`: nested link lists — CMDB classes, organisations. Rows look and
 * behave like the sidebar's (nav item height, `surface.hover`, the current
 * one `surface.selected` with a 3 px accent bar and 600), each level indented
 * one step with a hairline guide so the nesting reads at a glance. Counts sit
 * at the end in `footnote` tabular figures.
 */
export const hierNavStyles = layer(
  'components',
  css`
.itsm-HierNav {
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
}
.itsm-HierNav__list {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-3xs);
  margin: 0;
  padding: 0;
  list-style: none;
}
.itsm-HierNav__list .itsm-HierNav__list {
  margin-block-start: var(--itsm-space-3xs);
  margin-inline-start: var(--itsm-space-sm);
  padding-inline-start: var(--itsm-space-xs);
  border-inline-start: var(--itsm-hairline) solid var(--itsm-colour-border-subtle);
}
.itsm-HierNav__link {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--itsm-space-xs);
  min-block-size: var(--itsm-nav-item-height);
  padding: 0 var(--itsm-space-xs);
  border-radius: var(--itsm-radius-md);
  color: var(--itsm-colour-text-primary);
  text-decoration: none;
  transition: background-color var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-HierNav__link:hover {
  background: var(--itsm-colour-surface-hover);
}
.itsm-HierNav__link:focus-visible {
  outline-offset: calc(-1 * var(--itsm-focus-width));
  box-shadow: none;
}
.itsm-HierNav__link[aria-current="page"] {
  background: var(--itsm-colour-surface-selected);
  font-weight: var(--itsm-font-weight-semibold);
}
.itsm-HierNav__link[aria-current="page"]::before {
  content: '';
  position: absolute;
  inset-block: var(--itsm-space-2xs);
  inset-inline-start: 0;
  inline-size: 3px;
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-accent);
}
.itsm-HierNav__label {
  flex: 1 1 auto;
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.itsm-HierNav__count {
  flex: none;
  color: var(--itsm-colour-text-muted);
  font-size: var(--itsm-text-footnote-size);
  font-weight: var(--itsm-font-weight-regular);
  font-variant-numeric: tabular-nums;
}

${mq.forcedColors} {
  .itsm-HierNav__link[aria-current="page"] {
    outline: var(--itsm-border-thick) solid Highlight;
    outline-offset: calc(-1 * var(--itsm-border-thick));
  }
}
`,
);
