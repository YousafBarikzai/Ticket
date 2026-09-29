import type { ReactNode } from 'react';
import type { AppName } from '../theme/prefs.js';
import { cx } from '../web/cx.js';

export interface BrandMarkProps {
  /** Which application's glyph to draw; the product mark when absent. */
  readonly app?: AppName;
  /** Pixel size of the square. */
  readonly size?: number;
  /** Accessible name. Without it the mark is decorative, which is right beside a visible product name. */
  readonly title?: string;
  readonly className?: string;
}

/**
 * The product mark: a squircle with the one brand gradient and a white glyph
 * per application. Replaces the three per-app `icon.svg` files.
 *
 * Server-safe, like `Icon`.
 *
 * Stub (SPEC §1.8, §4.1): renders the sized, labelled `<svg>` frame; the
 * foundations package draws the squircle and glyphs.
 */
export function BrandMark({ app, size = 28, title, className }: BrandMarkProps): ReactNode {
  return (
    <svg
      className={cx('itsm-BrandMark', className)}
      data-app={app}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      focusable="false"
      {...(title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true })}
    />
  );
}
