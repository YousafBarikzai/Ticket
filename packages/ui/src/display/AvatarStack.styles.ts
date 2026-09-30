import { css, layer, mq } from '../styles/css.js';

const sizes = { xs: '1.25rem', sm: '1.5rem', md: '2rem', lg: '2.5rem', xl: '3.5rem' } as const;

const perSize = Object.entries(sizes)
  .map(([size, length]) => `.itsm-AvatarStack[data-size="${size}"] { --_itsm-stack-size: ${length}; }`)
  .join('\n');

/**
 * `AvatarStack`: avatars overlapping by a quarter of their width, each cut
 * out of the one before by a ring in the surface colour, and a "+2" disc of
 * the same size in the neutral tint (an audited pair).
 *
 * With an overflow the stack is a `<details>` summary: it keeps the look of
 * the stack, takes the base layer's focus ring on its capsule, firms the
 * "+2" disc's edge on hover, and opens a quiet sunken list of every name
 * beneath it — in the flow of the page, so nothing floats over the row it
 * belongs to and there is nothing to dismiss.
 */
export const avatarStackStyles = layer(
  'components',
  css`
.itsm-AvatarStack {
  --_itsm-stack-size: 1.5rem;
  --_itsm-stack-ring: var(--itsm-colour-surface-raised);
  display: inline-flex;
  align-items: center;
  vertical-align: middle;
  max-inline-size: 100%;
}

${perSize}

details.itsm-AvatarStack {
  display: inline-block;
}

.itsm-AvatarStack__summary {
  display: inline-flex;
  align-items: center;
  border-radius: var(--itsm-radius-pill);
  cursor: pointer;
  list-style: none;
}

.itsm-AvatarStack__summary::-webkit-details-marker {
  display: none;
}

.itsm-AvatarStack__avatar,
.itsm-AvatarStack__more {
  box-shadow: 0 0 0 var(--itsm-border-thick) var(--_itsm-stack-ring);
}

.itsm-AvatarStack__avatar + .itsm-AvatarStack__avatar,
.itsm-AvatarStack__more {
  margin-inline-start: calc(var(--_itsm-stack-size) * -0.25);
}

.itsm-AvatarStack__more {
  display: inline-grid;
  place-items: center;
  box-sizing: border-box;
  min-inline-size: var(--_itsm-stack-size);
  block-size: var(--_itsm-stack-size);
  padding-inline: var(--itsm-space-3xs);
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-neutral-subtle);
  color: var(--itsm-colour-neutral-subtleText);
  font-size: max(0.625rem, calc(var(--_itsm-stack-size) * 0.4));
  font-weight: var(--itsm-font-weight-semibold);
  font-variant-numeric: tabular-nums;
  line-height: 1;
  transition: box-shadow var(--itsm-duration-fast) var(--itsm-easing-standard);
}

.itsm-AvatarStack__summary:hover .itsm-AvatarStack__more,
details[open] > .itsm-AvatarStack__summary .itsm-AvatarStack__more {
  box-shadow:
    0 0 0 var(--itsm-border-thick) var(--_itsm-stack-ring),
    inset 0 0 0 var(--itsm-hairline) var(--itsm-colour-border-interactive);
}

.itsm-AvatarStack__list {
  display: grid;
  gap: var(--itsm-space-2xs);
  inline-size: max-content;
  max-inline-size: min(20rem, 100%);
  margin: var(--itsm-space-xs) 0 0;
  padding: var(--itsm-space-xs) var(--itsm-space-sm);
  border-radius: var(--itsm-radius-lg);
  background: var(--itsm-colour-surface-sunken);
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  list-style: none;
}

.itsm-AvatarStack__person {
  display: flex;
  align-items: center;
  gap: var(--itsm-space-xs);
  overflow-wrap: anywhere;
}

${mq.forcedColors} {
  .itsm-AvatarStack__more {
    border: var(--itsm-hairline) solid CanvasText;
  }
  .itsm-AvatarStack__list {
    border: var(--itsm-hairline) solid CanvasText;
  }
}
`,
);
