import { css, layer } from '../styles/css.js';

/**
 * `DescriptionList`: terms in `subheadline` (13/18, 500) in `text.secondary`,
 * values in `body` — `callout` when dense — in `text.primary` (SPEC §1.7).
 *
 * The list is its own inline-size container, so the inline layout decides
 * for itself when it is too narrow for two columns (an inspector in a sheet
 * on a phone) and stacks, with no breakpoint to keep in step with the frame.
 * Long values — an address, an id — wrap anywhere rather than overflow.
 */
export const descriptionListStyles = layer(
  'components',
  css`
.itsm-DescriptionList {
  --_itsm-dl-gap: var(--itsm-space-md);
  container-type: inline-size;
  display: grid;
  gap: var(--_itsm-dl-gap);
  margin: 0;
  min-inline-size: 0;
}

.itsm-DescriptionList[data-dense] {
  --_itsm-dl-gap: var(--itsm-space-sm);
}

.itsm-DescriptionList__item {
  display: grid;
  gap: var(--itsm-space-3xs);
  min-inline-size: 0;
}

.itsm-DescriptionList__label {
  margin: 0;
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  letter-spacing: var(--itsm-text-subheadline-tracking);
  font-weight: var(--itsm-text-subheadline-weight);
}

.itsm-DescriptionList__value {
  display: grid;
  gap: var(--itsm-space-3xs);
  justify-items: start;
  margin: 0;
  min-inline-size: 0;
  color: var(--itsm-colour-text-primary);
  font-size: var(--itsm-text-body-size);
  line-height: var(--itsm-text-body-line);
  letter-spacing: var(--itsm-text-body-tracking);
  overflow-wrap: anywhere;
}

.itsm-DescriptionList[data-dense] .itsm-DescriptionList__value {
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
}

.itsm-DescriptionList__empty {
  color: var(--itsm-colour-text-muted);
}

.itsm-DescriptionList__hint {
  color: var(--itsm-colour-text-muted);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  letter-spacing: var(--itsm-text-footnote-tracking);
}

/* Inline: the inspector's rows. */
.itsm-DescriptionList[data-layout="inline"] {
  gap: 0;
}

.itsm-DescriptionList[data-layout="inline"] .itsm-DescriptionList__item {
  grid-template-columns: minmax(7rem, 36%) minmax(0, 1fr);
  column-gap: var(--itsm-space-md);
  align-items: baseline;
  padding-block: var(--itsm-space-sm);
  border-block-end: var(--itsm-hairline) solid var(--itsm-colour-border-subtle);
}

.itsm-DescriptionList[data-layout="inline"][data-dense] .itsm-DescriptionList__item {
  padding-block: var(--itsm-space-xs);
}

.itsm-DescriptionList[data-layout="inline"] .itsm-DescriptionList__item:first-child {
  padding-block-start: 0;
}

.itsm-DescriptionList[data-layout="inline"] .itsm-DescriptionList__item:last-child {
  padding-block-end: 0;
  border-block-end: 0;
}

@container (max-width: 24rem) {
  .itsm-DescriptionList[data-layout="inline"] .itsm-DescriptionList__item {
    grid-template-columns: minmax(0, 1fr);
    row-gap: var(--itsm-space-3xs);
  }
}

/* Grid: stacked pairs in as many columns as fit. */
.itsm-DescriptionList[data-layout="grid"] {
  grid-template-columns: repeat(auto-fill, minmax(min(12rem, 100%), 1fr));
  column-gap: var(--itsm-space-lg);
}
`,
);
