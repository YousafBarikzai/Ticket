'use client';

import NextLink, { useLinkStatus } from 'next/link';
import type { AnchorHTMLAttributes, ReactNode, Ref } from 'react';

/**
 * The link the design system renders through (SPEC §5.1, D11, F11).
 *
 * `@itsm/ui` never imports Next, so the provider is handed this component and
 * every `Button href`, sidebar item and breadcrumb becomes a client-side
 * navigation — no full reload, the frame stays, focus moves to the new `h1`.
 *
 * The hidden span is the pending signal: while this link's navigation is in
 * flight `useLinkStatus` reports it, the span loses `hidden`, and
 * `RouteProgress` (which watches for `[data-itsm-pending]`) draws its line.
 * It must live inside the link — that is where the hook reads its status.
 */

export type AppLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  readonly href: string;
  readonly prefetch?: boolean | null;
  readonly replace?: boolean;
  readonly scroll?: boolean;
  readonly ref?: Ref<HTMLAnchorElement>;
};

function LinkPending(): ReactNode {
  const { pending } = useLinkStatus();
  return <span data-itsm-pending="" hidden={!pending} />;
}

export function AppLink({ children, ref, prefetch, ...props }: AppLinkProps): ReactNode {
  return (
    <NextLink {...props} {...(prefetch === undefined ? {} : { prefetch })} ref={ref}>
      {children}
      <LinkPending />
    </NextLink>
  );
}
