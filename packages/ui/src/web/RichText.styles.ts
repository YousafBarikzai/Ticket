import { css, layer } from '../styles/css.js';

/**
 * `RichText`. Its blocks are plain elements, and the flow rules that space
 * and style them are shared with `Prose` (in `display/Prose.styles.ts`), so a
 * document reads the same whether or not it sits in an article. What is its
 * own: it never overflows its column — an authored URL or a long word wraps.
 */
export const richTextStyles = layer(
  'components',
  css`
.itsm-RichText {
  min-inline-size: 0;
  overflow-wrap: break-word;
}
`,
);
