'use client';

import type { ReactNode } from 'react';
import { BrandMark } from '../icons/BrandMark.js';
import { cx } from '../web/cx.js';
import { ShellLink } from './ShellLink.js';
import type { ShellBrand } from './nav.js';

export interface TopBarProps {
  /** The product and app: the mark and name, linking home. */
  readonly brand?: ShellBrand;
  /** Before the brand: the ☰ that opens navigation, or a back link. */
  readonly start?: ReactNode;
  /** The page's name, when the bar stands in for a sidebar on a small screen. */
  readonly title?: string;
  /** Between the title and the end: the portal's centred pills. */
  readonly center?: ReactNode;
  /** Search, status, bell, account. */
  readonly end?: ReactNode;
  /** Draw on glass (default) or on the opaque canvas (status screens, which have nothing scrolling beneath). */
  readonly material?: 'chrome' | 'canvas';
  readonly className?: string;
}

/**
 * The 52 px bar: the portal's frame, the sidebar apps below 1024 px, and the
 * status screens.
 *
 * It is glass (`material.chrome` at 0.92 with blur), one of the few surfaces
 * that is (D6): content scrolls beneath it, and the blur keeps the page's
 * colour without its detail. The solid fallbacks — high contrast, reduced
 * transparency, no `backdrop-filter` — come from the tokens. Text on it is
 * only `text.primary` and `text.secondary` (SPEC §1.3 rule a); a hairline
 * edge appears once the page has scrolled under it, where scroll-driven
 * animations are supported.
 *
 * A `<header>`: the page's banner landmark.
 */
export function TopBar({ brand, start, title, center, end, material = 'chrome', className }: TopBarProps): ReactNode {
  return (
    <header className={cx('itsm-TopBar', className)} data-material={material}>
      <div className="itsm-TopBar__inner" data-has-center={center ? '' : undefined}>
        <div className="itsm-TopBar__start">
          {start}
          {brand ? (
            <ShellLink href={brand.href} className="itsm-TopBar__brand">
              <BrandMark app={brand.app} size={28} />
              <span className="itsm-TopBar__brandName">{brand.name}</span>
            </ShellLink>
          ) : null}
          {title ? <span className="itsm-TopBar__title">{title}</span> : null}
        </div>
        {center ? <div className="itsm-TopBar__center">{center}</div> : null}
        {end ? <div className="itsm-TopBar__end">{end}</div> : null}
      </div>
    </header>
  );
}
