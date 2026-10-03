import { css, layer, mq, prefers } from '../styles/css.js';

/**
 * `StatusScreen`: one card, centred on the canvas, the height of the window
 * below any system bar (`--itsm-system-bar-h`, `0px` when there is none).
 *
 * v3 depth is border-first: the card is `surface.raised` with a 1 px
 * `border.subtle` edge and only elevation `sm`, at the dialog radius (16), and
 * no squircle (A1 §8: a bordered squircle renders differently per browser).
 * The head is the area lockup — the mark, "IT Service Management" in the
 * `lockup` style and the area's name under it — and the title is
 * `largeTitle` in the display face. Below 30 rem of width the card lets go of
 * its frame and the content sits on the canvas, as the phone's own system
 * screens do; a container query, so a status screen inside a narrow pane
 * behaves the same.
 *
 * `hop` keeps the card and says less: a `title2` status line, a 2 px
 * route-progress bar (an accent sweep; a still line under reduced motion) and
 * the persona strip in the demo bar's navy. The strip borrows the bar's badge
 * classes but never the `.itsm-SystemBar` class itself, which would publish a
 * frame offset (`SystemBar.styles.ts`).
 */
export const statusScreenStyles = layer(
  'components',
  css`
@keyframes itsm-StatusScreen-sweep {
  from { transform: translateX(-100%); }
  to { transform: translateX(250%); }
}

.itsm-StatusScreen {
  container-type: inline-size;
  display: grid;
  place-items: center;
  box-sizing: border-box;
  min-block-size: calc(100dvh - var(--itsm-system-bar-h));
  padding: var(--itsm-space-xl) var(--itsm-page-gutter);
  padding-block-end: calc(var(--itsm-space-xl) + var(--itsm-safe-area-bottom));
  background: var(--itsm-colour-surface-canvas);
  color: var(--itsm-colour-text-secondary);
}

.itsm-StatusScreen__card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--itsm-space-md);
  box-sizing: border-box;
  inline-size: 100%;
  max-inline-size: 26.25rem;
  padding: var(--itsm-space-xl);
  border: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);
  border-radius: var(--itsm-radius-3xl);
  background: var(--itsm-colour-surface-raised);
  box-shadow: var(--itsm-elevation-sm);
  text-align: center;
}

/* The area lockup: mark, then the product over the area's name. */
.itsm-StatusScreen__brand {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-sm);
  text-align: start;
}

.itsm-StatusScreen__lockup {
  display: flex;
  flex-direction: column;
  min-inline-size: 0;
}

.itsm-StatusScreen__productName {
  font-family: var(--itsm-text-lockup-family);
  font-size: var(--itsm-text-lockup-size);
  line-height: var(--itsm-text-lockup-line);
  font-weight: var(--itsm-text-lockup-weight);
  letter-spacing: var(--itsm-text-lockup-tracking);
  color: var(--itsm-colour-text-primary);
}

.itsm-StatusScreen__product {
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  font-weight: var(--itsm-font-weight-medium);
  color: var(--itsm-colour-text-muted);
}

.itsm-StatusScreen__illustration {
  margin-block: var(--itsm-space-xs) 0;
}

.itsm-StatusScreen__title {
  margin: 0;
  font-family: var(--itsm-text-largeTitle-family);
  font-size: var(--itsm-text-largeTitle-size);
  line-height: var(--itsm-text-largeTitle-line);
  font-weight: var(--itsm-text-largeTitle-weight);
  letter-spacing: var(--itsm-text-largeTitle-tracking);
  word-spacing: var(--itsm-text-largeTitle-word-spacing);
  color: var(--itsm-colour-text-primary);
  text-wrap: balance;
}

.itsm-StatusScreen__body {
  inline-size: 100%;
  margin: 0;
  font-size: var(--itsm-text-body-size);
  line-height: var(--itsm-text-body-line);
  letter-spacing: var(--itsm-text-body-tracking);
  text-wrap: pretty;
}

.itsm-StatusScreen__body > :where(p) {
  margin: 0;
}

.itsm-StatusScreen__body > :where(p + p) {
  margin-block-start: var(--itsm-space-xs);
}

.itsm-StatusScreen__body :where(form, ul, ol, dl) {
  text-align: start;
}

.itsm-StatusScreen__actions {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-xs);
  inline-size: 100%;
  margin-block-start: var(--itsm-space-xs);
}

.itsm-StatusScreen__actions > .itsm-Button,
.itsm-StatusScreen__actions > form > .itsm-Button {
  inline-size: 100%;
}

/* A form in the actions (a POST sign-out, the demo entry) lays its buttons out like the links above it. */
.itsm-StatusScreen__actions > form {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-xs);
  margin: 0;
}

/* The hop card: a status line, not a headline. */
.itsm-StatusScreen[data-variant="hop"] .itsm-StatusScreen__card {
  gap: var(--itsm-space-sm);
}

.itsm-StatusScreen[data-variant="hop"] .itsm-StatusScreen__brand {
  margin-block-end: var(--itsm-space-xs);
}

.itsm-StatusScreen[data-variant="hop"] .itsm-StatusScreen__title {
  font-family: var(--itsm-text-title2-family);
  font-size: var(--itsm-text-title2-size);
  line-height: var(--itsm-text-title2-line);
  font-weight: var(--itsm-text-title2-weight);
  letter-spacing: var(--itsm-text-title2-tracking);
  word-spacing: var(--itsm-text-title2-word-spacing);
}

.itsm-StatusScreen__progress {
  position: relative;
  display: block;
  inline-size: 100%;
  block-size: var(--itsm-border-thick);
  overflow: hidden;
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-fill-track);
}

.itsm-StatusScreen__progressBar {
  position: absolute;
  inset-block: 0;
  inset-inline-start: 0;
  inline-size: 40%;
  border-radius: inherit;
  background: var(--itsm-colour-accent);
  animation: itsm-StatusScreen-sweep 1.4s var(--itsm-easing-standard) infinite;
}

.itsm-StatusScreen__progressBar:dir(rtl) {
  animation-direction: reverse;
}

/* The persona line in the demo bar's look, without its countdown. */
.itsm-StatusScreen__session {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: var(--itsm-space-xs) calc(var(--itsm-space-xs) + var(--itsm-space-3xs));
  box-sizing: border-box;
  inline-size: 100%;
  padding: var(--itsm-space-xs) var(--itsm-space-sm);
  border: var(--itsm-border-hair) solid var(--itsm-colour-hero-line);
  border-radius: var(--itsm-radius-lg);
  background: var(--itsm-hero-bar-background);
  color: var(--itsm-colour-hero-text);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  font-weight: var(--itsm-font-weight-medium);
}

.itsm-StatusScreen__persona {
  color: var(--itsm-colour-hero-textSecondary);
}

.itsm-StatusScreen__persona :where(strong, b) {
  color: var(--itsm-colour-hero-text);
  font-weight: var(--itsm-font-weight-semibold);
}

@container (max-width: 30rem) {
  .itsm-StatusScreen__card {
    padding: var(--itsm-space-md) 0;
    border-color: transparent;
    background: transparent;
    box-shadow: none;
  }
}

${mq.reducedMotion} {
  .itsm-StatusScreen__progressBar {
    inline-size: 100%;
    animation: none;
  }
}

${prefers.reducedMotion} .itsm-StatusScreen__progressBar {
  inline-size: 100%;
  animation: none;
}

${mq.forcedColors} {
  .itsm-StatusScreen__card {
    border-color: CanvasText;
  }

  .itsm-StatusScreen__progressBar {
    background: Highlight;
  }

  .itsm-StatusScreen__session {
    background: Canvas;
    color: CanvasText;
    border-color: CanvasText;
  }
}
`,
);
