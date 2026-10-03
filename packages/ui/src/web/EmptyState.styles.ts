import { css, layer, mq } from '../styles/css.js';

/**
 * `EmptyState`: centred, calm, and sized to where it sits (v3 §2.13, A1
 * §7.13).
 *
 * `md` is a section's: a 48 px disc with a 24 px icon, a `title3` heading in
 * the display face, one sentence at 13/20 in `text.muted` held to 46ch, and
 * the action 12 px below. `sm` fits inside a card or a table: a 36 px disc
 * with an 18 px icon and a 600 14/20 title. `lg` is a page's, with the line
 * illustration and a `title2`.
 *
 * The disc is the tone's tint with the icon in the tone's text colour, every
 * pair audited: the brand tint for "nothing yet" (an empty place is an
 * invitation), neutral for "no match", "no access" and "offline", green for
 * "all done", red for an error. `frame="dashed"` turns the state into a
 * page-level placeholder with a dashed `border.soft` edge at a card's radius.
 *
 * The first action is the page's call to action (filled) at `md` and `lg`, a
 * plain secondary button at `sm`, where a filled button inside a card would
 * shout over the card's own title.
 */
export const emptyStateStyles = layer(
  'components',
  css`
.itsm-EmptyState {
  --_itsm-empty-tint: var(--itsm-colour-brand-subtle);
  --_itsm-empty-ink: var(--itsm-colour-brand-subtleText);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--itsm-space-sm);
  box-sizing: border-box;
  padding: var(--itsm-space-2xl) var(--itsm-space-md);
  text-align: center;
  color: var(--itsm-colour-text-muted);
}

.itsm-EmptyState:is([data-tone="search"], [data-tone="forbidden"], [data-tone="offline"]) {
  --_itsm-empty-tint: var(--itsm-colour-neutral-subtle);
  --_itsm-empty-ink: var(--itsm-colour-text-muted);
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
  gap: var(--itsm-space-xs);
  padding: var(--itsm-space-lg) var(--itsm-space-md);
}

.itsm-EmptyState[data-size="lg"] {
  gap: var(--itsm-space-md);
  padding: var(--itsm-space-3xl) var(--itsm-space-lg);
}

.itsm-EmptyState[data-frame="dashed"] {
  padding: 2.5rem var(--itsm-space-lg);
  border: var(--itsm-border-hair) dashed var(--itsm-colour-border-soft);
  border-radius: var(--itsm-radius-2xl);
}

.itsm-EmptyState__icon {
  display: inline-grid;
  place-items: center;
  flex-shrink: 0;
  inline-size: var(--itsm-space-2xl);
  block-size: var(--itsm-space-2xl);
  border-radius: var(--itsm-radius-pill);
  background: var(--_itsm-empty-tint);
  color: var(--_itsm-empty-ink);
}

.itsm-EmptyState[data-size="sm"] .itsm-EmptyState__icon {
  inline-size: var(--itsm-control-height-md);
  block-size: var(--itsm-control-height-md);
}

.itsm-EmptyState__text {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--itsm-space-2xs);
  max-inline-size: 46ch;
}

.itsm-EmptyState__title {
  margin: 0;
  font-family: var(--itsm-text-title3-family);
  font-size: var(--itsm-text-title3-size);
  line-height: var(--itsm-text-title3-line);
  font-weight: var(--itsm-text-title3-weight);
  letter-spacing: var(--itsm-text-title3-tracking);
  word-spacing: var(--itsm-text-title3-word-spacing);
  color: var(--itsm-colour-text-primary);
  text-wrap: balance;
}

/* 14/20 600 in the interface face: the display face stays at 16 px and up (D4). */
.itsm-EmptyState[data-size="sm"] .itsm-EmptyState__title {
  font-family: var(--itsm-font-family-sans);
  font-size: var(--itsm-text-body-size);
  line-height: var(--itsm-text-callout-line);
  font-weight: var(--itsm-font-weight-semibold);
  letter-spacing: 0;
  word-spacing: 0;
}

.itsm-EmptyState[data-size="lg"] .itsm-EmptyState__title {
  font-family: var(--itsm-text-title2-family);
  font-size: var(--itsm-text-title2-size);
  line-height: var(--itsm-text-title2-line);
  font-weight: var(--itsm-text-title2-weight);
  letter-spacing: var(--itsm-text-title2-tracking);
  word-spacing: var(--itsm-text-title2-word-spacing);
}

.itsm-EmptyState__body {
  margin: 0;
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
  color: var(--itsm-colour-text-muted);
  text-wrap: pretty;
}

.itsm-EmptyState__body > :where(p) {
  margin: 0;
}

.itsm-EmptyState__extra {
  inline-size: 100%;
  max-inline-size: var(--itsm-content-narrow);
  text-align: start;
  color: var(--itsm-colour-text-secondary);
}

.itsm-EmptyState__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: var(--itsm-space-xs);
}

.itsm-EmptyState[data-size="sm"] .itsm-EmptyState__actions {
  margin-block-start: var(--itsm-space-2xs);
}

${mq.forcedColors} {
  .itsm-EmptyState__icon {
    border: var(--itsm-hairline) solid CanvasText;
  }

  .itsm-EmptyState[data-frame="dashed"] {
    border-color: CanvasText;
  }
}
`,
);
