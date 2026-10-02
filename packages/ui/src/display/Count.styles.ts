import { css, layer, mq } from '../styles/css.js';
import { moreContrast } from './tone.js';

/**
 * `Count`: a pill of `caption` 600 tabular figures (v3 §2.14).
 *
 * `md` is 20 px tall and at least as wide, so "7" is a circle and "99+" a
 * capsule; `sm` is 16 px, for counts inside a tab, a filter pill or a
 * segment. Tabular figures keep a column of counts from jittering as they
 * change. Three tones, each an audited text-on-tint pair: neutral
 * `text.secondary` on `surface.sunken`, accent `brand.subtleText` on
 * `brand.subtle`, danger `danger.subtleText` on `danger.subtle`.
 *
 * A pale tint is exactly what somebody who asked for more contrast cannot
 * see, so there the pill gains a hairline in its intent's border colour; in
 * forced colours it is a plain outlined capsule. On a navy hero
 * (`[data-surface="hero"]`) it becomes an outlined chip in the hero's text
 * colour (v3 §2.5): a tinted pill on navy would be an unaudited pair.
 */
export const countStyles = layer(
  'components',
  css`
.itsm-Count {
  --_itsm-count-bg: var(--itsm-colour-surface-sunken);
  --_itsm-count-text: var(--itsm-colour-text-secondary);
  --_itsm-count-edge: var(--itsm-colour-neutral-border);
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-inline-size: var(--itsm-space-ml);
  block-size: var(--itsm-space-ml);
  padding: 0 calc(var(--itsm-space-2xs) + var(--itsm-space-3xs));
  border-radius: var(--itsm-radius-pill);
  background: var(--_itsm-count-bg);
  color: var(--_itsm-count-text);
  font-family: var(--itsm-font-family-sans);
  font-size: var(--itsm-text-caption-size);
  line-height: 1;
  font-weight: var(--itsm-font-weight-semibold);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0;
  white-space: nowrap;
  vertical-align: middle;
}

.itsm-Count[data-size="sm"] {
  min-inline-size: var(--itsm-space-md);
  block-size: var(--itsm-space-md);
  padding: 0 var(--itsm-space-2xs);
}

.itsm-Count[data-tone="accent"] {
  --_itsm-count-bg: var(--itsm-colour-brand-subtle);
  --_itsm-count-text: var(--itsm-colour-brand-subtleText);
  --_itsm-count-edge: var(--itsm-colour-brand-border);
}

.itsm-Count[data-tone="danger"] {
  --_itsm-count-bg: var(--itsm-colour-danger-subtle);
  --_itsm-count-text: var(--itsm-colour-danger-subtleText);
  --_itsm-count-edge: var(--itsm-colour-danger-border);
}

[data-surface="hero"] .itsm-Count {
  --_itsm-count-bg: transparent;
  --_itsm-count-text: var(--itsm-colour-hero-text);
  --_itsm-count-edge: var(--itsm-colour-hero-lineStrong);
  box-shadow: inset 0 0 0 var(--itsm-hairline) var(--_itsm-count-edge);
}

[data-surface="hero"] .itsm-Count[data-tone="accent"] {
  --_itsm-count-edge: var(--itsm-colour-hero-accent);
}

[data-surface="hero"] .itsm-Count[data-tone="danger"] {
  --_itsm-count-edge: var(--itsm-colour-hero-danger);
}

${moreContrast((scope) => `${scope} .itsm-Count { box-shadow: inset 0 0 0 var(--itsm-hairline) var(--_itsm-count-edge); }`)}

${mq.forcedColors} {
  .itsm-Count {
    border: var(--itsm-hairline) solid CanvasText;
    box-shadow: none;
  }
}
`,
);
