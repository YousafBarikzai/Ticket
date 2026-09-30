import { css, layer, mq } from '../styles/css.js';

/**
 * `PageHeader`, in the patterns layer (it composes buttons, breadcrumbs and
 * route tabs).
 *
 * The title is `title1` (28/34, bold, tight tracking) — `largeTitle` for hub
 * pages — balanced across lines, and takes programmatic focus without a
 * ring. Beside it, at most one companion and the *View only* pill; at the
 * end, secondaries, the one primary, then ⋯. Below 768 px the secondaries
 * fold into ⋯ and the actions wrap under the title. The subtitle is `body`
 * in `text.secondary`, 60 characters wide at most.
 *
 * `sticky` pins the header under the frame's top bar, opaque on the page
 * colour, with a hairline and the `md` elevation once it is resting there.
 */
export const pageHeaderStyles = layer(
  'patterns',
  css`
.itsm-PageHeader {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-xs);
  margin-block-end: var(--itsm-space-lg);
  container-type: inline-size;
}
.itsm-PageHeader[data-has-tabs] {
  gap: var(--itsm-space-sm);
}
.itsm-PageHeader[data-sticky] {
  position: sticky;
  inset-block-start: var(--_sticky-top, 0px);
  z-index: var(--itsm-z-sticky);
  margin-inline: calc(-1 * var(--itsm-page-gutter));
  padding: var(--itsm-space-sm) var(--itsm-page-gutter) var(--itsm-space-xs);
  background: var(--itsm-colour-surface-raised);
  transition: box-shadow var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-AppShell[data-variant="topnav"] .itsm-PageHeader[data-sticky] {
  background: var(--itsm-colour-surface-canvas);
}
.itsm-PageHeader[data-stuck] {
  box-shadow: 0 var(--itsm-hairline) 0 var(--itsm-colour-border-subtle), var(--itsm-elevation-md);
}
.itsm-PageHeader__sentinel {
  block-size: var(--itsm-hairline);
  margin-block-end: calc(-1 * var(--itsm-hairline));
}

.itsm-PageHeader__back {
  display: inline-flex;
  align-self: flex-start;
  align-items: center;
  gap: var(--itsm-space-3xs);
  margin-inline-start: calc(-1 * var(--itsm-space-2xs));
  padding: var(--itsm-space-3xs) var(--itsm-space-2xs);
  border-radius: var(--itsm-radius-md);
  color: var(--itsm-colour-text-link);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  font-weight: var(--itsm-font-weight-medium);
  text-decoration: none;
}
.itsm-PageHeader__back:hover {
  background: var(--itsm-colour-fill-hover);
}

.itsm-PageHeader__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--itsm-space-sm) var(--itsm-space-md);
}
.itsm-PageHeader__heading {
  display: flex;
  flex: 1 1 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--itsm-space-2xs) var(--itsm-space-sm);
  min-inline-size: 0;
}
.itsm-PageHeader__title {
  margin: 0;
  min-inline-size: 0;
  color: var(--itsm-colour-text-primary);
  font-size: var(--itsm-text-title1-size);
  line-height: var(--itsm-text-title1-line);
  font-weight: var(--itsm-text-title1-weight);
  letter-spacing: var(--itsm-text-title1-tracking);
  overflow-wrap: anywhere;
  text-wrap: balance;
}
.itsm-PageHeader__title:focus {
  outline: none;
  box-shadow: none;
}
.itsm-PageHeader[data-large] .itsm-PageHeader__title {
  font-size: var(--itsm-text-largeTitle-size);
  line-height: var(--itsm-text-largeTitle-line);
  font-weight: var(--itsm-text-largeTitle-weight);
  letter-spacing: var(--itsm-text-largeTitle-tracking);
}
.itsm-PageHeader__companion {
  display: inline-flex;
  align-items: center;
}
.itsm-PageHeader__meta {
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  font-weight: var(--itsm-font-weight-regular);
}

.itsm-PageHeader__viewOnly {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-2xs);
  block-size: var(--itsm-control-height-sm);
  margin: 0;
  padding: 0 var(--itsm-space-sm);
  border: 0;
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-neutral-subtle);
  color: var(--itsm-colour-neutral-subtleText);
  font: inherit;
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  font-weight: var(--itsm-font-weight-medium);
  cursor: pointer;
  transition: background-color var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-PageHeader__viewOnly:hover,
.itsm-PageHeader__viewOnly[aria-expanded="true"] {
  background-image: linear-gradient(var(--itsm-colour-fill-hover), var(--itsm-colour-fill-hover));
}
.itsm-PageHeader__viewOnlyText {
  margin: 0;
  color: var(--itsm-colour-text-primary);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
}
.itsm-PageHeader__viewOnlyKey {
  display: flex;
  align-items: center;
  gap: var(--itsm-space-xs);
  margin-block-start: var(--itsm-space-sm);
}
.itsm-PageHeader__viewOnlyKey > code {
  flex: 1 1 auto;
  min-inline-size: 0;
  overflow: hidden;
  padding: var(--itsm-space-3xs) var(--itsm-space-2xs);
  border-radius: var(--itsm-radius-sm);
  background: var(--itsm-colour-surface-sunken);
  color: var(--itsm-colour-text-primary);
  font-family: var(--itsm-font-family-mono);
  font-size: var(--itsm-text-footnote-size);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.itsm-PageHeader__actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--itsm-space-xs);
  margin-inline-start: auto;
}
.itsm-PageHeader__overflow {
  display: inline-flex;
}
.itsm-PageHeader__more {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  inline-size: var(--itsm-control-height-md);
  block-size: var(--itsm-control-height-md);
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: var(--itsm-radius-lg);
  background-color: var(--itsm-colour-fill-secondary);
  color: var(--itsm-colour-text-primary);
  box-shadow: var(--itsm-elevation-xs);
  cursor: pointer;
  transition: background-color var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-PageHeader__more:focus-visible {
  box-shadow: 0 0 0 var(--itsm-focus-offset) var(--itsm-colour-focusGap), var(--itsm-elevation-xs);
}
.itsm-PageHeader__more:hover,
.itsm-PageHeader__more[aria-expanded="true"] {
  background-image: linear-gradient(var(--itsm-colour-fill-hover), var(--itsm-colour-fill-hover));
}
.itsm-PageHeader__more:active {
  background-image: linear-gradient(var(--itsm-colour-fill-pressed), var(--itsm-colour-fill-pressed));
}

.itsm-PageHeader__subtitle {
  max-inline-size: 60ch;
  margin: 0;
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-body-size);
  line-height: var(--itsm-text-body-line);
  letter-spacing: var(--itsm-text-body-tracking);
  text-wrap: pretty;
}

${mq.belowMd} {
  .itsm-PageHeader__secondary {
    display: none;
  }
  .itsm-PageHeader__title {
    font-size: var(--itsm-text-title2-size);
    line-height: var(--itsm-text-title2-line);
    letter-spacing: var(--itsm-text-title2-tracking);
  }
  .itsm-PageHeader[data-large] .itsm-PageHeader__title {
    font-size: var(--itsm-text-title1-size);
    line-height: var(--itsm-text-title1-line);
  }
}

${mq.forcedColors} {
  .itsm-PageHeader__viewOnly,
  .itsm-PageHeader__more {
    border: var(--itsm-hairline) solid ButtonText;
  }
}
`,
);
