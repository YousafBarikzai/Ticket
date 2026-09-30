import { moreContrast, toneVariables } from '../display/tone.js';
import { css, layer, mq } from '../styles/css.js';

const thread = '.itsm-Timeline[data-variant="thread"]';
const conversation = '.itsm-Timeline[data-variant="conversation"]';

/**
 * `Timeline`, in two variants.
 *
 * **Thread** (the history view): a column of 24 px markers joined by a
 * hairline rail — a person's avatar for their messages, a round glyph for
 * everything else, tinted by tone — beside a meta line (actor in primary
 * semibold, what happened in secondary, the time muted) and the body. An
 * internal note's body sits on the warning tint with a bar at its start, the
 * words "Internal note" and a lock beside it: three signals, none of them
 * only colour (X-68).
 *
 * **Conversation**: messages as bubbles in `body` type, at most 40 rem wide,
 * with the corner nearest the author tucked in. Surfaces are the audited
 * opaque ones the SPEC prescribes — `surface.bubble` for the reader's own
 * messages in the portal, raised with a hairline for the requester, sunken
 * for agents' replies, the warning tint for internal notes — and never blue
 * (X-73). The sender line is `footnote`; a continuation from the same author
 * tucks up under the message before it with no repeated name. Events are
 * quiet centred lines between messages, and day headings are centred between
 * hairlines, the way a messaging app draws them.
 *
 * "3 updates by Jo" is a ghost button whose chevron turns as it opens;
 * "New since your last visit" is a heading on an accent rule, the one place
 * the accent marks something that is not a control — it marks *your* place,
 * as a selection does.
 */
export const timelineStyles = layer(
  'components',
  css`
${toneVariables('.itsm-Timeline__glyph')}

.itsm-Timeline {
  --_itsm-tl-marker: 1.5rem;
  display: grid;
  gap: var(--itsm-space-sm);
  min-inline-size: 0;
  color: var(--itsm-colour-text-primary);
}

.itsm-Timeline__list,
.itsm-Timeline__entries,
.itsm-Timeline__runList {
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
  min-inline-size: 0;
}

.itsm-Timeline[data-grouped] > .itsm-Timeline__list {
  gap: var(--itsm-space-lg);
}

.itsm-Timeline__day {
  display: grid;
  gap: var(--itsm-space-sm);
  min-inline-size: 0;
}

.itsm-Timeline__dayHeading {
  margin: 0;
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  letter-spacing: var(--itsm-text-subheadline-tracking);
  font-weight: var(--itsm-text-subheadline-weight);
}

.itsm-Timeline__empty {
  margin: 0;
  padding: var(--itsm-space-lg) var(--itsm-space-md);
  color: var(--itsm-colour-text-muted);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  text-align: center;
}

/* Shared inline parts. */
.itsm-Timeline__actor {
  color: var(--itsm-colour-text-primary);
  font-weight: var(--itsm-font-weight-semibold);
}

.itsm-Timeline__time,
.itsm-Timeline__extra {
  color: var(--itsm-colour-text-muted);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  letter-spacing: var(--itsm-text-footnote-tracking);
  font-variant-numeric: tabular-nums;
}

.itsm-Timeline__dot {
  color: var(--itsm-colour-text-muted);
}

.itsm-Timeline__channel {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-3xs);
  color: var(--itsm-colour-text-muted);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
}

.itsm-Timeline__change {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--itsm-space-2xs);
  vertical-align: bottom;
}

.itsm-Timeline__value {
  padding-inline: calc(var(--itsm-space-2xs) + var(--itsm-space-3xs));
  border-radius: var(--itsm-radius-sm);
  background: var(--itsm-colour-neutral-subtle);
  color: var(--itsm-colour-text-primary);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  font-weight: var(--itsm-font-weight-medium);
}

.itsm-Timeline__arrow {
  color: var(--itsm-colour-text-muted);
}

.itsm-Timeline__attachments {
  display: flex;
  flex-wrap: wrap;
  gap: var(--itsm-space-xs);
  margin: var(--itsm-space-2xs) 0 0;
  padding: 0;
  list-style: none;
}

/* ---------------------------------------------------------------- Thread */

${thread} .itsm-Timeline__item {
  position: relative;
  padding-block-end: var(--itsm-space-md);
}

${thread} .itsm-Timeline__item:last-child {
  padding-block-end: 0;
}

${thread} .itsm-Timeline__item:not(:last-child)::before {
  content: '';
  position: absolute;
  inset-block: calc(var(--_itsm-tl-marker) + var(--itsm-space-2xs)) var(--itsm-space-2xs);
  inset-inline-start: calc(var(--_itsm-tl-marker) / 2 - var(--itsm-hairline));
  inline-size: var(--itsm-border-thick);
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-border-subtle);
}

${thread} .itsm-Timeline__entry {
  display: grid;
  grid-template-columns: var(--_itsm-tl-marker) minmax(0, 1fr);
  column-gap: var(--itsm-space-sm);
}

.itsm-Timeline__marker {
  display: grid;
  place-items: center;
  flex: none;
  inline-size: var(--_itsm-tl-marker);
  block-size: var(--_itsm-tl-marker);
}

.itsm-Timeline__glyph {
  display: grid;
  place-items: center;
  inline-size: var(--_itsm-tl-marker);
  block-size: var(--_itsm-tl-marker);
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-surface-sunken);
  box-shadow: inset 0 0 0 var(--itsm-hairline) var(--itsm-colour-border-subtle);
  color: var(--itsm-colour-text-secondary);
}

.itsm-Timeline__glyph[data-tone] {
  background: var(--_itsm-tone-subtle);
  box-shadow: none;
  color: var(--_itsm-tone-text);
}

${thread} .itsm-Timeline__content {
  display: grid;
  gap: var(--itsm-space-2xs);
  min-inline-size: 0;
  padding-block-start: calc((var(--_itsm-tl-marker) - var(--itsm-text-callout-line)) / 2);
}

${thread} .itsm-Timeline__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  column-gap: var(--itsm-space-xs);
  row-gap: var(--itsm-space-3xs);
  margin: 0;
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
  overflow-wrap: anywhere;
}

${thread} .itsm-Timeline__body {
  color: var(--itsm-colour-text-primary);
  font-size: var(--itsm-text-body-size);
  line-height: var(--itsm-text-body-line);
  letter-spacing: var(--itsm-text-body-tracking);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

${thread} .itsm-Timeline__body--internal {
  padding: var(--itsm-space-xs) var(--itsm-space-sm);
  border-radius: var(--itsm-radius-lg);
  background: var(--itsm-colour-warning-subtle);
  box-shadow: inset calc(var(--itsm-border-thick) + 1px) 0 0 0 var(--itsm-colour-warning-border);
}

${thread} .itsm-Timeline__body--internal:dir(rtl) {
  box-shadow: inset calc(-1 * (var(--itsm-border-thick) + 1px)) 0 0 0 var(--itsm-colour-warning-border);
}

/* ---------------------------------------------------------- Conversation */

${conversation} .itsm-Timeline__entries {
  gap: var(--itsm-space-md);
}

${conversation} .itsm-Timeline__dayHeading {
  display: flex;
  align-items: center;
  gap: var(--itsm-space-sm);
  color: var(--itsm-colour-text-muted);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  letter-spacing: var(--itsm-text-footnote-tracking);
  font-weight: var(--itsm-font-weight-medium);
  text-align: center;
}

${conversation} .itsm-Timeline__dayHeading::before,
${conversation} .itsm-Timeline__dayHeading::after {
  content: '';
  flex: 1;
  border-block-start: var(--itsm-hairline) solid var(--itsm-colour-border-subtle);
}

${conversation} .itsm-Timeline__item {
  display: flex;
  min-inline-size: 0;
}

${conversation} .itsm-Timeline__item[data-side="end"] {
  justify-content: flex-end;
}

${conversation} .itsm-Timeline__item[data-side="center"] {
  justify-content: center;
}

${conversation} .itsm-Timeline__item[data-continued] {
  margin-block-start: calc(var(--itsm-space-3xs) - var(--itsm-space-md));
}

/*
 * A message never spans the pane: the far side keeps a gutter, so whose
 * side a bubble is on reads at a glance even on a phone.
 */
.itsm-Timeline__message {
  display: flex;
  align-items: flex-start;
  gap: var(--itsm-space-xs);
  min-inline-size: 0;
  max-inline-size: min(85%, 40rem);
}

/* Level with the top of the bubble, below the sender line, however many attachments follow. */
.itsm-Timeline__avatar {
  flex: none;
  inline-size: var(--_itsm-tl-marker);
  margin-block-start: calc(var(--itsm-text-footnote-line) + var(--itsm-space-2xs));
}

.itsm-Timeline__item[data-continued] .itsm-Timeline__avatar {
  margin-block-start: 0;
}

.itsm-Timeline__stack {
  display: grid;
  justify-items: start;
  gap: var(--itsm-space-2xs);
  min-inline-size: 0;
}

.itsm-Timeline__item[data-side="end"] .itsm-Timeline__stack {
  justify-items: end;
}

.itsm-Timeline__sender {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--itsm-space-3xs) var(--itsm-space-xs);
  margin: 0;
  padding-inline: var(--itsm-space-sm);
  color: var(--itsm-colour-text-muted);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  letter-spacing: var(--itsm-text-footnote-tracking);
}

.itsm-Timeline__sender .itsm-Timeline__actor {
  color: var(--itsm-colour-text-secondary);
}

.itsm-Timeline__bubble {
  box-sizing: border-box;
  max-inline-size: 100%;
  padding: calc(var(--itsm-space-xs) + var(--itsm-space-3xs)) var(--itsm-space-sm);
  border-radius: var(--itsm-radius-xl);
  background: var(--itsm-colour-surface-raised);
  color: var(--itsm-colour-text-primary);
  font-size: var(--itsm-text-body-size);
  line-height: var(--itsm-text-body-line);
  letter-spacing: var(--itsm-text-body-tracking);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.itsm-Timeline__item[data-side="start"] .itsm-Timeline__bubble {
  border-end-start-radius: var(--itsm-radius-xs);
}

.itsm-Timeline__item[data-side="end"] .itsm-Timeline__bubble {
  border-end-end-radius: var(--itsm-radius-xs);
}

.itsm-Timeline__bubble[data-surface="bubble"] {
  background: var(--itsm-colour-surface-bubble);
}

.itsm-Timeline__bubble[data-surface="raised"] {
  background: var(--itsm-colour-surface-raised);
  box-shadow: inset 0 0 0 var(--itsm-hairline) var(--itsm-colour-border-subtle), var(--itsm-edge-highlight);
}

.itsm-Timeline__bubble[data-surface="sunken"] {
  background: var(--itsm-colour-surface-sunken);
}

.itsm-Timeline__bubble[data-surface="internal"] {
  background: var(--itsm-colour-warning-subtle);
  box-shadow: inset 0 0 0 var(--itsm-hairline) var(--itsm-colour-warning-border);
}

.itsm-Timeline__notice {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: var(--itsm-space-3xs) var(--itsm-space-xs);
  max-inline-size: min(100%, 36rem);
  color: var(--itsm-colour-text-muted);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  letter-spacing: var(--itsm-text-footnote-tracking);
  text-align: center;
  overflow-wrap: anywhere;
}

.itsm-Timeline__noticeText .itsm-Timeline__actor {
  color: var(--itsm-colour-text-secondary);
}

.itsm-Timeline__noticeDetail {
  display: block;
  color: var(--itsm-colour-text-secondary);
}

/* ------------------------------------------------------ Runs and "new" */

.itsm-Timeline__runHeader {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--itsm-space-2xs) var(--itsm-space-xs);
}

${thread} .itsm-Timeline__runHeader {
  column-gap: var(--itsm-space-sm);
}

${conversation} .itsm-Timeline__run {
  flex-direction: column;
  align-items: center;
}

.itsm-Timeline__runToggle {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-2xs);
  min-block-size: var(--itsm-control-height-sm);
  margin-inline: calc(-1 * var(--itsm-space-2xs));
  padding-inline: var(--itsm-space-2xs) var(--itsm-space-xs);
  border: 0;
  border-radius: var(--itsm-radius-md);
  background: transparent;
  color: var(--itsm-colour-text-secondary);
  font: inherit;
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  font-weight: var(--itsm-font-weight-medium);
  cursor: pointer;
  transition: background-color var(--itsm-duration-fast) var(--itsm-easing-standard);
}

${conversation} .itsm-Timeline__runToggle {
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
}

.itsm-Timeline__runToggle:hover {
  background: var(--itsm-colour-fill-hover);
}

.itsm-Timeline__runToggle:active {
  background: var(--itsm-colour-fill-pressed);
}

.itsm-Timeline__runChevron {
  color: var(--itsm-colour-text-muted);
  transition: transform var(--itsm-duration-normal) var(--itsm-easing-emphasised);
}

.itsm-Timeline__runToggle[aria-expanded="true"] .itsm-Timeline__runChevron {
  transform: rotate(90deg);
}

${thread} .itsm-Timeline__runList {
  padding-block-start: var(--itsm-space-md);
}

${conversation} .itsm-Timeline__runList {
  gap: var(--itsm-space-xs);
  padding-block-start: var(--itsm-space-xs);
}

.itsm-Timeline__new {
  display: block;
}

${thread} .itsm-Timeline__new {
  padding-block-end: var(--itsm-space-md);
}

.itsm-Timeline__newHeading {
  display: flex;
  align-items: center;
  gap: var(--itsm-space-sm);
  margin: 0;
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  letter-spacing: var(--itsm-text-footnote-tracking);
  font-weight: var(--itsm-font-weight-semibold);
  scroll-margin-block: var(--itsm-space-2xl);
}

.itsm-Timeline__newHeading::after {
  content: '';
  flex: 1;
  border-block-start: var(--itsm-border-thick) solid var(--itsm-colour-accent);
  border-radius: var(--itsm-radius-pill);
}

${conversation} .itsm-Timeline__newHeading::before {
  content: '';
  flex: 1;
  border-block-start: var(--itsm-border-thick) solid var(--itsm-colour-accent);
  border-radius: var(--itsm-radius-pill);
}

.itsm-Timeline__jump {
  display: inline-flex;
  align-items: center;
  justify-self: start;
  gap: var(--itsm-space-2xs);
  min-block-size: var(--itsm-control-height-sm);
  padding-inline: var(--itsm-space-sm);
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-brand-subtle);
  color: var(--itsm-colour-brand-subtleText);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  font-weight: var(--itsm-font-weight-semibold);
  text-decoration: none;
  transition: box-shadow var(--itsm-duration-fast) var(--itsm-easing-standard);
}

${conversation} .itsm-Timeline__jump {
  justify-self: center;
}

.itsm-Timeline__jump:hover {
  box-shadow: inset 0 0 0 var(--itsm-hairline) var(--itsm-colour-brand-border);
}

.itsm-Timeline__jump:focus-visible {
  box-shadow: 0 0 0 var(--itsm-focus-offset) var(--itsm-colour-focusGap);
}

${moreContrast(
  (scope) => `${scope} .itsm-Timeline__bubble { box-shadow: inset 0 0 0 var(--itsm-hairline) var(--itsm-colour-border-strong); }
${scope} .itsm-Timeline__body--internal { box-shadow: inset 0 0 0 var(--itsm-hairline) var(--itsm-colour-warning-border); }`,
)}

${mq.forcedColors} {
  .itsm-Timeline__bubble,
  .itsm-Timeline__glyph,
  .itsm-Timeline__value,
  .itsm-Timeline__body--internal {
    border: var(--itsm-hairline) solid CanvasText;
  }
  .itsm-Timeline__bubble[data-surface="internal"],
  .itsm-Timeline__body--internal {
    border-style: dashed;
  }
  .itsm-Timeline__newHeading::before,
  .itsm-Timeline__newHeading::after {
    border-color: Highlight;
  }
  ${thread} .itsm-Timeline__item:not(:last-child)::before {
    background: GrayText;
  }
}
`,
);
