import { css, layer, mq } from '../styles/css.js';
import { toneVariables } from './tone.js';

/**
 * `ActivityFeed`: day headings in `subheadline`, then a column of markers
 * joined by a hairline rail beside a column of sentences.
 *
 * The sentence is `callout` in `text.secondary` with the actor and object in
 * `text.primary` — the nouns carry the weight, the verb recedes. Links inside
 * it are underlined, never told apart by colour alone. A change's values are
 * small neutral chips (primary text on the neutral tint, an audited pair)
 * either side of an arrow. The meta line is `footnote`, muted.
 *
 * Markers are 24 px: a person's avatar, or a round glyph on the sunken
 * surface, tinted by the item's tone when it has one (the intent's
 * `subtleText` on its tint). The rail runs from under one marker to the top
 * of the next.
 *
 * "3 new · Show" is a tinted capsule button — blue, because it is the one
 * control here — centred above the list; the list itself never moves until
 * it is pressed.
 */
export const activityFeedStyles = layer(
  'components',
  css`
${toneVariables('.itsm-ActivityFeed__item')}

.itsm-ActivityFeed {
  --_itsm-feed-marker: 1.5rem;
  display: grid;
  gap: var(--itsm-space-sm);
  min-inline-size: 0;
}

.itsm-ActivityFeed__list,
.itsm-ActivityFeed__items {
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
}

.itsm-ActivityFeed__list {
  gap: var(--itsm-space-lg);
  border-radius: var(--itsm-radius-md);
}

.itsm-ActivityFeed:not([data-grouped]) .itsm-ActivityFeed__list {
  gap: 0;
}

.itsm-ActivityFeed__day {
  display: grid;
  gap: var(--itsm-space-sm);
}

.itsm-ActivityFeed__dayHeading {
  margin: 0;
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  letter-spacing: var(--itsm-text-subheadline-tracking);
  font-weight: var(--itsm-text-subheadline-weight);
}

.itsm-ActivityFeed__item {
  position: relative;
  display: grid;
  grid-template-columns: var(--_itsm-feed-marker) minmax(0, 1fr);
  column-gap: var(--itsm-space-sm);
  padding-block-end: var(--itsm-space-md);
}

.itsm-ActivityFeed__item:last-child {
  padding-block-end: 0;
}

.itsm-ActivityFeed__item:not(:last-child)::before {
  content: '';
  position: absolute;
  inset-block: calc(var(--_itsm-feed-marker) + var(--itsm-space-2xs)) var(--itsm-space-2xs);
  inset-inline-start: calc(var(--_itsm-feed-marker) / 2 - var(--itsm-hairline));
  inline-size: var(--itsm-border-thick);
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-border-subtle);
}

.itsm-ActivityFeed__marker {
  display: grid;
  place-items: center;
  inline-size: var(--_itsm-feed-marker);
  block-size: var(--_itsm-feed-marker);
}

.itsm-ActivityFeed__glyph {
  display: grid;
  place-items: center;
  inline-size: var(--_itsm-feed-marker);
  block-size: var(--_itsm-feed-marker);
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-surface-sunken);
  box-shadow: inset 0 0 0 var(--itsm-hairline) var(--itsm-colour-border-subtle);
  color: var(--itsm-colour-text-secondary);
}

.itsm-ActivityFeed__item[data-tone] .itsm-ActivityFeed__glyph {
  background: var(--_itsm-tone-subtle);
  box-shadow: none;
  color: var(--_itsm-tone-text);
}

.itsm-ActivityFeed__content {
  display: grid;
  gap: var(--itsm-space-3xs);
  min-inline-size: 0;
  padding-block-start: calc((var(--_itsm-feed-marker) - var(--itsm-text-callout-line)) / 2);
}

.itsm-ActivityFeed__sentence {
  margin: 0;
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
  overflow-wrap: anywhere;
}

.itsm-ActivityFeed__actor {
  color: var(--itsm-colour-text-primary);
  font-weight: var(--itsm-font-weight-semibold);
}

.itsm-ActivityFeed__object {
  color: var(--itsm-colour-text-primary);
  font-weight: var(--itsm-font-weight-medium);
}

a.itsm-ActivityFeed__object {
  color: var(--itsm-colour-text-link);
  text-decoration: underline;
  text-decoration-thickness: from-font;
  text-underline-offset: 0.18em;
}

a.itsm-ActivityFeed__object:hover {
  text-decoration-thickness: var(--itsm-border-thick);
}

.itsm-ActivityFeed__change {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--itsm-space-2xs);
  vertical-align: bottom;
}

.itsm-ActivityFeed__value {
  padding-inline: calc(var(--itsm-space-2xs) + var(--itsm-space-3xs));
  border-radius: var(--itsm-radius-sm);
  background: var(--itsm-colour-neutral-subtle);
  color: var(--itsm-colour-text-primary);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  font-weight: var(--itsm-font-weight-medium);
}

.itsm-ActivityFeed__arrow {
  color: var(--itsm-colour-text-muted);
}

.itsm-ActivityFeed__detail {
  margin: var(--itsm-space-3xs) 0 0;
  padding-inline-start: var(--itsm-space-sm);
  border-inline-start: var(--itsm-border-thick) solid var(--itsm-colour-border-subtle);
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  overflow-wrap: anywhere;
  text-wrap: pretty;
}

.itsm-ActivityFeed__meta {
  margin: 0;
  color: var(--itsm-colour-text-muted);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  letter-spacing: var(--itsm-text-footnote-tracking);
  font-variant-numeric: tabular-nums;
}

.itsm-ActivityFeed__channel {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-3xs);
  vertical-align: bottom;
}

.itsm-ActivityFeed__new {
  display: flex;
  justify-content: center;
}

.itsm-ActivityFeed__show {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-2xs);
  min-block-size: var(--itsm-control-height-sm);
  padding-inline: var(--itsm-space-sm);
  border: 0;
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-brand-subtle);
  box-shadow: var(--itsm-elevation-sm);
  color: var(--itsm-colour-brand-subtleText);
  font: inherit;
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  font-weight: var(--itsm-font-weight-semibold);
  cursor: pointer;
  transition: box-shadow var(--itsm-duration-fast) var(--itsm-easing-standard);
}

.itsm-ActivityFeed__show:hover {
  box-shadow: var(--itsm-elevation-sm), inset 0 0 0 var(--itsm-hairline) var(--itsm-colour-brand-border);
}

.itsm-ActivityFeed__show:active {
  box-shadow: inset 0 0 0 var(--itsm-border-thick) var(--itsm-colour-brand-border);
}

.itsm-ActivityFeed__show:focus-visible {
  box-shadow: 0 0 0 var(--itsm-focus-offset) var(--itsm-colour-focusGap), var(--itsm-elevation-sm);
}

.itsm-ActivityFeed__all {
  margin: 0;
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
}

.itsm-ActivityFeed__allLink {
  color: var(--itsm-colour-text-link);
  font-weight: var(--itsm-font-weight-medium);
  text-decoration: none;
}

.itsm-ActivityFeed__allLink:hover {
  text-decoration: underline;
  text-underline-offset: 0.18em;
}

${mq.forcedColors} {
  .itsm-ActivityFeed__glyph,
  .itsm-ActivityFeed__value,
  .itsm-ActivityFeed__show {
    border: var(--itsm-hairline) solid CanvasText;
  }
  .itsm-ActivityFeed__item:not(:last-child)::before {
    background: GrayText;
  }
}
`,
);
