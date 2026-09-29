'use client';

import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';
import type { ShellBrand } from './nav.js';

export interface TopBarProps {
  readonly brand?: ShellBrand;
  readonly start?: ReactNode;
  readonly title?: string;
  readonly end?: ReactNode;
  readonly className?: string;
}

/**
 * The 52 px bar: the portal's frame, the sidebar apps below 1024 px, and the
 * status screens. Glass (`material.chrome`), one of the few surfaces that is.
 *
 * Stub (SPEC §4.9): renders its slots in order; the shell package lays it out.
 */
export function TopBar({ brand, start, title, end, className }: TopBarProps): ReactNode {
  return (
    <div className={cx('itsm-TopBar', className)}>
      {brand ? <a href={brand.href}>{brand.name}</a> : null}
      {start}
      {title ? <span>{title}</span> : null}
      {end}
    </div>
  );
}
