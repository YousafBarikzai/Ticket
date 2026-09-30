import { css, layer, mq } from '../styles/css.js';

/** The flow rules `Prose` and `RichText` share; zero specificity, so an app class adjusts them without a fight. */
const flow = ':where(.itsm-Prose, .itsm-RichText)';

/**
 * `Prose`: reading typography.
 *
 * `md` is the `body` size at a relaxed 1.65 line height (about 15/25), for
 * descriptions and instructions inside the product; `lg` is the article
 * setting the SPEC names, 17/28 (§1.7). Both stop at a 68-character measure,
 * because a line much longer than that is where readers lose their place.
 *
 * The flow rules — spacing between blocks in `em`, so it scales with the
 * text; headings that balance; paragraphs that avoid orphans; underlined
 * links (never colour alone); inline code on the neutral tint, a pair audited
 * for primary text; quotes set back with a rule — apply to `RichText` too,
 * at whatever size it inherits. Paragraph and list spacing come from the
 * owl selector (`* + *`), so the first and last blocks never add space
 * outside the text.
 */
export const proseStyles = layer(
  'components',
  css`
.itsm-Prose {
  max-inline-size: 68ch;
  color: var(--itsm-colour-text-primary);
  font-size: var(--itsm-text-body-size);
  line-height: var(--itsm-line-height-relaxed);
  letter-spacing: var(--itsm-text-body-tracking);
  overflow-wrap: break-word;
}

.itsm-Prose[data-size="lg"] {
  font-size: var(--itsm-font-size-lg);
  letter-spacing: var(--itsm-text-headline-tracking);
}

${flow} > * {
  margin-block: 0;
}

${flow} > * + * {
  margin-block-start: 0.8em;
}

${flow} :where(p, li) {
  text-wrap: pretty;
}

${flow} :where(h2, h3, h4) {
  color: var(--itsm-colour-text-primary);
  font-weight: var(--itsm-font-weight-semibold);
  text-wrap: balance;
}

${flow} > :where(h2, h3, h4) {
  margin-block-start: 1.6em;
}

${flow} > :where(h2, h3, h4) + * {
  margin-block-start: 0.5em;
}

${flow} > :where(h2, h3, h4):first-child {
  margin-block-start: 0;
}

${flow} :where(h2) {
  font-size: var(--itsm-text-title3-size);
  line-height: var(--itsm-text-title3-line);
  letter-spacing: var(--itsm-text-title3-tracking);
}

.itsm-Prose[data-size="lg"] :where(h2) {
  font-size: var(--itsm-text-title2-size);
  line-height: var(--itsm-text-title2-line);
  letter-spacing: var(--itsm-text-title2-tracking);
}

${flow} :where(h3) {
  font-size: var(--itsm-text-headline-size);
  line-height: var(--itsm-text-headline-line);
  letter-spacing: var(--itsm-text-headline-tracking);
}

${flow} :where(h4) {
  font-size: inherit;
  line-height: inherit;
}

${flow} :where(ul, ol) {
  padding-inline-start: 1.4em;
}

${flow} :where(li + li) {
  margin-block-start: 0.35em;
}

${flow} :where(li)::marker {
  color: var(--itsm-colour-text-muted);
}

${flow} :where(a:any-link) {
  color: var(--itsm-colour-text-link);
  text-decoration: underline;
  text-decoration-thickness: from-font;
  text-underline-offset: 0.18em;
}

${flow} :where(a:any-link):hover {
  text-decoration-thickness: var(--itsm-border-thick);
}

${flow} :where(strong, b) {
  font-weight: var(--itsm-font-weight-semibold);
}

${flow} :where(code) {
  padding: 0.1em 0.35em;
  border-radius: var(--itsm-radius-xs);
  background: var(--itsm-colour-neutral-subtle);
  color: var(--itsm-colour-text-primary);
  font-family: var(--itsm-font-family-mono);
  font-size: 0.875em;
}

${flow} :where(pre) {
  overflow-x: auto;
  padding: var(--itsm-space-sm) var(--itsm-space-md);
  border-radius: var(--itsm-radius-lg);
  background: var(--itsm-colour-surface-sunken);
  font-size: 0.875em;
  line-height: var(--itsm-line-height-normal);
}

${flow} :where(pre) :where(code) {
  padding: 0;
  background: none;
  font-size: inherit;
}

${flow} :where(blockquote) {
  margin-inline: 0;
  padding-inline-start: var(--itsm-space-md);
  border-inline-start: var(--itsm-border-thick) solid var(--itsm-colour-border-subtle);
  color: var(--itsm-colour-text-secondary);
}

${flow} :where(hr) {
  margin-block: 1.6em;
  border: 0;
  border-block-start: var(--itsm-hairline) solid var(--itsm-colour-border-subtle);
}

${flow} :where(img, video) {
  max-inline-size: 100%;
  block-size: auto;
  border-radius: var(--itsm-radius-lg);
}

${mq.forcedColors} {
  ${flow} :where(code) {
    border: var(--itsm-hairline) solid CanvasText;
  }
}
`,
);
