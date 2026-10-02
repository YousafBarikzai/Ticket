import { css, layer, mq } from '../styles/css.js';

/**
 * `SectionHeader` (v3 §2.13, §2.8 section rhythm).
 *
 * One line: the title in `title2` (Jakarta, so it carries the ramp's word
 * spacing), the count, the qualifier in 500 13/18 muted, a hairline that
 * fades from `border.subtle` to nothing across the rest of the line, then the
 * actions. The line wraps rather than squeezing the title: on a phone the
 * actions drop under the title and the hairline keeps a short stub.
 *
 * The rhythm is the PMO's: 32 px above a section, 12 below its header, and
 * 16 above the first one in its container, so the first section sits as
 * close under the toolbar as a card would. The fade runs towards the line's
 * end in either direction of writing.
 */
export const sectionHeaderStyles = layer(
  'components',
  css`
.itsm-SectionHeader {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  column-gap: var(--itsm-space-sm);
  row-gap: var(--itsm-space-xs);
  min-inline-size: 0;
  margin: var(--itsm-space-xl) 0 var(--itsm-space-sm);
}

.itsm-SectionHeader:first-child {
  margin-block-start: var(--itsm-space-md);
}

.itsm-SectionHeader__title {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-xs);
  min-inline-size: 0;
  margin: 0;
  color: var(--itsm-colour-text-primary);
  font-family: var(--itsm-text-title2-family);
  font-size: var(--itsm-text-title2-size);
  line-height: var(--itsm-text-title2-line);
  font-weight: var(--itsm-text-title2-weight);
  letter-spacing: var(--itsm-text-title2-tracking);
  word-spacing: var(--itsm-text-title2-word-spacing);
  text-wrap: balance;
  overflow-wrap: break-word;
}

.itsm-SectionHeader__count {
  flex: none;
}

.itsm-SectionHeader__sub {
  margin: 0;
  color: var(--itsm-colour-text-muted);
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  font-weight: var(--itsm-text-subheadline-weight);
  letter-spacing: var(--itsm-text-subheadline-tracking);
}

.itsm-SectionHeader__rule {
  flex: 1 1 2rem;
  align-self: center;
  min-inline-size: 2rem;
  block-size: var(--itsm-border-hair);
  background: linear-gradient(90deg, var(--itsm-colour-border-subtle), transparent);
}

.itsm-SectionHeader__rule:dir(rtl) {
  background: linear-gradient(270deg, var(--itsm-colour-border-subtle), transparent);
}

.itsm-SectionHeader__actions {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--itsm-space-xs);
}

${mq.forcedColors} {
  .itsm-SectionHeader__rule {
    background: CanvasText;
  }
}
`,
);
