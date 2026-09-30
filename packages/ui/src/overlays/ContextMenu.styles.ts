import { css, layer } from '../styles/css.js';

/**
 * `ContextMenu`. Deliberately almost nothing: a context menu is a `Menu`
 * opened at the pointer, and draws with `Menu`'s classes so the two cannot
 * drift apart. What is its own is where it grows from: the pointer, which
 * Radix reports as the transform origin. (Radix also turns the iOS callout
 * off on the region itself, so a long-press opens this menu, not the
 * system's.)
 */
export const contextMenuStyles = layer(
  'components',
  css`
.itsm-ContextMenu {
  transform-origin: var(--radix-context-menu-content-transform-origin, top left);
}
`,
);
