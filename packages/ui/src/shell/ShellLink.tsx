'use client';

import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { useOptionalItsm } from '../provider/ItsmProvider.js';

export interface ShellLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  readonly href: string;
  readonly prefetch?: boolean | null;
  readonly children?: ReactNode;
}

/**
 * A link through the application's router: the `Link` handed to
 * `ItsmProvider` (Next's, with its prefetching and client-side transitions),
 * or a plain anchor outside the provider. The frame never imports Next — the
 * application injects its link, and every link the frame draws goes through
 * here.
 */
export function ShellLink({ href, prefetch, children, ...rest }: ShellLinkProps): ReactNode {
  const Link = useOptionalItsm()?.Link;
  if (Link) {
    return (
      <Link href={href} {...(prefetch === undefined ? {} : { prefetch })} {...rest}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}
