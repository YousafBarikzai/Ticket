import { css, layer, mq } from '../styles/css.js';

/**
 * `ProblemState`, at three sizes.
 *
 * `md` and `lg` are centred like an empty state — the tone's tint in a circle
 * with its icon (or, at `lg`, the line illustration), a heading, one sentence,
 * the remedy — because an error is also a place with nothing in it. `sm` is a
 * left-aligned row that fits a card's body: a small icon in the tone's text
 * colour beside the words, the button under them.
 *
 * Tone is quiet on purpose. A grey lock says "no access" better than a red
 * one, and a red circle is kept for the failures that are ours (5xx, the
 * service unreachable). The Error ID and technical detail are footnotes in
 * the muted colour, the ID in the monospace face, with a small Copy button.
 */
export const problemStateStyles = layer(
  'components',
  css`
.itsm-ProblemState {
  --_itsm-problem-tint: var(--itsm-colour-neutral-subtle);
  --_itsm-problem-ink: var(--itsm-colour-neutral-subtleText);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--itsm-space-md);
  padding: var(--itsm-space-2xl) var(--itsm-space-md);
  text-align: center;
  color: var(--itsm-colour-text-secondary);
}

.itsm-ProblemState[data-tone="warning"] {
  --_itsm-problem-tint: var(--itsm-colour-warning-subtle);
  --_itsm-problem-ink: var(--itsm-colour-warning-subtleText);
}

.itsm-ProblemState[data-tone="danger"] {
  --_itsm-problem-tint: var(--itsm-colour-danger-subtle);
  --_itsm-problem-ink: var(--itsm-colour-danger-subtleText);
}

.itsm-ProblemState[data-size="lg"] {
  gap: var(--itsm-space-lg);
  padding: var(--itsm-space-3xl) var(--itsm-space-lg);
}

.itsm-ProblemState[data-size="sm"] {
  flex-direction: row;
  align-items: flex-start;
  gap: var(--itsm-space-sm);
  padding: var(--itsm-space-sm) 0;
  text-align: start;
}

.itsm-ProblemState__icon {
  display: inline-grid;
  place-items: center;
  flex-shrink: 0;
  inline-size: var(--itsm-space-3xl);
  block-size: var(--itsm-space-3xl);
  border-radius: var(--itsm-radius-pill);
  background: var(--_itsm-problem-tint);
  color: var(--_itsm-problem-ink);
}

.itsm-ProblemState[data-size="sm"] .itsm-ProblemState__icon {
  inline-size: auto;
  block-size: auto;
  margin-block: calc((var(--itsm-text-callout-line) - var(--itsm-icon-md)) / 2);
  background: none;
}

.itsm-ProblemState__main {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--itsm-space-sm);
  min-inline-size: 0;
}

.itsm-ProblemState[data-size="sm"] .itsm-ProblemState__main {
  flex: 1;
  align-items: flex-start;
  gap: var(--itsm-space-xs);
}

.itsm-ProblemState__text {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-2xs);
  max-inline-size: 44ch;
}

.itsm-ProblemState__title {
  margin: 0;
  font-size: var(--itsm-text-title3-size);
  line-height: var(--itsm-text-title3-line);
  font-weight: var(--itsm-text-title3-weight);
  letter-spacing: var(--itsm-text-title3-tracking);
  color: var(--itsm-colour-text-primary);
  text-wrap: balance;
}

.itsm-ProblemState[data-size="lg"] .itsm-ProblemState__title {
  font-size: var(--itsm-text-title2-size);
  line-height: var(--itsm-text-title2-line);
  font-weight: var(--itsm-text-title2-weight);
  letter-spacing: var(--itsm-text-title2-tracking);
}

.itsm-ProblemState[data-size="sm"] .itsm-ProblemState__title {
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  font-weight: var(--itsm-font-weight-semibold);
  letter-spacing: var(--itsm-text-callout-tracking);
}

.itsm-ProblemState__body {
  margin: 0;
  font-size: var(--itsm-text-body-size);
  line-height: var(--itsm-text-body-line);
  letter-spacing: var(--itsm-text-body-tracking);
  text-wrap: pretty;
}

.itsm-ProblemState[data-size="sm"] .itsm-ProblemState__body {
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  letter-spacing: var(--itsm-text-footnote-tracking);
}

.itsm-ProblemState__wait {
  margin: 0;
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  font-weight: var(--itsm-text-subheadline-weight);
  color: var(--_itsm-problem-ink);
  font-variant-numeric: tabular-nums;
}

.itsm-ProblemState__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: var(--itsm-space-xs);
  margin-block-start: var(--itsm-space-2xs);
}

.itsm-ProblemState[data-size="sm"] .itsm-ProblemState__actions {
  justify-content: flex-start;
  margin-block-start: 0;
}

.itsm-ProblemState__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: var(--itsm-space-2xs) var(--itsm-space-xs);
  margin: 0;
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  color: var(--itsm-colour-text-muted);
}

.itsm-ProblemState[data-size="sm"] .itsm-ProblemState__meta {
  justify-content: flex-start;
}

.itsm-ProblemState__code {
  font-family: var(--itsm-font-family-mono);
  font-size: var(--itsm-text-footnote-size);
  color: var(--itsm-colour-text-secondary);
  overflow-wrap: anywhere;
  user-select: all;
}

.itsm-ProblemState__detail {
  overflow-wrap: anywhere;
}

.itsm-ProblemState__copy {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-2xs);
  min-block-size: var(--itsm-space-lg);
  padding: 0 var(--itsm-space-xs);
  border: 0;
  border-radius: var(--itsm-radius-sm);
  background: transparent;
  color: var(--itsm-colour-text-link);
  font: inherit;
  font-weight: var(--itsm-font-weight-medium);
  cursor: pointer;
  transition: background-color var(--itsm-duration-fast) var(--itsm-easing-standard);
}

.itsm-ProblemState__copy:hover {
  background: var(--itsm-colour-fill-hover);
}

.itsm-ProblemState__copy:active {
  background: var(--itsm-colour-fill-pressed);
}

.itsm-ProblemState__copy[data-copied] {
  color: var(--itsm-colour-success-subtleText);
}

${mq.forcedColors} {
  .itsm-ProblemState:not([data-size="sm"]) .itsm-ProblemState__icon {
    border: var(--itsm-hairline) solid CanvasText;
  }

  .itsm-ProblemState__copy {
    color: LinkText;
  }
}
`,
);
