'use client';

import type { ReactNode } from 'react';
import { Button } from '@itsm/ui';

/** A form, not a link: signing out is a state change, and a prefetched GET would do it by accident. */
export function SignOutButton(): ReactNode {
  return (
    <form action="/api/session/logout" method="post" className="itsm-AppShell__signout">
      <Button type="submit" variant="ghost" size="sm">
        Sign out
      </Button>
    </form>
  );
}
