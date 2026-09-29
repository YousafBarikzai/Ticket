import type { ReactNode } from 'react';
import { cx } from './cx.js';

export interface KbdProps {
  /** A shortcut in the hotkey notation: `mod+k`, `g m`, `?`, `shift+j`. */
  readonly keys: string;
  readonly size?: 'sm' | 'md';
  readonly className?: string;
}

/**
 * A keyboard shortcut, drawn as key caps.
 *
 * Server-safe, and deliberately free of platform detection: it renders both
 * the Apple and the non-Apple glyph sets and the stylesheet shows one through
 * `[data-itsm-os]`, which the pre-paint script sets. Reading the platform here
 * instead would render "Ctrl" on the server and "⌘" in the browser, a
 * hydration mismatch on every page with a shortcut hint.
 *
 * Stub (SPEC §4.1): renders the notation as written; the foundations package
 * adds the glyph sets and the spoken text ("Command K").
 */
export function Kbd({ keys, size = 'md', className }: KbdProps): ReactNode {
  return (
    <kbd className={cx('itsm-Kbd', className)} data-size={size}>
      {keys}
    </kbd>
  );
}
