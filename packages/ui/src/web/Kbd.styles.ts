import { css, layer, mq } from '../styles/css.js';

/**
 * `Kbd`: key caps that sit in a line of text without disturbing it (v3
 * §2.14, A1 §7.17).
 *
 * The v3 cap is a small raised key: `surface.raised` face, a 1 px
 * `border.subtle` edge with a 2 px `border.soft` lip along the bottom, radius
 * `xs`, 600 11/16 in `text.muted` — the PMO search field's "⌘K". The face,
 * edge and lip are local variables, so one rule re-colours them where a light
 * key would glare: on the inverse bubbles (`Tooltip`, the icon button's and
 * the rail's) and on navy (`[data-surface="hero"]`) the cap takes its colour
 * from the text around it and tints its face and edges from `currentColor`
 * (decoration only, which is what `color-mix` is allowed for).
 *
 * Two glyph sets may be in the markup (⌘ and Ctrl); one is shown by the
 * platform attribute the pre-paint script writes. With no attribute — a page
 * rendered without the script — the non-Apple set shows, which is the
 * majority platform.
 *
 * `font: inherit` undoes the user agent's monospace on `<kbd>`, which also
 * shrinks it: key caps here are labels, set in the interface face.
 */
export const kbdStyles = layer(
  'components',
  css`
.itsm-Kbd {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-3xs);
  font: inherit;
  font-family: var(--itsm-font-family-sans);
  font-size: var(--itsm-text-caption-size);
  font-weight: var(--itsm-font-weight-semibold);
  line-height: var(--itsm-text-caption-line);
  letter-spacing: 0;
  color: var(--itsm-colour-text-muted);
  white-space: nowrap;
  vertical-align: middle;
  font-variant-numeric: tabular-nums;
}

.itsm-Kbd__set,
.itsm-Kbd__keys {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-3xs);
}

.itsm-Kbd__set[data-platform="apple"] {
  display: none;
}

:root[data-itsm-os="apple"] .itsm-Kbd__set[data-platform="apple"] {
  display: inline-flex;
}

:root[data-itsm-os="apple"] .itsm-Kbd__set[data-platform="other"] {
  display: none;
}

.itsm-Kbd__key {
  --_itsm-kbd-face: var(--itsm-colour-surface-raised);
  --_itsm-kbd-edge: var(--itsm-colour-border-subtle);
  --_itsm-kbd-lip: var(--itsm-colour-border-soft);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-inline-size: var(--itsm-space-ml);
  padding: var(--itsm-space-3xs) calc(var(--itsm-space-2xs) + 1px);
  border: var(--itsm-border-hair) solid var(--_itsm-kbd-edge);
  border-block-end: var(--itsm-border-thick) solid var(--_itsm-kbd-lip);
  border-radius: var(--itsm-radius-xs);
  background: var(--_itsm-kbd-face);
  font: inherit;
  color: inherit;
}

.itsm-Kbd__then {
  padding-inline: var(--itsm-space-3xs);
  font-weight: var(--itsm-font-weight-regular);
}

/* The small caps of menus, tooltips and the search trigger: one line of text tall. */
.itsm-Kbd[data-size="sm"] .itsm-Kbd__key {
  min-inline-size: calc(var(--itsm-space-md) + var(--itsm-space-3xs));
  padding: 0 var(--itsm-space-2xs);
  line-height: calc(var(--itsm-text-caption-line) - var(--itsm-space-3xs));
}

/* On an inverse bubble or on navy the cap is drawn from the text colour around it. */
:where(.itsm-Tooltip__content, .itsm-Bubble, .itsm-Sidebar__tip, [data-surface="hero"]) .itsm-Kbd {
  color: inherit;
}

:where(.itsm-Tooltip__content, .itsm-Bubble, .itsm-Sidebar__tip, [data-surface="hero"]) .itsm-Kbd__key {
  --_itsm-kbd-face: color-mix(in srgb, currentColor 10%, transparent);
  --_itsm-kbd-edge: color-mix(in srgb, currentColor 26%, transparent);
  --_itsm-kbd-lip: color-mix(in srgb, currentColor 38%, transparent);
}

:root[data-itsm-theme="high-contrast"] .itsm-Kbd__key,
:root[data-itsm-theme="high-contrast-dark"] .itsm-Kbd__key {
  --_itsm-kbd-edge: currentColor;
  --_itsm-kbd-lip: currentColor;
}

@media (prefers-contrast: more) {
  :root:not([data-itsm-theme]) .itsm-Kbd__key {
    --_itsm-kbd-edge: currentColor;
    --_itsm-kbd-lip: currentColor;
  }
}

${mq.forcedColors} {
  .itsm-Kbd__key {
    border-color: CanvasText;
  }
}
`,
);
