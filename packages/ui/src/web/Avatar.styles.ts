import { AVATAR_HUES, moreContrast } from '../display/tone.js';
import { css, layer, mq } from '../styles/css.js';

/**
 * @deprecated v2's tint share, read only by `display/__tests__/avatar-tints.test.ts`,
 * which v3 deletes (§2.16) in favour of `avatar-palette.test.ts`. v3 draws no
 * tint: remove this with that file.
 */
export const AVATAR_TINT_PERCENT = 22;

const fills = Array.from(
  { length: AVATAR_HUES },
  (_, index) => `.itsm-Avatar[data-hue="${index + 1}"] { --_itsm-avatar-fill: var(--itsm-colour-avatar-${index + 1}); }`,
).join('\n');

/**
 * `Avatar` v3 (§2.6, §2.14, A1 §3.9 and §7.10): white initials on a deep
 * disc, a circle for people and a rounded square for teams; AI and system
 * avatars carry a glyph instead of letters, and nobody is a dashed ring.
 *
 * The disc is one of the eight `--itsm-colour-avatar-N` tokens, read as is —
 * never mixed — so the pair under the letters is exactly the one the token
 * audit checks (`avatarContract()`: white on each fill, every theme). The
 * letters are `avatar.text` 600 with 0.02em tracking, at 40 % of the disc:
 * 10 px at `sm`, 13 at `md`, 16 at `lg`, 22 at `xl`. `xs` is the exception
 * the critique asked for (X-m18): 9 px and no tracking, so two letters still
 * fit 20 px.
 *
 * `ring` draws a 2 px ring in the raised surface around the disc, for stacks
 * and for avatars laid over a card's edge. Unassigned is transparent with a
 * 1.5 px dashed `border.interactive` edge and a `text.muted` person glyph:
 * an absence, drawn quietly.
 *
 * Presence dots differ in shape as well as hue, so they read without colour:
 * online is a filled dot, busy a dot with a bar through it, away a thick
 * ring, offline a thin hollow ring. Each is cut out of the avatar by a ring
 * in the surface colour, the way the platform draws it.
 *
 * More contrast outlines the disc; forced colours paints it in system
 * colours and keeps the presence shapes.
 */
export const avatarStyles = layer(
  'components',
  css`
.itsm-Avatar {
  --_itsm-avatar-size: 2rem;
  --_itsm-avatar-fill: var(--itsm-colour-avatar-1);
  position: relative;
  display: inline-grid;
  place-items: center;
  flex: none;
  box-sizing: border-box;
  inline-size: var(--_itsm-avatar-size);
  block-size: var(--_itsm-avatar-size);
  border-radius: var(--itsm-radius-pill);
  background: var(--_itsm-avatar-fill);
  color: var(--itsm-colour-avatar-text);
  font-family: var(--itsm-font-family-sans);
  font-size: calc(var(--_itsm-avatar-size) * 0.4);
  font-weight: var(--itsm-font-weight-semibold);
  line-height: 1;
  letter-spacing: 0.02em;
  word-spacing: normal;
  white-space: nowrap;
  user-select: none;
  vertical-align: middle;
}

${fills}

.itsm-Avatar[data-size="xs"] { --_itsm-avatar-size: 1.25rem; font-size: 0.5625rem; letter-spacing: 0; }
.itsm-Avatar[data-size="sm"] { --_itsm-avatar-size: 1.5rem; font-size: 0.625rem; }
.itsm-Avatar[data-size="md"] { --_itsm-avatar-size: 2rem; font-size: 0.8125rem; }
.itsm-Avatar[data-size="lg"] { --_itsm-avatar-size: 2.5rem; font-size: 1rem; }
.itsm-Avatar[data-size="xl"] { --_itsm-avatar-size: 3.5rem; font-size: 1.375rem; }

.itsm-Avatar__initials {
  /* The tracking adds space after the last letter too; this pulls the pair back to the centre. */
  margin-inline-end: -0.02em;
}

.itsm-Avatar[data-size="xs"] .itsm-Avatar__initials {
  margin-inline-end: 0;
}

.itsm-Avatar[data-kind="team"] {
  border-radius: 26%;
}

.itsm-Avatar[data-kind="system"] {
  background: var(--itsm-colour-neutral-subtle);
  color: var(--itsm-colour-neutral-subtleText);
}

.itsm-Avatar[data-kind="unassigned"] {
  background: transparent;
  border: calc(var(--itsm-border-hair) * 1.5) dashed var(--itsm-colour-border-interactive);
  color: var(--itsm-colour-text-muted);
}

.itsm-Avatar[data-ring] {
  box-shadow: 0 0 0 var(--itsm-border-thick) var(--itsm-colour-surface-raised);
}

.itsm-Avatar__glyph {
  inline-size: 56%;
  block-size: 56%;
}

.itsm-Avatar[data-kind="unassigned"] .itsm-Avatar__glyph {
  inline-size: 60%;
  block-size: 60%;
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

${moreContrast(
  (scope) => `${scope} .itsm-Avatar:not([data-kind="unassigned"]) { box-shadow: inset 0 0 0 var(--itsm-hairline) var(--itsm-colour-border-strong); }
${scope} .itsm-Avatar[data-ring]:not([data-kind="unassigned"]) { box-shadow: inset 0 0 0 var(--itsm-hairline) var(--itsm-colour-border-strong), 0 0 0 var(--itsm-border-thick) var(--itsm-colour-surface-raised); }`,
)}

${mq.forcedColors} {
  .itsm-Avatar {
    border: var(--itsm-hairline) solid CanvasText;
  }
  .itsm-Avatar[data-kind="unassigned"] {
    border-style: dashed;
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
