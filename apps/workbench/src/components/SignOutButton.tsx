'use client';

import type { ReactNode } from 'react';
import { Button } from '@itsm/ui';

/**
 * A form, not a link.
 *
 * Signing out is a state change, so it is a `POST` — which also means the
 * browser sends `sec-fetch-site: same-origin` and the BFF's origin check
 * passes, where a prefetched `GET` link would end somebody's session because
 * they hovered over it.
 */
export function SignOutButton(): ReactNode {
  return (
    <form action="/api/session/logout" method="post" className="itsm-AppShell__signout">
      <Button type="submit" variant="ghost" size="sm">
        Sign out
      </Button>
    </form>
  );
}
