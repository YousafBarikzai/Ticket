import { moreContrast } from '../feedback/tone.js';
import { css, layer, mq } from '../styles/css.js';

/**
 * `FormErrorSummary`: the danger tint behind primary text, the circle-alert
 * in the danger text colour (an icon as well as a colour, SPEC §1.1), a
 * `headline` title and the problems as underlined links in the danger text
 * colour — every pair audited (subtleText and primary on the danger tint).
 *
 * It takes focus when it appears, so it draws the two-tone focus ring the
 * base layer gives any focused element with a visible indicator; programmatic
 * focus after a mouse click shows none, as `:focus-visible` decides. An
 * outline in the danger border colour is added where the person asked for
 * more contrast, since a pale tint is what they cannot see.
 */
export const formErrorSummaryStyles = layer(
  'components',
  css`
.itsm-FormErrorSummary {
  display: flex;
  align-items: flex-start;
  gap: var(--itsm-space-sm);
  padding: var(--itsm-space-md);
  border-radius: var(--itsm-radius-xl);
  background: var(--itsm-colour-danger-subtle);
  color: var(--itsm-colour-text-primary);
  scroll-margin-block: var(--itsm-space-xl);
}

.itsm-FormErrorSummary__icon {
  flex: none;
  margin-block: calc((var(--itsm-text-headline-line) - var(--itsm-icon-md)) / 2);
  color: var(--itsm-colour-danger-subtleText);
}

.itsm-FormErrorSummary__body {
  flex: 1;
  min-inline-size: 0;
  overflow-wrap: anywhere;
}

.itsm-FormErrorSummary__title {
  margin: 0;
  font-size: var(--itsm-text-headline-size);
  line-height: var(--itsm-text-headline-line);
  letter-spacing: var(--itsm-text-headline-tracking);
  font-weight: var(--itsm-text-headline-weight);
}

.itsm-FormErrorSummary__description {
  margin-block-start: var(--itsm-space-3xs);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
  color: var(--itsm-colour-text-secondary);
}

.itsm-FormErrorSummary__description > :where(p) {
  margin: 0;
}

.itsm-FormErrorSummary__list {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-2xs);
  margin: var(--itsm-space-xs) 0 0;
  padding: 0;
  list-style: none;
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
}

.itsm-FormErrorSummary__link {
  color: var(--itsm-colour-danger-subtleText);
  font-weight: var(--itsm-font-weight-medium);
  text-decoration: underline;
  text-decoration-thickness: var(--itsm-hairline);
  text-underline-offset: 0.2em;
  border-radius: var(--itsm-radius-xs);
}

.itsm-FormErrorSummary__link:hover {
  text-decoration-thickness: var(--itsm-border-thick);
}

${moreContrast((scope) => `${scope} .itsm-FormErrorSummary { box-shadow: inset 0 0 0 var(--itsm-border-thick) var(--itsm-colour-danger-border); }`)}

${mq.forcedColors} {
  .itsm-FormErrorSummary {
    border: var(--itsm-border-thick) solid CanvasText;
  }
  .itsm-FormErrorSummary__icon {
    color: CanvasText;
  }
  .itsm-FormErrorSummary__link {
    color: LinkText;
  }
}
`,
);
