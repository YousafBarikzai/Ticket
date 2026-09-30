import { css, layer, mq } from '../styles/css.js';

/** The vertical layout, for `orientation="vertical"` and for a horizontal stepper in a narrow container. */
function vertical(scope: string): string {
  return `${scope} .itsm-Stepper__list {
  grid-auto-flow: row;
  grid-auto-columns: auto;
}
${scope} .itsm-Stepper__step {
  grid-template-columns: auto minmax(0, 1fr);
  column-gap: var(--itsm-space-sm);
  row-gap: 0;
}
${scope} .itsm-Stepper__track {
  flex-direction: column;
  align-self: stretch;
  gap: var(--itsm-space-2xs);
}
${scope} .itsm-Stepper__connector {
  inline-size: var(--itsm-border-thick);
  block-size: auto;
  min-block-size: var(--itsm-space-md);
  margin: 0 0 var(--itsm-space-2xs);
}
${scope} .itsm-Stepper__text {
  padding-inline-end: 0;
  padding-block: calc((var(--_itsm-step-size) - var(--_itsm-step-line)) / 2) var(--itsm-space-md);
}
${scope} .itsm-Stepper__step:last-child .itsm-Stepper__text {
  padding-block-end: 0;
}`;
}

/**
 * `Stepper`: indicators joined by connectors, labels beneath (horizontal) or
 * beside (vertical).
 *
 * Horizontal steps share the width equally and start-align their labels
 * under their indicators, so the first label lines up with the content
 * above. The stepper is its own inline-size container and turns vertical
 * below 30 rem (480 px) by itself (SPEC §4.6) — a request's progress in a
 * phone-width column reads down the screen rather than squeezing four labels
 * into a row.
 *
 * Indicators: complete is the accent filled, with a tick in the filled
 * button's text colour (≥ 3:1 in every theme); current a thick accent ring
 * around an accent dot; upcoming a ring in `border.interactive` (audited at
 * 3:1); error the danger fill with a cross; waiting the warning ring with an
 * hourglass; skipped a broken ring with a dash. Labels of steps reached are
 * primary text, the current one semibold; the rest secondary.
 */
export const stepperStyles = layer(
  'components',
  css`
.itsm-Stepper {
  --_itsm-step-size: 1.5rem;
  --_itsm-step-line: var(--itsm-text-callout-line);
  container-type: inline-size;
  min-inline-size: 0;
}

.itsm-Stepper[data-size="sm"] {
  --_itsm-step-size: 1rem;
  --_itsm-step-line: var(--itsm-text-footnote-line);
}

.itsm-Stepper__list {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  margin: 0;
  padding: 0;
  list-style: none;
}

.itsm-Stepper__step {
  display: grid;
  row-gap: var(--itsm-space-xs);
  min-inline-size: 0;
}

.itsm-Stepper__track {
  display: flex;
  align-items: center;
  gap: var(--itsm-space-xs);
}

.itsm-Stepper__indicator {
  position: relative;
  display: grid;
  place-items: center;
  flex: none;
  box-sizing: border-box;
  inline-size: var(--_itsm-step-size);
  block-size: var(--_itsm-step-size);
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-surface-raised);
  box-shadow: inset 0 0 0 var(--itsm-border-thick) var(--itsm-colour-border-interactive);
  color: var(--itsm-colour-text-muted);
}

.itsm-Stepper__connector {
  flex: 1;
  block-size: var(--itsm-border-thick);
  margin-inline-end: var(--itsm-space-xs);
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-border-subtle);
}

.itsm-Stepper__step:last-child .itsm-Stepper__connector {
  display: none;
}

.itsm-Stepper__text {
  display: grid;
  gap: var(--itsm-space-3xs);
  min-inline-size: 0;
  padding-inline-end: var(--itsm-space-sm);
}

.itsm-Stepper__label {
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
  overflow-wrap: anywhere;
}

.itsm-Stepper[data-size="sm"] .itsm-Stepper__label {
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  letter-spacing: var(--itsm-text-footnote-tracking);
}

.itsm-Stepper__description {
  color: var(--itsm-colour-text-muted);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  letter-spacing: var(--itsm-text-footnote-tracking);
}

/* Complete: the accent filled, a tick, the path behind it drawn in accent. */
.itsm-Stepper__step[data-status="complete"] .itsm-Stepper__indicator {
  background: var(--itsm-colour-accent);
  box-shadow: none;
  color: var(--itsm-colour-brand-solidText);
}
.itsm-Stepper__step[data-status="complete"] .itsm-Stepper__connector {
  background: var(--itsm-colour-accent);
}

/* Current: an accent ring round an accent dot. */
.itsm-Stepper__step[data-status="current"] .itsm-Stepper__indicator {
  box-shadow: inset 0 0 0 var(--itsm-border-thick) var(--itsm-colour-accent);
}
.itsm-Stepper__step[data-status="current"] .itsm-Stepper__indicator::after {
  content: '';
  inline-size: 36%;
  block-size: 36%;
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-accent);
}

/* Failed: the danger fill with a cross. */
.itsm-Stepper__step[data-status="error"] .itsm-Stepper__indicator {
  background: var(--itsm-colour-danger-solid);
  box-shadow: none;
  color: var(--itsm-colour-danger-solidText);
}

/* Waiting: the warning ring with an hourglass. */
.itsm-Stepper__step[data-status="waiting"] .itsm-Stepper__indicator {
  box-shadow: inset 0 0 0 var(--itsm-border-thick) var(--itsm-colour-warning-border);
  color: var(--itsm-colour-warning-subtleText);
}

/* Skipped: a broken ring with a dash. */
.itsm-Stepper__step[data-status="skipped"] .itsm-Stepper__indicator {
  box-shadow: none;
  border: var(--itsm-border-thick) dashed var(--itsm-colour-border-interactive);
}

.itsm-Stepper__step:is([data-status="complete"], [data-status="current"], [data-status="error"], [data-status="waiting"]) .itsm-Stepper__label {
  color: var(--itsm-colour-text-primary);
}

.itsm-Stepper__step[data-status="current"] .itsm-Stepper__label {
  font-weight: var(--itsm-font-weight-semibold);
}

.itsm-Stepper__step[data-status="skipped"] .itsm-Stepper__label {
  color: var(--itsm-colour-text-muted);
}

${vertical('.itsm-Stepper[data-orientation="vertical"]')}

@container (max-width: 30rem) {
${vertical('.itsm-Stepper[data-orientation="horizontal"]')}
}

${mq.forcedColors} {
  .itsm-Stepper__indicator,
  .itsm-Stepper__connector {
    forced-color-adjust: none;
  }
  .itsm-Stepper__indicator {
    background: Canvas;
    box-shadow: inset 0 0 0 var(--itsm-border-thick) CanvasText;
    color: CanvasText;
  }
  .itsm-Stepper__connector {
    background: GrayText;
  }
  .itsm-Stepper__step[data-status="complete"] .itsm-Stepper__indicator {
    background: Highlight;
    color: HighlightText;
  }
  .itsm-Stepper__step:is([data-status="complete"], [data-status="current"]) .itsm-Stepper__connector,
  .itsm-Stepper__step[data-status="current"] .itsm-Stepper__indicator::after {
    background: Highlight;
  }
  .itsm-Stepper__step[data-status="current"] .itsm-Stepper__indicator {
    box-shadow: inset 0 0 0 var(--itsm-border-thick) Highlight;
  }
  .itsm-Stepper__step[data-status="error"] .itsm-Stepper__indicator {
    background: CanvasText;
    color: Canvas;
  }
}
`,
);
