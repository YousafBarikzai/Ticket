import { css, layer } from '../styles/css.js';

/**
 * `SlaClock` in its four forms: label and status pill (`badge`), one quiet
 * line (`text`, the ticket header), a ring of time used with the label over
 * the reading (`ring`, the ticket header and SLA block only), and the pill
 * alone (`chip`, rows and cards).
 *
 * Time reads in tabular figures, so a ticking "9 min left" does not jitter.
 * Urgency is carried by the icon and the words as well as the colour: amber
 * with a triangle (or a clock, on a chip) while at risk, red with a circled
 * "!" once breached, D5's fuchsia pause while waiting.
 * `itsm-SlaClock--urgent` is pinned by the tests; the tone attribute does the
 * styling.
 *
 * The ring is `ProgressRing` at 32 or 48 px, scaled to the v3 sizes (28 px
 * `sm`, 44 px `lg`, A6 §5.6) through its viewBox, and a paused clock's arc is
 * drawn here in `hold.border` — the ring's own tones are the status ones, and
 * `hold` is the one D5 adds for waiting.
 */
export const slaClockStyles = layer(
  'components',
  css`
.itsm-SlaClock {
  --_itsm-sla-tone: var(--itsm-colour-text-muted);
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-xs);
  min-inline-size: 0;
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
}

.itsm-SlaClock[data-tone="success"] { --_itsm-sla-tone: var(--itsm-colour-success-subtleText); }
.itsm-SlaClock[data-tone="warning"] { --_itsm-sla-tone: var(--itsm-colour-warning-subtleText); }
.itsm-SlaClock[data-tone="danger"] { --_itsm-sla-tone: var(--itsm-colour-danger-subtleText); }
.itsm-SlaClock[data-tone="hold"] { --_itsm-sla-tone: var(--itsm-colour-hold-subtleText); }

.itsm-SlaClock__label {
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  font-weight: var(--itsm-text-subheadline-weight);
  letter-spacing: var(--itsm-text-subheadline-tracking);
  color: var(--itsm-colour-text-secondary);
  white-space: nowrap;
}

.itsm-SlaClock__reading {
  font-variant-numeric: tabular-nums;
  color: var(--itsm-colour-text-primary);
  white-space: nowrap;
}

.itsm-SlaClock__pill {
  font-variant-numeric: tabular-nums;
}

.itsm-SlaClock__icon {
  flex: none;
  color: var(--_itsm-sla-tone);
}

.itsm-SlaClock[data-display="text"][data-tone="warning"] .itsm-SlaClock__reading,
.itsm-SlaClock[data-display="text"][data-tone="danger"] .itsm-SlaClock__reading {
  font-weight: var(--itsm-font-weight-semibold);
  color: var(--_itsm-sla-tone);
}

.itsm-SlaClock[data-display="ring"] {
  gap: var(--itsm-space-sm);
}

.itsm-SlaClock__stack {
  display: flex;
  flex-direction: column;
  min-inline-size: 0;
}

.itsm-SlaClock__stack .itsm-SlaClock__label {
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  font-weight: var(--itsm-font-weight-regular);
}

.itsm-SlaClock__stack .itsm-SlaClock__reading {
  font-weight: var(--itsm-font-weight-semibold);
}

.itsm-SlaClock[data-display="ring"][data-tone="warning"] .itsm-SlaClock__reading,
.itsm-SlaClock[data-display="ring"][data-tone="danger"] .itsm-SlaClock__reading {
  color: var(--_itsm-sla-tone);
}

.itsm-SlaClock[data-display="ring"][data-tone="hold"] .itsm-SlaClock__ring {
  --_itsm-ring: var(--itsm-colour-hold-border);
}

.itsm-SlaClock[data-ring-size="sm"] .itsm-SlaClock__ring {
  inline-size: 28px;
  block-size: 28px;
}

.itsm-SlaClock[data-ring-size="lg"] .itsm-SlaClock__ring {
  inline-size: 44px;
  block-size: 44px;
}

.itsm-SlaClock[data-ring-size] .itsm-SlaClock__ring .itsm-ProgressRing__svg {
  inline-size: 100%;
  block-size: 100%;
}

.itsm-SlaClock[data-display="chip"] {
  vertical-align: middle;
  white-space: nowrap;
}
`,
);
