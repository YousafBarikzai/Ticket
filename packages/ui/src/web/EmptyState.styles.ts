import { css, layer } from '../styles/css.js';

/**
 * `EmptyState`: centred, calm, and sized to where it sits.
 *
 * `sm` fits inside a card or a table (24 px of padding, a 48 px circle, a
 * `headline` title); `md` is a section's (48 px, 64 px circle, `title3`); `lg`
 * is a page's, with the line illustration and a `title2`. The circle is the
 * tone's tint with the icon in the tone's text colour — grey for "nothing
 * yet", green for "all done", red for an error — and the description is
 * secondary text held to a readable measure.
 *
 * The first action is the page's call to action (filled) at `md` and `lg`, a
 * plain secondary button at `sm`, where a filled button inside a card would
 * shout over the card's own title.
 */
export const emptyStateStyles = layer(
  'components',
  css`
.itsm-EmptyState {
  --_itsm-empty-tint: var(--itsm-colour-neutral-subtle);
  --_itsm-empty-ink: var(--itsm-colour-neutral-subtleText);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--itsm-space-md);
  padding: var(--itsm-space-2xl) var(--itsm-space-md);
  text-align: center;
  color: var(--itsm-colour-text-secondary);
}

.itsm-EmptyState[data-tone="error"] {
  --_itsm-empty-tint: var(--itsm-colour-danger-subtle);
  --_itsm-empty-ink: var(--itsm-colour-danger-subtleText);
}

.itsm-EmptyState[data-tone="success"] {
  --_itsm-empty-tint: var(--itsm-colour-success-subtle);
  --_itsm-empty-ink: var(--itsm-colour-success-subtleText);
}

.itsm-EmptyState[data-size="sm"] {
  gap: var(--itsm-space-sm);
  padding: var(--itsm-space-lg) var(--itsm-space-md);
}

.itsm-EmptyState[data-size="lg"] {
  gap: var(--itsm-space-lg);
  padding: var(--itsm-space-3xl) var(--itsm-space-lg);
}

.itsm-EmptyState__icon {
  display: inline-grid;
  place-items: center;
  flex-shrink: 0;
  inline-size: var(--itsm-space-3xl);
  block-size: var(--itsm-space-3xl);
  border-radius: var(--itsm-radius-pill);
  background: var(--_itsm-empty-tint);
  color: var(--_itsm-empty-ink);
}

.itsm-EmptyState[data-size="sm"] .itsm-EmptyState__icon {
  inline-size: var(--itsm-space-2xl);
  block-size: var(--itsm-space-2xl);
}

.itsm-EmptyState__text {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--itsm-space-2xs);
  max-inline-size: 44ch;
}

.itsm-EmptyState__title {
  margin: 0;
  font-size: var(--itsm-text-title3-size);
  line-height: var(--itsm-text-title3-line);
  font-weight: var(--itsm-text-title3-weight);
  letter-spacing: var(--itsm-text-title3-tracking);
  color: var(--itsm-colour-text-primary);
  text-wrap: balance;
}

.itsm-EmptyState[data-size="sm"] .itsm-EmptyState__title {
  font-size: var(--itsm-text-headline-size);
  line-height: var(--itsm-text-headline-line);
  font-weight: var(--itsm-text-headline-weight);
  letter-spacing: var(--itsm-text-headline-tracking);
}

.itsm-EmptyState[data-size="lg"] .itsm-EmptyState__title {
  font-size: var(--itsm-text-title2-size);
  line-height: var(--itsm-text-title2-line);
  font-weight: var(--itsm-text-title2-weight);
  letter-spacing: var(--itsm-text-title2-tracking);
}

.itsm-EmptyState__body {
  margin: 0;
  font-size: var(--itsm-text-body-size);
  line-height: var(--itsm-text-body-line);
  letter-spacing: var(--itsm-text-body-tracking);
  text-wrap: pretty;
}

.itsm-EmptyState[data-size="sm"] .itsm-EmptyState__body {
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
}

.itsm-EmptyState__body > :where(p) {
  margin: 0;
}

.itsm-EmptyState__extra {
  inline-size: 100%;
  max-inline-size: var(--itsm-content-narrow);
  text-align: start;
}

.itsm-EmptyState__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: var(--itsm-space-xs);
}

.itsm-EmptyState[data-size="sm"] .itsm-EmptyState__actions {
  margin-block-start: calc(var(--itsm-space-2xs) * -1);
}
`,
);
