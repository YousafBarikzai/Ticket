import { css, layer, mq } from '../styles/css.js';

/**
 * `Kbd`: key caps that sit in a line of text without disturbing it.
 *
 * Colour comes from the surrounding text (`inherit`) and the cap's face and
 * edge are tinted from `currentColor`, so the same hint is right in a menu row
 * (muted), a search field (secondary) and on a dark tooltip (inverse) without
 * a variant for each. The tint is decoration only — the text keeps its own
 * audited colour — which is what SPEC §3.3 rule 9 allows `color-mix` for.
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
  font-size: var(--itsm-text-footnote-size);
  font-weight: var(--itsm-font-weight-medium);
  line-height: 1;
  letter-spacing: 0;
  color: inherit;
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
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-inline-size: var(--itsm-space-ml);
  block-size: var(--itsm-space-ml);
  padding-inline: var(--itsm-space-2xs);
  border: var(--itsm-hairline) solid color-mix(in srgb, currentColor 24%, transparent);
  border-radius: var(--itsm-radius-xs);
  background: color-mix(in srgb, currentColor 7%, transparent);
  box-shadow: inset 0 calc(var(--itsm-hairline) * -1) 0 color-mix(in srgb, currentColor 18%, transparent);
  font: inherit;
  color: inherit;
}

.itsm-Kbd__then {
  padding-inline: var(--itsm-space-3xs);
  font-weight: var(--itsm-font-weight-regular);
}

.itsm-Kbd[data-size="sm"] {
  font-size: var(--itsm-text-caption-size);
}

.itsm-Kbd[data-size="sm"] .itsm-Kbd__key {
  min-inline-size: calc(var(--itsm-space-md) + var(--itsm-space-3xs));
  block-size: calc(var(--itsm-space-md) + var(--itsm-space-3xs));
  padding-inline: var(--itsm-space-3xs);
}

:root[data-itsm-theme="high-contrast"] .itsm-Kbd__key,
:root[data-itsm-theme="high-contrast-dark"] .itsm-Kbd__key {
  border-color: currentColor;
  box-shadow: none;
}

@media (prefers-contrast: more) {
  :root:not([data-itsm-theme]) .itsm-Kbd__key {
    border-color: currentColor;
    box-shadow: none;
  }
}

${mq.forcedColors} {
  .itsm-Kbd__key {
    border-color: CanvasText;
    box-shadow: none;
  }
}
`,
);
