import { css, layer, mq } from '../styles/css.js';

/**
 * `SignInLayout`: the navy panel beside the light column (SPEC v3 §6.3;
 * A5 §6.2).
 *
 * **Phones and tablets first.** Below 1024 px the panel is a 120 px band
 * (96 px below 480) carrying the lockup alone, and the column is a card on
 * the canvas that rides 24 px up over the band. The card is positioned for
 * that reason only: the panel is positioned (its grid lines hang off it), and
 * a positioned box paints over any unpositioned sibling, so without it the
 * band would cover the card's top edge. Below 480 px the card loses its frame
 * and runs full width inside 16 px gutters: a bordered box inset by a few
 * pixels on a phone is noise.
 *
 * **From 1024 px** the page is a `45fr 55fr` grid as tall as the viewport
 * under the system bar (`--itsm-system-bar-h`, which only `SystemBar` sets).
 * The panel stacks lockup, pitch and vendor line with the pitch in the
 * middle; the column paints `surface.raised` and centres its content at
 * 420 px (`form`) or 560 px (`chooser`). The back link sits in the column's
 * top corner, so the column's top padding clears it at every pointer size.
 *
 * Everything on the panel is a hero token, so dark mode leaves it as it is and
 * the column alone turns dark. The 32 px grid is `hero.text` at 3.5 % — the
 * one `color-mix` — masked to fade from the middle; a mask stop is coverage,
 * not paint, which is why it may say `black`. In forced colours the panel is a
 * plain `Canvas` block with an edge, and in print it is gone.
 */
export const signInLayoutStyles = layer(
  'patterns',
  css`
.itsm-SignInLayout {
  --_itsm-signin-content: 26.25rem;
  min-block-size: 100dvh;
  background: var(--itsm-colour-surface-canvas);
}

.itsm-SignInLayout[data-width="chooser"] {
  --_itsm-signin-content: 35rem;
}

.itsm-SignInLayout__panel {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  block-size: 7.5rem;
  padding: 0 var(--itsm-space-md) var(--itsm-space-lg);
  overflow: hidden;
  background: var(--itsm-hero-panel-background);
  color: var(--itsm-colour-hero-text);
}

.itsm-SignInLayout__panel::before {
  --_itsm-signin-line: color-mix(in srgb, var(--itsm-colour-hero-text) 3.5%, transparent);
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(to right, var(--_itsm-signin-line) var(--itsm-border-hair), transparent var(--itsm-border-hair)),
    linear-gradient(to bottom, var(--_itsm-signin-line) var(--itsm-border-hair), transparent var(--itsm-border-hair));
  background-size: 2rem 2rem;
  mask-image: radial-gradient(ellipse 80% 70% at 40% 45%, black, transparent);
}

/* Above the grid lines, which come first in tree order. */
.itsm-SignInLayout__panel > * {
  position: relative;
}

.itsm-SignInLayout__lockup {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-sm);
  border-radius: var(--itsm-radius-md);
  color: var(--itsm-colour-hero-text);
  text-decoration: none;
}

.itsm-SignInLayout__mark {
  max-inline-size: 2.25rem;
  max-block-size: 2.25rem;
}

.itsm-SignInLayout__lockupText {
  display: grid;
}

.itsm-SignInLayout__product {
  font-size: var(--itsm-font-size-lg);
  line-height: 1.25rem;
  font-weight: var(--itsm-font-weight-bold);
}

.itsm-SignInLayout__suffix,
.itsm-SignInLayout__poweredBy {
  font-size: 0.78125rem;
  line-height: 1rem;
  font-weight: var(--itsm-font-weight-medium);
  color: var(--itsm-colour-hero-textMuted);
}

.itsm-SignInLayout__pitch,
.itsm-SignInLayout__poweredBy {
  display: none;
}

.itsm-SignInLayout__headline {
  margin: 0;
  max-inline-size: 15em;
  font-family: var(--itsm-text-hero-family);
  font-size: clamp(1.875rem, 3.1vw, 2.5rem);
  line-height: 1.12;
  font-weight: var(--itsm-font-weight-bold);
  letter-spacing: -0.028em;
  word-spacing: var(--itsm-text-hero-word-spacing);
  color: var(--itsm-colour-hero-text);
}

.itsm-SignInLayout__points {
  display: grid;
  gap: 0.875rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.itsm-SignInLayout__point {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  font-size: var(--itsm-font-size-md);
  line-height: 1.375rem;
  font-weight: var(--itsm-font-weight-regular);
  color: var(--itsm-colour-hero-textSecondary);
}

.itsm-SignInLayout__main {
  position: relative;
  box-sizing: border-box;
  inline-size: min(100% - 2 * var(--itsm-space-md), 35rem);
  margin: calc(-1 * var(--itsm-space-lg)) auto var(--itsm-space-xl);
  padding: 1.75rem var(--itsm-space-lg) 1.375rem;
  border: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);
  border-radius: var(--itsm-radius-3xl);
  background: var(--itsm-colour-surface-raised);
}

.itsm-SignInLayout__main:focus {
  outline: none;
}

.itsm-SignInLayout__back {
  display: inline-flex;
  align-items: center;
  gap: calc(var(--itsm-space-2xs) + var(--itsm-space-3xs));
  box-sizing: border-box;
  min-block-size: 2.25rem;
  margin: 0 0 var(--itsm-space-md) calc(-1 * var(--itsm-space-xs));
  padding-inline: var(--itsm-space-xs);
  border-radius: var(--itsm-radius-md);
  font-size: 0.84375rem;
  line-height: 1.25rem;
  font-weight: var(--itsm-font-weight-semibold);
  color: var(--itsm-colour-text-primary);
  text-decoration: none;
}

.itsm-SignInLayout__back:hover {
  background: var(--itsm-colour-surface-hover);
}

.itsm-SignInLayout__footer {
  padding: 0 var(--itsm-space-md) var(--itsm-space-xl);
  text-align: center;
  font-size: 0.78125rem;
  line-height: 1.125rem;
  font-weight: var(--itsm-font-weight-medium);
  color: var(--itsm-colour-text-secondary);
}

.itsm-SignInLayout__footer a {
  color: inherit;
  text-underline-offset: 0.2em;
}

${mq.coarse} {
  .itsm-SignInLayout__back {
    min-block-size: 2.75rem;
  }
}

${mq.belowSm} {
  .itsm-SignInLayout__panel {
    block-size: 6rem;
    padding-block-end: 0;
  }

  .itsm-SignInLayout__main {
    inline-size: auto;
    margin: 0;
    padding: var(--itsm-space-lg) var(--itsm-space-md);
    border: 0;
    border-radius: 0;
    background: transparent;
  }
}

${mq.lg} {
  .itsm-SignInLayout__grid {
    display: grid;
    grid-template-columns: minmax(0, 45fr) minmax(0, 55fr);
    min-block-size: calc(100vh - var(--itsm-system-bar-h));
    min-block-size: calc(100dvh - var(--itsm-system-bar-h));
  }

  .itsm-SignInLayout__panel {
    flex-direction: column;
    align-items: stretch;
    justify-content: flex-start;
    block-size: auto;
    padding: 2.75rem clamp(2rem, 5vw, 4rem) 2.25rem;
  }

  .itsm-SignInLayout__lockup {
    align-self: flex-start;
  }

  .itsm-SignInLayout__mark {
    max-inline-size: none;
    max-block-size: none;
  }

  .itsm-SignInLayout__pitch {
    display: grid;
    gap: var(--itsm-space-xl);
    margin-block: auto;
    padding-block: var(--itsm-space-xl);
  }

  .itsm-SignInLayout__poweredBy {
    display: block;
    margin: 0;
  }

  .itsm-SignInLayout__column {
    position: relative;
    display: flex;
    flex-direction: column;
    background: var(--itsm-colour-surface-raised);
  }

  .itsm-SignInLayout__main {
    position: static;
    display: grid;
    flex: 1;
    align-content: center;
    justify-items: center;
    inline-size: auto;
    margin: 0;
    padding: var(--itsm-space-4xl) 0 var(--itsm-space-2xl);
    border: 0;
    border-radius: 0;
    background: transparent;
  }

  .itsm-SignInLayout__content {
    inline-size: min(100% - 2 * var(--itsm-space-lg), var(--_itsm-signin-content));
  }

  .itsm-SignInLayout__back {
    position: absolute;
    inset-block-start: var(--itsm-space-lg);
    inset-inline-start: var(--itsm-space-lg);
    margin: 0;
  }

  .itsm-SignInLayout__footer {
    padding-block-end: var(--itsm-space-lg);
  }
}

${mq.forcedColors} {
  .itsm-SignInLayout__panel {
    background: Canvas;
    border-block-end: var(--itsm-border-hair) solid CanvasText;
  }

  .itsm-SignInLayout__panel::before {
    display: none;
  }
}

${mq.lg} {
  ${mq.forcedColors} {
    .itsm-SignInLayout__panel {
      border-block-end: 0;
      border-inline-end: var(--itsm-border-hair) solid CanvasText;
    }
  }
}

@media print {
  .itsm-SignInLayout__panel {
    display: none;
  }
}
`,
);
