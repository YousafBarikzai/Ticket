import { css, layer, mq } from './css.js';

/**
 * `.itsm-Interactive`: the one rule set for a surface a person can point at or
 * tab to — a soft blue background, a slightly firmer border and a small rise.
 * The design-system components that behave this way (the interactive `Card`,
 * `Tile`, the interactive `Metric`, a table row) carry the same rules in their
 * own modules; this class is the same treatment for anything else.
 *
 * Hover and `:focus-visible` are listed together on purpose rather than the
 * hover being written and the focus being left to the outline. Somebody
 * driving this with a keyboard is doing the same thing as somebody with a
 * mouse; an outline alone tells them where they are but not that the thing is
 * pointable. The outline stays as well — it is what carries the state at high
 * contrast, where a tint is not enough.
 *
 * Nothing essential is hidden behind any of this. Every one of these states
 * changes colour and position only, so a touch device that never fires hover
 * loses nothing.
 *
 * Under reduced motion the movement is what goes, not the state: somebody who
 * asks for less motion still needs to know what is hovered and focused, so the
 * colour and border stay and only the transform and transition are dropped.
 * The token layer already collapses every duration to 1ms; this removes the
 * displacement itself, which a duration cannot.
 *
 * Registered before every component module, in the components layer, which is
 * where the old stylesheet had it: a component rule that sets the same
 * property with the same specificity still wins.
 */
export const interactiveStyles = layer(
  'components',
  css`
.itsm-Interactive {
  transition:
    background-color var(--itsm-duration-fast) var(--itsm-easing-standard),
    border-color var(--itsm-duration-fast) var(--itsm-easing-standard),
    box-shadow var(--itsm-duration-fast) var(--itsm-easing-standard),
    transform var(--itsm-duration-fast) var(--itsm-easing-standard);
}

.itsm-Interactive:hover,
.itsm-Interactive:focus-visible {
  background: var(--itsm-colour-surface-hover);
  border-color: var(--itsm-colour-brand-border);
  box-shadow: var(--itsm-elevation-md);
  transform: translateY(calc(-1 * var(--itsm-lift-md)));
}

${mq.reducedMotion} {
  .itsm-Interactive {
    transition: none;
  }
  .itsm-Interactive:hover,
  .itsm-Interactive:focus-visible,
  .itsm-Interactive:focus-within {
    transform: none;
  }
}
`,
);
