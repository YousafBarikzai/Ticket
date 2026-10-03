import { css, layer, mq } from '../styles/css.js';

/**
 * Edge fades for a row of tabs that scrolls sideways (A1 §7.7): 36 px at
 * whichever end has more tabs behind it, so a cut-off tab reads as "more
 * this way" rather than as a layout bug.
 *
 * Pure CSS, driven by the row's own scroll position (a scroll timeline), so
 * it costs no script and no listener. Two mask layers, one per end, each a
 * little wider than the row; sliding a layer by the fade's width moves its
 * transparent end into or out of view. With nothing to scroll the timeline
 * is inactive and neither end fades; in RTL the timeline starts at the right
 * edge, so the animation simply runs backwards. Browsers without scroll
 * timelines skip the block and keep the plain scrolling row. The mask is
 * alpha only — `black` here is "opaque", not a colour anyone sees.
 *
 * `TabNav.styles.ts` reuses this for its track.
 */
export function scrollFades(selector: string): string {
  return `@supports (animation-timeline: scroll()) {
  ${selector} {
    --_fade: calc(var(--itsm-space-xl) + var(--itsm-space-2xs));
    mask-image:
      linear-gradient(to right, transparent, black var(--_fade)),
      linear-gradient(to left, transparent, black var(--_fade));
    mask-size: calc(100% + var(--_fade)) 100%;
    mask-repeat: no-repeat;
    mask-composite: intersect;
    mask-position: calc(-1 * var(--_fade)) 0, 0 0;
    animation: itsm-scroll-fades linear both;
    animation-timeline: scroll(self inline);
  }
  ${selector}:dir(rtl) {
    animation-direction: reverse;
  }
}`;
}

/**
 * `Tabs`, in three looks (v3 §2.14, A1 §7.7).
 *
 * `underline` (page level): tabs 40 px tall, 500 14/20 in `text.muted`, 20 px
 * apart over a `border.subtle` hairline; the selected one is `text.primary`
 * 600 over a 2 px accent bar (square at the foot, so it sits on the rule)
 * that fades and widens in. `pill` (inside cards and lists): quiet 28 px
 * pills; the selected one is raised — `surface.raised`, a `border.soft`
 * edge and the `sm` shadow. `segmented`: the `SegmentedControl` look, an
 * opaque sunken track with the selected tab raised on it (without the slide:
 * a tab list may scroll).
 *
 * A count is the shared `Count` (accent on the selected tab). The tab list
 * scrolls sideways when it is too narrow, with edge fades; a scroll container
 * clips anything drawn outside it, so the tabs draw their focus ring inside
 * their own edge rather than two pixels outside it.
 */
export const tabsStyles = layer(
  'components',
  css`
.itsm-Tabs {
  min-inline-size: 0;
}

.itsm-Tabs__list {
  display: flex;
  gap: var(--itsm-space-2xs);
  overflow-x: auto;
  scrollbar-width: none;
}
.itsm-Tabs__list::-webkit-scrollbar {
  display: none;
}

.itsm-Tabs__tab {
  position: relative;
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  gap: calc(var(--itsm-space-2xs) + var(--itsm-space-3xs));
  min-block-size: var(--itsm-control-height-md);
  margin: 0;
  padding-block: 0;
  padding-inline: var(--itsm-space-sm);
  border: 0;
  border-radius: var(--itsm-radius-md);
  background: none;
  color: var(--itsm-colour-text-muted);
  font-family: inherit;
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  letter-spacing: var(--itsm-text-subheadline-tracking);
  font-weight: var(--itsm-font-weight-medium);
  white-space: nowrap;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition:
    color var(--itsm-duration-fast) var(--itsm-easing-standard),
    background-color var(--itsm-duration-fast) var(--itsm-easing-standard),
    border-color var(--itsm-duration-fast) var(--itsm-easing-standard),
    box-shadow var(--itsm-duration-fast) var(--itsm-easing-standard);
}

.itsm-Tabs__tab:hover:not(:disabled) {
  color: var(--itsm-colour-text-primary);
}

.itsm-Tabs__tab[aria-selected="true"] {
  color: var(--itsm-colour-text-primary);
  font-weight: var(--itsm-font-weight-semibold);
}

.itsm-Tabs__tab:disabled {
  color: var(--itsm-colour-text-disabled);
  cursor: not-allowed;
}

.itsm-Tabs__tab:focus-visible {
  outline-offset: calc(-1 * var(--itsm-focus-width));
  box-shadow: none;
}

.itsm-Tabs__label {
  display: inline-flex;
  flex-direction: column;
}
.itsm-Tabs__label[data-text]::after {
  content: attr(data-text);
  block-size: 0;
  overflow: hidden;
  visibility: hidden;
  font-weight: var(--itsm-font-weight-semibold);
  user-select: none;
  pointer-events: none;
}

.itsm-Tabs__count {
  flex: none;
}

.itsm-Tabs__panel {
  padding-block: var(--itsm-space-md);
}

/* Underline: page-level tabs on a hairline. */

.itsm-Tabs--underline .itsm-Tabs__list {
  gap: calc(var(--itsm-space-ml) - 2 * var(--itsm-space-3xs));
  box-shadow: inset 0 calc(-1 * var(--itsm-border-hair)) 0 var(--itsm-colour-border-subtle);
}

.itsm-Tabs--underline .itsm-Tabs__tab {
  min-block-size: calc(var(--itsm-control-height-md) + var(--itsm-space-2xs));
  padding-inline: var(--itsm-space-3xs);
  border-radius: var(--itsm-radius-sm) var(--itsm-radius-sm) 0 0;
  font-size: var(--itsm-text-body-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-body-tracking);
}

.itsm-Tabs--underline .itsm-Tabs__tab::after {
  content: "";
  position: absolute;
  inset-inline: var(--itsm-space-3xs);
  inset-block-end: 0;
  block-size: var(--itsm-border-thick);
  border-radius: var(--itsm-border-thick) var(--itsm-border-thick) 0 0;
  background-color: var(--itsm-colour-accent);
  opacity: 0;
  transform: scaleX(0.6);
  transition:
    opacity var(--itsm-duration-fast) var(--itsm-easing-standard),
    transform var(--itsm-duration-normal) var(--itsm-easing-entrance);
}

.itsm-Tabs--underline .itsm-Tabs__tab[aria-selected="true"]::after {
  opacity: 1;
  transform: none;
}

/* Pill: quiet tabs inside a card or a list, the selected one raised. */

.itsm-Tabs--pill .itsm-Tabs__tab {
  min-block-size: var(--itsm-control-height-sm);
  padding-inline: calc(var(--itsm-space-sm) - var(--itsm-border-hair));
  border: var(--itsm-border-hair) solid transparent;
  border-radius: var(--itsm-radius-pill);
}

.itsm-Tabs--pill .itsm-Tabs__tab:hover:not(:disabled):not([aria-selected="true"]) {
  background-color: var(--itsm-colour-surface-hover);
}

.itsm-Tabs--pill .itsm-Tabs__tab[aria-selected="true"] {
  border-color: var(--itsm-colour-border-soft);
  background-color: var(--itsm-colour-surface-raised);
  box-shadow: var(--itsm-elevation-sm);
}
.itsm-Tabs--pill .itsm-Tabs__tab[aria-selected="true"]:focus-visible {
  box-shadow: var(--itsm-elevation-sm);
}

/* Segmented: the SegmentedControl look. */

.itsm-Tabs--segmented .itsm-Tabs__list {
  display: inline-flex;
  box-sizing: border-box;
  max-inline-size: 100%;
  gap: var(--itsm-space-3xs);
  padding: var(--itsm-space-3xs);
  border-radius: var(--itsm-radius-lg);
  background-color: var(--itsm-colour-surface-sunken);
}

.itsm-Tabs--segmented .itsm-Tabs__tab {
  min-block-size: calc(var(--itsm-control-height-md) - 4 * var(--itsm-space-3xs));
  padding-inline: var(--itsm-space-sm);
  border-radius: calc(var(--itsm-radius-lg) - var(--itsm-space-3xs));
}

.itsm-Tabs--segmented .itsm-Tabs__tab:hover:not(:disabled):not([aria-selected="true"]) {
  background-color: var(--itsm-colour-fill-hover);
}

.itsm-Tabs--segmented .itsm-Tabs__tab[aria-selected="true"] {
  background-color: var(--itsm-colour-surface-raised);
  background-image: linear-gradient(
    light-dark(transparent, var(--itsm-colour-fill-pressed)),
    light-dark(transparent, var(--itsm-colour-fill-pressed))
  );
  box-shadow: var(--itsm-elevation-sm), var(--itsm-edge-highlight);
}

/* Edge fades on the rows that scroll: underline and pill (a segmented track is short and tinted). */

${scrollFades('.itsm-Tabs:not(.itsm-Tabs--segmented) > .itsm-Tabs__list')}

${mq.forcedColors} {
  .itsm-Tabs--underline .itsm-Tabs__tab[aria-selected="true"]::after {
    background-color: Highlight;
  }
  .itsm-Tabs--pill .itsm-Tabs__tab[aria-selected="true"],
  .itsm-Tabs--segmented .itsm-Tabs__tab[aria-selected="true"] {
    forced-color-adjust: none;
    background-color: Highlight;
    color: HighlightText;
  }
}

@keyframes itsm-scroll-fades {
  0% {
    mask-position: calc(-1 * var(--_fade)) 0, calc(-1 * var(--_fade)) 0;
  }
  8%,
  92% {
    mask-position: 0 0, calc(-1 * var(--_fade)) 0;
  }
  100% {
    mask-position: 0 0, 0 0;
  }
}
`,
);
