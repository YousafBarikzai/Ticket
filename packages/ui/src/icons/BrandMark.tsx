import { createElement, type HTMLAttributes, type ReactNode } from 'react';
import type { AppName } from '../theme/prefs.js';
import { cx } from '../web/cx.js';
import { brandGlyphs } from './brand.js';
import { iconNodes } from './nodes.js';

export interface BrandMarkProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'title'> {
  /** Which application's glyph to draw; the product's layers when absent. */
  readonly app?: AppName;
  /** Pixel size of the square (28 by default: the sidebar header's). */
  readonly size?: number;
  /** Accessible name. Without it the mark is decorative, which is right beside a visible product name. */
  readonly title?: string;
  readonly className?: string;
}

/**
 * The product mark: a rounded square in the one brand gradient with a white
 * glyph — layers for the product, a cog for admin, the inbox tray for the
 * workbench, the life buoy for the portal (SPEC §1.8). Replaces the three
 * per-app `icon.svg` files; `brandMarkSvg()` draws the same mark as a file.
 *
 * Server-safe, like `Icon`.
 *
 * Drawn with CSS rather than an SVG gradient. An SVG gradient is referenced by
 * id, and the mark appears more than once on a page — the sidebar and the
 * compact top bar both carry it — so the ids would collide, and a browser that
 * resolves the reference to the copy inside a hidden sidebar draws no
 * gradient at all. Generating unique ids would need a hook, which a
 * server-safe component cannot use. A CSS background has neither problem, and
 * it lets the mark follow the theme's accent (brighter in dark mode, deeper in
 * the high-contrast themes) as the rest of the interface does.
 */
export function BrandMark({ app, size = 28, title, className, style, ...rest }: BrandMarkProps): ReactNode {
  const glyph = iconNodes[brandGlyphs[app ?? 'product']];
  return (
    <span
      {...rest}
      className={cx('itsm-BrandMark', className)}
      data-app={app ?? 'product'}
      // Dynamic geometry, which is what inline style is for (SPEC §3.3 rule 6).
      style={{ ...style, inlineSize: size, blockSize: size }}
      {...(title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true })}
    >
      <svg
        className="itsm-BrandMark__glyph"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
        aria-hidden="true"
      >
        {glyph.map(([tag, attributes], index) => createElement(tag, { key: index, ...attributes }))}
      </svg>
    </span>
  );
}
