import { moreContrast } from '../feedback/tone.js';
import { css, layer, mq } from '../styles/css.js';

/** The instruction tint for each intent the form builder offers: its `subtle` behind primary text, its icon in `subtleText`. */
const intents = ['brand', 'neutral', 'success', 'warning', 'danger', 'info'] as const;
const intentRules = intents
  .map(
    (intent) => `.itsm-FormRenderer__instruction[data-intent="${intent}"] {
  --_itsm-intent-subtle: var(--itsm-colour-${intent}-subtle);
  --_itsm-intent-text: var(--itsm-colour-${intent}-subtleText);
  --_itsm-intent-border: var(--itsm-colour-${intent}-border);
}`,
  )
  .join('\n');

/**
 * `FormRenderer`, in both modes.
 *
 * - **Sections** are headed in `headline` type with the description in
 *   secondary `callout`; they follow each other with room, not rules.
 * - **Instructions** are a tinted note with the intent's icon — never colour
 *   alone — and primary text on the tint (the audited pair), links included.
 * - **A whole-form failure** (a definition that cannot be evaluated) is a
 *   danger note at the top, addressed to somebody who can report it.
 *
 * Steps mode:
 * - The progress sits above the step: a step list on a wide container, a
 *   thin bar on a narrow one (a container query, so the same form reads
 *   right in the portal's 720 column and on a phone).
 * - Each step's heading is "Step 2 of 3" in `footnote` over the title in
 *   `title2`. It takes focus on a step change and draws no ring for it — it
 *   is a place, not a control — and keeps clear of a sticky top bar when it
 *   scrolls into view.
 * - The step's content fades in (`normal`); the progress does not move
 *   (SPEC §1.9, "Stepper: indicator static; step content fades"). Reduced
 *   motion collapses the fade with every other duration.
 * - The actions hold to the bottom of the view on a long step, opaque with a
 *   hairline edge while they float over fields (SPEC D6), above a docked tab
 *   bar and the home indicator. Back sits at the start, the next step's
 *   button at the end; on a narrow container the latter takes the width.
 * - The review is grouped by step, each group a heading with its Edit, and
 *   the answers as an inline description list; a long answer keeps its line
 *   breaks.
 */
export const formRendererStyles = layer(
  'components',
  css`
.itsm-FormRenderer {
  container-type: inline-size;
  min-inline-size: 0;
}

.itsm-FormRenderer__error {
  display: block;
  margin: 0 0 var(--itsm-space-md);
  padding: var(--itsm-space-sm) var(--itsm-space-md);
  border-radius: var(--itsm-radius-xl);
  background: var(--itsm-colour-danger-subtle);
  color: var(--itsm-colour-danger-subtleText);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  font-weight: var(--itsm-font-weight-medium);
}

.itsm-FormRenderer__section {
  margin-block: 0 var(--itsm-space-lg);
}

.itsm-FormRenderer__section .itsm-FormRenderer__section {
  margin-block-start: var(--itsm-space-md);
}

.itsm-FormRenderer__sectionTitle {
  margin: 0 0 var(--itsm-space-2xs);
  font-size: var(--itsm-text-headline-size);
  line-height: var(--itsm-text-headline-line);
  letter-spacing: var(--itsm-text-headline-tracking);
  font-weight: var(--itsm-text-headline-weight);
  color: var(--itsm-colour-text-primary);
}

.itsm-FormRenderer__sectionDescription,
.itsm-FormRenderer__stepDescription {
  margin: 0 0 var(--itsm-space-md);
  max-inline-size: 68ch;
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
  color: var(--itsm-colour-text-secondary);
}

/* Instructions. */

${intentRules}

.itsm-FormRenderer__instruction {
  display: flex;
  align-items: flex-start;
  gap: var(--itsm-space-sm);
  margin-block-end: var(--itsm-space-md);
  padding: var(--itsm-space-sm) var(--itsm-space-md);
  border-radius: var(--itsm-radius-xl);
  background: var(--_itsm-intent-subtle);
  color: var(--itsm-colour-text-primary);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
}

.itsm-FormRenderer__instructionIcon {
  flex: none;
  margin-block: calc((var(--itsm-text-callout-line) - var(--itsm-icon-md)) / 2);
  color: var(--_itsm-intent-text);
}

.itsm-FormRenderer__instructionBody {
  flex: 1;
  min-inline-size: 0;
  overflow-wrap: anywhere;
}

.itsm-FormRenderer__instructionBody :where(p, ul, ol) {
  margin-block: 0;
}

.itsm-FormRenderer__instructionBody :where(p + p, p + ul, p + ol, ul + p, ol + p) {
  margin-block-start: var(--itsm-space-2xs);
}

/* A lone checkbox's hint and error line up with its label, not its box. */
.itsm-FormRenderer__checkboxHint,
.itsm-FormRenderer__checkboxError {
  padding-inline-start: calc(var(--itsm-icon-md) + var(--itsm-space-xs) + var(--itsm-space-3xs));
}

.itsm-FormRenderer__checkboxHint {
  margin-block-start: 0;
}

.itsm-FormRenderer__group {
  margin-block-end: var(--itsm-space-md);
}

/* Steps: progress. */

.itsm-FormRenderer__progress {
  margin-block-end: var(--itsm-space-lg);
}

.itsm-FormRenderer__stepper {
  display: none;
}

@container (min-width: 40rem) {
  .itsm-FormRenderer__stepper {
    display: block;
  }
  .itsm-FormRenderer__progressBar {
    display: none;
  }
}

/* Steps: the step. */

.itsm-FormRenderer__step {
  animation: itsm-FormRenderer-enter var(--itsm-duration-normal) var(--itsm-easing-standard);
}

@keyframes itsm-FormRenderer-enter {
  from { opacity: 0; }
  to { opacity: 1; }
}

.itsm-FormRenderer__step > .itsm-FormErrorSummary {
  margin-block-end: var(--itsm-space-lg);
}

.itsm-FormRenderer__stepHeading {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-3xs);
  margin: 0 0 var(--itsm-space-md);
  scroll-margin-block-start: calc(var(--itsm-topbar-height) + var(--itsm-space-md));
}

.itsm-FormRenderer__stepHeading:focus {
  outline: none;
  box-shadow: none;
}

.itsm-FormRenderer__stepCount {
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  letter-spacing: var(--itsm-text-footnote-tracking);
  font-weight: var(--itsm-font-weight-medium);
  font-variant-numeric: tabular-nums;
  color: var(--itsm-colour-text-muted);
}

.itsm-FormRenderer__stepTitle {
  font-size: var(--itsm-text-title2-size);
  line-height: var(--itsm-text-title2-line);
  letter-spacing: var(--itsm-text-title2-tracking);
  font-weight: var(--itsm-text-title2-weight);
  color: var(--itsm-colour-text-primary);
}

/* Steps: actions. */

.itsm-FormRenderer__actions {
  position: sticky;
  inset-block-end: calc(var(--itsm-bottom-dock-height) + var(--itsm-safe-area-bottom));
  z-index: var(--itsm-z-sticky);
  display: flex;
  align-items: center;
  gap: var(--itsm-space-xs);
  margin-block-start: var(--itsm-space-lg);
  padding-block: var(--itsm-space-sm);
  background-color: transparent;
  transition:
    background-color var(--itsm-duration-fast) var(--itsm-easing-standard),
    box-shadow var(--itsm-duration-fast) var(--itsm-easing-standard);
}

.itsm-FormRenderer__actions[data-stuck] {
  background-color: var(--itsm-colour-surface-raised);
  box-shadow:
    0 calc(-1 * var(--itsm-hairline)) 0 var(--itsm-colour-border-subtle),
    var(--itsm-elevation-md);
}

.itsm-FormRenderer__actionsEnd {
  display: flex;
  gap: var(--itsm-space-xs);
  margin-inline-start: auto;
}

.itsm-FormRenderer__sentinel {
  block-size: var(--itsm-hairline);
  margin-block-start: calc(-1 * var(--itsm-hairline));
  pointer-events: none;
}

@container (max-width: 30rem) {
  .itsm-FormRenderer__actionsEnd {
    flex: 1;
  }
  .itsm-FormRenderer__actionsEnd > .itsm-Button {
    flex: 1;
  }
}

/* Steps: review. */

.itsm-FormRenderer__reviewIntro {
  margin: 0 0 var(--itsm-space-lg);
  font-size: var(--itsm-text-body-size);
  line-height: var(--itsm-text-body-line);
  letter-spacing: var(--itsm-text-body-tracking);
  color: var(--itsm-colour-text-secondary);
}

.itsm-FormRenderer__reviewGroup + .itsm-FormRenderer__reviewGroup {
  margin-block-start: var(--itsm-space-xl);
}

.itsm-FormRenderer__reviewHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--itsm-space-sm);
  margin-block-end: var(--itsm-space-xs);
}

.itsm-FormRenderer__reviewTitle {
  margin: 0;
  min-inline-size: 0;
  font-size: var(--itsm-text-headline-size);
  line-height: var(--itsm-text-headline-line);
  letter-spacing: var(--itsm-text-headline-tracking);
  font-weight: var(--itsm-text-headline-weight);
  color: var(--itsm-colour-text-primary);
}

.itsm-FormRenderer__answer {
  white-space: pre-line;
  overflow-wrap: anywhere;
}

.itsm-FormRenderer__reviewEmpty {
  margin: 0;
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  color: var(--itsm-colour-text-muted);
}

${moreContrast(
  (scope) => `${scope} .itsm-FormRenderer__instruction { box-shadow: inset 0 0 0 var(--itsm-hairline) var(--_itsm-intent-border); }
${scope} .itsm-FormRenderer__error { box-shadow: inset 0 0 0 var(--itsm-border-thick) var(--itsm-colour-danger-border); }`,
)}

${mq.forcedColors} {
  .itsm-FormRenderer__instruction,
  .itsm-FormRenderer__error {
    border: var(--itsm-hairline) solid CanvasText;
  }
  .itsm-FormRenderer__instructionIcon {
    color: CanvasText;
  }
  .itsm-FormRenderer__actions[data-stuck] {
    background-color: Canvas;
    box-shadow: none;
    border-block-start: var(--itsm-hairline) solid CanvasText;
  }
}
`,
);
