'use client';

import type { ReactNode } from 'react';
import { BrandMark } from '../icons/BrandMark.js';
import { cx } from '../web/cx.js';
import { ShellLink } from './ShellLink.js';
import type { ShellBrand } from './nav.js';

/** `PRODUCT_NAME` in `@itsm/contracts/areas` (D1), for a bar drawn outside a frame. */
const PRODUCT = 'IT Service Management';

export interface TopBarProps {
  /** The product lockup, linking to `brand.href` (the area's home). */
  readonly brand?: ShellBrand;
  /** The product's name beside the mark. Defaults to "IT Service Management". */
  readonly product?: string;
  /** The brand link's name, e.g. "IT Service Management — Help Portal home". Defaults to the product's name. */
  readonly brandLabel?: string;
  /** After the brand: the area switcher, or the area's lockup (v3 §3.6). */
  readonly area?: ReactNode;
  /** Before the brand: the ☰ that opens navigation, or a back link. */
  readonly start?: ReactNode;
  /** The page's name, where the bar stands in for the page's own heading (phones' inner pages). */
  readonly title?: string;
  /** Between the start and the end: the portal's centred pills. */
  readonly center?: ReactNode;
  /** Search, status, bell, account. */
  readonly end?: ReactNode;
  /** Draw on the bar's raised surface (default) or on the canvas (status screens, which have nothing scrolling beneath). */
  readonly material?: 'chrome' | 'canvas';
  readonly className?: string;
}

/**
 * The 56 px top bar of the Help Portal's frame (v3 §3.6): opaque
 * `surface.raised` with its `border.subtle` hairline always drawn — no glass
 * (A2 S-3) — sticky under any system bar (`--itsm-system-bar-h`).
 *
 * At its start the product mark (32 px) and, from 1280 px, the product's
 * name, as one link to the area's home; then the area switcher — "Help
 * Portal ⌄" — or the area's lockup. With a centre slot (the portal's pills)
 * the bar is a three-column grid so the pills are centred on the window, not
 * on what is left between the brand and the account button. The safe areas
 * of a notched phone are kept clear on every side.
 *
 * A `<header>`: the page's banner landmark.
 */
export function TopBar({ brand, product = PRODUCT, brandLabel, area, start, title, center, end, material = 'chrome', className }: TopBarProps): ReactNode {
  return (
    <header className={cx('itsm-TopBar', className)} data-material={material}>
      <div className="itsm-TopBar__inner" data-has-center={center ? '' : undefined}>
        <div className="itsm-TopBar__start">
          {start}
          {brand ? (
            <ShellLink href={brand.href} className="itsm-TopBar__brand" aria-label={brandLabel ?? product}>
              <BrandMark size={32} />
              <span className="itsm-TopBar__brandName">{product}</span>
            </ShellLink>
          ) : null}
          {area ? <div className="itsm-TopBar__area">{area}</div> : null}
          {title ? <span className="itsm-TopBar__title">{title}</span> : null}
        </div>
        {center ? <div className="itsm-TopBar__center">{center}</div> : null}
        {end ? <div className="itsm-TopBar__end">{end}</div> : null}
      </div>
    </header>
  );
}
