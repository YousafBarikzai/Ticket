import { css, layer, mq } from '../styles/css.js';

/**
 * `Tile` and `TileGrid`.
 *
 * The hover and focus lift is the treatment `styles/interactive.styles.ts`
 * describes, written out for this component; under reduced motion the
 * movement goes and the colour stays.
 */
export const tileStyles = layer(
  'components',
  css`
.itsm-Tile {
  transition:
    background-color var(--itsm-duration-fast) var(--itsm-easing-standard),
    border-color var(--itsm-duration-fast) var(--itsm-easing-standard),
    box-shadow var(--itsm-duration-fast) var(--itsm-easing-standard),
    transform var(--itsm-duration-fast) var(--itsm-easing-standard);
}

.itsm-Tile:hover,
.itsm-Tile:focus-visible {
  background: var(--itsm-colour-surface-hover);
  border-color: var(--itsm-colour-brand-border);
  box-shadow: var(--itsm-elevation-md);
  transform: translateY(calc(-1 * var(--itsm-lift-md)));
}

${mq.reducedMotion} {
  .itsm-Tile {
    transition: none;
  }
  .itsm-Tile:hover,
  .itsm-Tile:focus-visible {
    transform: none;
  }
}

.itsm-Tile {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--itsm-space-2xs);
  padding: var(--itsm-space-md);
  text-align: start;
  inline-size: 100%;
  background: var(--itsm-colour-surface-raised);
  border: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);
  border-radius: var(--itsm-radius-xl);
  color: var(--itsm-colour-text-primary);
  cursor: pointer;
  text-decoration: none;
  /* 44px is the touch floor in 'controlHeight'; a tile is a primary target. */
  min-block-size: var(--itsm-control-height-lg);
}
.itsm-Tile__icon {
  display: grid;
  place-items: center;
  inline-size: 2.5rem;
  block-size: 2.5rem;
  border-radius: var(--itsm-radius-lg);
  background: var(--itsm-colour-brand-solid);
  color: var(--itsm-colour-brand-solidText);
  font-size: var(--itsm-font-size-lg);
}
.itsm-Tile__title { font-size: var(--itsm-font-size-md); font-weight: var(--itsm-font-weight-semibold); }
.itsm-Tile__description { font-size: var(--itsm-font-size-sm); color: var(--itsm-colour-text-muted); margin: 0; }

.itsm-TileGrid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
  gap: var(--itsm-space-sm);
}
`,
);
