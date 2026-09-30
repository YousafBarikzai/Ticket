import { AVATAR_HUES, moreContrast } from '../display/tone.js';
import { css, layer, mq } from '../styles/css.js';

/**
 * The share of the categorical hue in an avatar's tint, mixed into the raised
 * surface. One value for every theme: over white it is a pastel, over the
 * dark theme's raised grey a deep shade of the same hue, and the initials
 * (`text.secondary`) clear 4.5:1 on all eight in the standard themes and 7:1
 * in the high-contrast ones — `display/__tests__/avatar-tints.test.ts` works
 * the composite out from the tokens and holds it to that.
 */
export const AVATAR_TINT_PERCENT = 22;

const hues = Array.from(
  { length: AVATAR_HUES },
  (_, index) => `.itsm-Avatar[data-hue="${index + 1}"] { --_itsm-avatar-tint: var(--itsm-colour-chart-${index + 1}); }`,
).join('\n');

/**
 * `Avatar`: a monogram on a tint, circle for people and a rounded square for
 * teams; AI and system avatars carry a glyph instead of letters.
 *
 * The tint is `color-mix()` of an audited chart hue into the audited raised
 * surface — decoration under text, which §3.3 rule 9 otherwise keeps
 * `color-mix()` away from, so the composite is audited by its own test
 * instead of being assumed.
 *
 * Presence dots differ in shape as well as hue, so they read without colour:
 * online is a filled dot, busy a dot with a bar through it, away a thick
 * ring, offline a thin hollow ring. Each is cut out of the avatar by a ring
 * in the surface colour, the way the platform draws it.
 *
 * More contrast outlines the monogram; forced colours paints it in system
 * colours and keeps the presence shapes.
 */
export const avatarStyles = layer(
  'components',
  css`
.itsm-Avatar {
  --_itsm-avatar-size: 2rem;
  --_itsm-avatar-tint: var(--itsm-colour-chart-1);
  position: relative;
  display: inline-grid;
  place-items: center;
  flex: none;
  box-sizing: border-box;
  inline-size: var(--_itsm-avatar-size);
  block-size: var(--_itsm-avatar-size);
  border-radius: var(--itsm-radius-pill);
  background: color-mix(in srgb, var(--_itsm-avatar-tint) ${AVATAR_TINT_PERCENT}%, var(--itsm-colour-surface-raised));
  color: var(--itsm-colour-text-secondary);
  font-size: calc(var(--_itsm-avatar-size) * 0.42);
  font-weight: var(--itsm-font-weight-semibold);
  line-height: 1;
  letter-spacing: 0;
  white-space: nowrap;
  user-select: none;
  vertical-align: middle;
}

${hues}

.itsm-Avatar[data-size="xs"] { --_itsm-avatar-size: 1.25rem; font-size: 0.625rem; }
.itsm-Avatar[data-size="sm"] { --_itsm-avatar-size: 1.5rem; }
.itsm-Avatar[data-size="md"] { --_itsm-avatar-size: 2rem; }
.itsm-Avatar[data-size="lg"] { --_itsm-avatar-size: 2.5rem; }
.itsm-Avatar[data-size="xl"] { --_itsm-avatar-size: 3.5rem; }

.itsm-Avatar[data-kind="team"] {
  border-radius: 26%;
}

.itsm-Avatar[data-kind="system"] {
  background: var(--itsm-colour-neutral-subtle);
  color: var(--itsm-colour-neutral-subtleText);
}

.itsm-Avatar__glyph {
  inline-size: 56%;
  block-size: 56%;
}

.itsm-Avatar__status {
  position: absolute;
  inset-block-end: 0;
  inset-inline-end: 0;
  inline-size: max(0.5rem, 28%);
  block-size: max(0.5rem, 28%);
  box-sizing: border-box;
  border-radius: var(--itsm-radius-pill);
  box-shadow: 0 0 0 var(--itsm-border-thick) var(--itsm-colour-surface-raised);
  background: var(--itsm-colour-success-solid);
}

.itsm-Avatar__status[data-status="busy"] {
  background:
    linear-gradient(var(--itsm-colour-surface-raised), var(--itsm-colour-surface-raised)) center / 56% 24% no-repeat,
    var(--itsm-colour-danger-solid);
}

.itsm-Avatar__status[data-status="away"] {
  background: radial-gradient(circle, var(--itsm-colour-surface-raised) 0 30%, var(--itsm-colour-warning-solid) 32%);
}

.itsm-Avatar__status[data-status="offline"] {
  background: var(--itsm-colour-surface-raised);
  box-shadow:
    inset 0 0 0 var(--itsm-border-thick) var(--itsm-colour-border-strong),
    0 0 0 var(--itsm-border-thick) var(--itsm-colour-surface-raised);
}

${moreContrast((scope) => `${scope} .itsm-Avatar { box-shadow: inset 0 0 0 var(--itsm-hairline) var(--itsm-colour-border-strong); }`)}

${mq.forcedColors} {
  .itsm-Avatar {
    border: var(--itsm-hairline) solid CanvasText;
  }
  .itsm-Avatar__status {
    forced-color-adjust: none;
    background: CanvasText;
    box-shadow: 0 0 0 var(--itsm-border-thick) Canvas;
  }
  .itsm-Avatar__status[data-status="busy"] {
    background: linear-gradient(Canvas, Canvas) center / 56% 24% no-repeat, CanvasText;
  }
  .itsm-Avatar__status[data-status="away"] {
    background: radial-gradient(circle, Canvas 0 30%, CanvasText 32%);
  }
  .itsm-Avatar__status[data-status="offline"] {
    background: Canvas;
    box-shadow: inset 0 0 0 var(--itsm-border-thick) CanvasText, 0 0 0 var(--itsm-border-thick) Canvas;
  }
}
`,
);
