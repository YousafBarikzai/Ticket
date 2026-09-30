'use client';

import NextLink, { useLinkStatus } from 'next/link';
import type { AnchorHTMLAttributes, ReactNode, Ref } from 'react';

/**
 * The link every design-system component renders in this app (SPEC §5.1,
 * F11), handed to `ItsmProvider` so that `@itsm/ui` never imports Next.
 *
 * A client-side navigation instead of a full page load, with Next's prefetch,
 * plus one span that reports whether this link's navigation is still in
 * flight: `RouteProgress` watches `[data-itsm-pending]` and draws its line
 * after 300 ms, and the sidebar item can shimmer while the route streams.
 * `useLinkStatus` only works inside the `<Link>` it describes, which is why
 * the span is a child component rather than state here.
 */
export interface AppLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  readonly href: string;
  readonly prefetch?: boolean | null;
  readonly replace?: boolean;
  readonly scroll?: boolean;
  readonly ref?: Ref<HTMLAnchorElement>;
}

function LinkPending(): ReactNode {
  const { pending } = useLinkStatus();
  return <span data-itsm-pending="" hidden={!pending} />;
}

export function AppLink({ children, prefetch, ref, ...props }: AppLinkProps): ReactNode {
  return (
    <NextLink {...props} ref={ref} {...(prefetch === undefined ? {} : { prefetch })}>
      {children}
      <LinkPending />
    </NextLink>
  );
}
