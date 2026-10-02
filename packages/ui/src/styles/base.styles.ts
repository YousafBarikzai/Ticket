import { css, layer, mq, prefers } from './css.js';

/**
 * The base layer: what every element gets before any component says otherwise.
 *
 * The document itself — canvas colour, text colour, the family and the
 * smoothing — attaches to `body`, and every descendant inherits it. Before this
 * layer only elements with an `itsm-` class had the family, and the body kept
 * the browser's 8px margin, so every app showed a strip of the browser's own
 * canvas round the shell.
 *
 * The focus ring attaches through `:where(:focus-visible)`: zero specificity,
 * so a component that draws its own focus state needs no fight to do it, and
 * every focusable element gets it — a plain link in an app page as well as a
 * design-system button. It is two-tone: the accent outline sits two pixels off
 * the element and a `box-shadow` in `focusGap` (the colour of a card) fills
 * the gap, so the ring reaches 3:1 against glass, a saturated fill or a dark
 * canvas alike. The ring follows the element's own corners; the high-contrast
 * themes widen it through `--itsm-focus-width`, and in forced colours the
 * token layer hands its colour to the system's `Highlight`.
 *
 * `[hidden]` wins over a component's `display` with `!important`. Without it,
 * `hidden` on an element whose class sets `display: flex` does nothing, and the
 * one attribute that should reliably hide something does not. `until-found` is
 * left alone: the browser hides that with `content-visibility` so that
 * find-in-page can still reach it.
 *
 * The rest is the document-wide furniture of the redesign (spec §3.2): the
 * selection colour, thin scrollbars in the theme's own grey instead of the
 * loudest legacy signal on Windows, balanced headings, link colour for a bare
 * `<a>`, and room at the bottom of the page for the phone's bottom dock when
 * something scrolls into view.
 *
 * `[data-surface="hero"]` re-themes everything inside a navy surface (the
 * hero card, the system bar, the sign-in panel, the landing bands) in one
 * place, so each of them does not have to (SPEC-v3 §2.5). Its text is the
 * navy's own, and its focus ring takes the navy's accent with a navy gap: the
 * page accent is drawn for light surfaces, and in high contrast (`#0040dd`)
 * it is 2.36:1 on navy, where the hero accent passes. Zero specificity, so a
 * component inside can still set its own colour.
 */
export const baseStyles = layer(
  'base',
  css`
:where(html) {
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
  scrollbar-color: var(--itsm-colour-border-strong) transparent;
  scroll-padding-block-end: var(--itsm-bottom-dock-height);
}

body {
  margin: 0;
  background: var(--itsm-colour-surface-canvas);
  color: var(--itsm-colour-text-primary);
  font-family: var(--itsm-font-family-sans);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

::selection {
  background: var(--itsm-colour-surface-selection);
  color: var(--itsm-colour-text-primary);
}

:where(*) {
  scrollbar-width: thin;
}

:where(:focus-visible) {
  outline: var(--itsm-focus-width) solid var(--itsm-colour-border-focus);
  outline-offset: var(--itsm-focus-offset);
  box-shadow: 0 0 0 var(--itsm-focus-offset) var(--itsm-colour-focusGap);
}

:where(h1, h2, h3, h4, h5, h6) {
  text-wrap: balance;
}

:where(p) {
  text-wrap: pretty;
}

:where(a:any-link) {
  color: var(--itsm-colour-text-link);
}

:where([data-surface="hero"]) {
  --itsm-colour-border-focus: var(--itsm-colour-hero-accent);
  --itsm-colour-focusGap: var(--itsm-colour-hero-surface);
  color: var(--itsm-colour-hero-text);
}

@media (forced-colors: active) {
  :where([data-surface="hero"]) {
    --itsm-colour-border-focus: Highlight;
    --itsm-colour-focusGap: Canvas;
  }
}

:where([hidden]:not([hidden="until-found"])) {
  display: none !important;
}

${mq.reducedMotion} {
  :where(html) {
    scroll-behavior: auto;
  }

  ::view-transition-group(*),
  ::view-transition-old(*),
  ::view-transition-new(*) {
    animation: none !important;
  }
}

${prefers.reducedMotion} {
  scroll-behavior: auto;
}

${prefers.reducedMotion}::view-transition-group(*),
${prefers.reducedMotion}::view-transition-old(*),
${prefers.reducedMotion}::view-transition-new(*) {
  animation: none !important;
}
`,
);
