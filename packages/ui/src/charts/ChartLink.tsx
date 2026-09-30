'use client';

import type { ReactNode } from 'react';
import { useOptionalItsm } from '../provider/ItsmProvider.js';

/**
 * A link inside a server-rendered chart (a bar's category, a list row),
 * through the application's `Link` so it navigates in place and prefetches
 * like every other link. The chart stays server-safe: it passes an `href`
 * string, and only this leaf needs the provider. Outside one it is a plain
 * anchor.
 */
export function ChartLink({ href, className, children }: { readonly href: string; readonly className?: string; readonly children: ReactNode }): ReactNode {
  const Link = useOptionalItsm()?.Link;
  return Link ? (
    <Link href={href} className={className}>
      {children}
    </Link>
  ) : (
    <a href={href} className={className}>
      {children}
    </a>
  );
}
