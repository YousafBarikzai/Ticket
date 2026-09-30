import { css, layer } from '../styles/css.js';

/**
 * `RelativeTime`: figures of equal width, so "9 min ago" becoming "10 min ago"
 * does not nudge the text after it, and never broken across lines — half a
 * timestamp at the end of a line reads as two facts.
 */
export const relativeTimeStyles = layer(
  'components',
  css`
.itsm-RelativeTime {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
`,
);
