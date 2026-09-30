import { css, layer, mq } from '../styles/css.js';

/**
 * `FormSection`: a heading (`headline`, 17/22 semibold), a description in
 * secondary `callout` text, optional guidance, then the fields.
 *
 * Sections follow one another with a hairline between them and room either
 * side of it — the divider is for the eye, the space is what separates.
 *
 * Every layout decision is a container query on the section itself, so the
 * same section reads right in a 400 px sheet and on a 1200 px settings page:
 *
 * - below 52 rem the header sits above the fields;
 * - from 52 rem (collapsible sections excepted) the header takes a column on the left and the fields a column
 *   twice as wide on the right, with the guidance (`aside`) under the
 *   description — beside the fields, where it is read while answering;
 * - `columns={2}` sets fields out in pairs once the fields column is 36 rem
 *   wide; a field holding a text area or a group, or marked
 *   `data-span="full"`, keeps the whole row.
 *
 * The collapsible variant's summary is a quiet full-width row (fill on hover,
 * like a disclosure) with a chevron that turns a quarter when open; its
 * content slides open where the browser can animate to `auto` height, and
 * simply appears elsewhere and under reduced motion.
 */
export const formSectionStyles = layer(
  'components',
  css`
.itsm-FormSection {
  container-type: inline-size;
  min-inline-size: 0;
}

.itsm-FormSection + .itsm-FormSection {
  margin-block-start: var(--itsm-space-lg);
  padding-block-start: var(--itsm-space-lg);
  border-block-start: var(--itsm-hairline) solid var(--itsm-colour-border-subtle);
}

.itsm-FormSection__header {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-2xs);
  margin-block-end: var(--itsm-space-md);
  min-inline-size: 0;
}

.itsm-FormSection__title {
  margin: 0;
  font-size: var(--itsm-text-headline-size);
  line-height: var(--itsm-text-headline-line);
  letter-spacing: var(--itsm-text-headline-tracking);
  font-weight: var(--itsm-text-headline-weight);
  color: var(--itsm-colour-text-primary);
}

.itsm-FormSection__description {
  margin: 0;
  max-inline-size: 68ch;
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
  font-weight: var(--itsm-font-weight-regular);
  color: var(--itsm-colour-text-secondary);
}

.itsm-FormSection__aside {
  margin-block-start: var(--itsm-space-xs);
  padding: var(--itsm-space-sm) var(--itsm-space-md);
  border-radius: var(--itsm-radius-lg);
  background: var(--itsm-colour-surface-sunken);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  color: var(--itsm-colour-text-secondary);
}

.itsm-FormSection__aside > :where(p) {
  margin: 0;
}

.itsm-FormSection__aside > :where(p + p) {
  margin-block-start: var(--itsm-space-2xs);
}

.itsm-FormSection__fields {
  container-type: inline-size;
  min-inline-size: 0;
}

/* The last field's own bottom margin is the section's. */
.itsm-FormSection__grid > :last-child {
  margin-block-end: 0;
}

@container (min-width: 52rem) {
  .itsm-FormSection__layout {
    display: grid;
    grid-template-columns: minmax(12rem, 1fr) minmax(0, 2fr);
    column-gap: var(--itsm-space-xl);
    align-items: start;
  }

  .itsm-FormSection__layout > .itsm-FormSection__header {
    margin-block-end: 0;
  }
}

@container (min-width: 36rem) {
  .itsm-FormSection__grid[data-columns="2"] {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--itsm-space-md);
    align-items: start;
  }

  /* In the grid, the gap spaces the fields; their own margins would double it. */
  .itsm-FormSection__grid[data-columns="2"] > * {
    margin-block-end: 0;
  }

  .itsm-FormSection__grid[data-columns="2"] > :is([data-span="full"], fieldset, .itsm-Field--inline) {
    grid-column: 1 / -1;
  }
}

@supports selector(:has(*)) {
  @container (min-width: 36rem) {
    .itsm-FormSection__grid[data-columns="2"] > :has(textarea, fieldset) {
      grid-column: 1 / -1;
    }
  }
}

/* Collapsible: the summary row. */

.itsm-FormSection__summary {
  display: flex;
  align-items: flex-start;
  gap: var(--itsm-space-xs);
  margin-inline: calc(-1 * var(--itsm-space-xs));
  padding: var(--itsm-space-xs);
  border-radius: var(--itsm-radius-lg);
  cursor: pointer;
  list-style: none;
  transition: background-color var(--itsm-duration-fast) var(--itsm-easing-standard);
}

.itsm-FormSection__summary::-webkit-details-marker {
  display: none;
}

.itsm-FormSection__summary:hover {
  background: var(--itsm-colour-fill-hover);
}

.itsm-FormSection__summary:active {
  background: var(--itsm-colour-fill-pressed);
}

.itsm-FormSection__chevron {
  flex: none;
  margin-block: calc((var(--itsm-text-headline-line) - var(--itsm-icon-sm)) / 2);
  color: var(--itsm-colour-text-muted);
  transition: transform var(--itsm-duration-normal) var(--itsm-easing-emphasised);
}

.itsm-FormSection--collapsible[open] > .itsm-FormSection__summary .itsm-FormSection__chevron {
  transform: rotate(90deg);
}

[dir="rtl"] .itsm-FormSection--collapsible[open] > .itsm-FormSection__summary .itsm-FormSection__chevron {
  transform: scaleX(-1) rotate(90deg);
}

.itsm-FormSection__summaryText {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-3xs);
  min-inline-size: 0;
}

.itsm-FormSection__content {
  padding-block-start: var(--itsm-space-md);
  padding-inline-start: calc(var(--itsm-icon-sm) + var(--itsm-space-xs));
}

.itsm-FormSection__content > .itsm-FormSection__aside {
  margin-block: 0 var(--itsm-space-md);
}

@supports (interpolate-size: allow-keywords) and selector(::details-content) {
  .itsm-FormSection--collapsible {
    interpolate-size: allow-keywords;
  }
  .itsm-FormSection--collapsible::details-content {
    block-size: 0;
    overflow-y: clip;
    transition:
      block-size var(--itsm-duration-normal) var(--itsm-easing-emphasised),
      content-visibility var(--itsm-duration-normal) var(--itsm-easing-emphasised) allow-discrete;
  }
  .itsm-FormSection--collapsible[open]::details-content {
    block-size: auto;
  }
}

${mq.forcedColors} {
  .itsm-FormSection + .itsm-FormSection {
    border-block-start-color: CanvasText;
  }
  .itsm-FormSection__summary:hover {
    outline: var(--itsm-hairline) solid CanvasText;
  }
}
`,
);
