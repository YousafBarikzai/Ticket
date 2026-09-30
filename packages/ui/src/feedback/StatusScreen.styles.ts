import { css, layer } from '../styles/css.js';

/**
 * `StatusScreen`: one card, centred on the canvas, the full height of the
 * window.
 *
 * The card is a dialog's shape — `3xl` corners, `xl` elevation with the dark
 * theme's edge highlight — at a small sheet's width, because that is what it
 * is: one question or one message, alone on the page. It is static and never
 * focusable, so it may take the squircle corner where the browser has one
 * (SPEC §1.5). Below 30 rem of width the card lets go of its frame and the
 * content sits on the canvas, as the phone's own system screens do; a
 * container query, so a status screen inside a narrow pane behaves the same.
 */
export const statusScreenStyles = layer(
  'components',
  css`
.itsm-StatusScreen {
  container-type: inline-size;
  display: grid;
  place-items: center;
  box-sizing: border-box;
  min-block-size: 100dvh;
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
  max-inline-size: var(--itsm-sheet-sm);
  padding: var(--itsm-space-xl);
  border-radius: var(--itsm-radius-3xl);
  background: var(--itsm-colour-surface-raised);
  box-shadow: var(--itsm-elevation-xl), var(--itsm-edge-highlight);
  text-align: center;
}

@supports (corner-shape: squircle) {
  .itsm-StatusScreen__card {
    corner-shape: squircle;
  }
}

.itsm-StatusScreen__brand {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-xs);
  font-size: var(--itsm-text-headline-size);
  line-height: var(--itsm-text-headline-line);
  font-weight: var(--itsm-text-headline-weight);
  letter-spacing: var(--itsm-text-headline-tracking);
  color: var(--itsm-colour-text-primary);
}

.itsm-StatusScreen__illustration {
  margin-block: var(--itsm-space-xs) 0;
}

.itsm-StatusScreen__title {
  margin: 0;
  font-size: var(--itsm-text-title2-size);
  line-height: var(--itsm-text-title2-line);
  font-weight: var(--itsm-text-title2-weight);
  letter-spacing: var(--itsm-text-title2-tracking);
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

/* A form in the actions (a POST sign-out) lays its buttons out like the links above it. */
.itsm-StatusScreen__actions > form {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-xs);
  margin: 0;
}

@container (max-width: 30rem) {
  .itsm-StatusScreen__card {
    padding: var(--itsm-space-md) 0;
    background: transparent;
    box-shadow: none;
  }
}
`,
);
