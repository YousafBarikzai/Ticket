'use client';

import { useState, type ReactNode } from 'react';
import { Button } from '@itsm/ui';
import { signOut } from '../../client/sign-out.js';

/** Sign out, from a page that has nothing else to offer: the frame's own POST, after forgetting this person's local traces. */
export function SignOutButton(): ReactNode {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="secondary"
      iconStart="log-out"
      loading={busy}
      loadingLabel="Signing out…"
      onClick={() => {
        setBusy(true);
        void signOut();
      }}
    >
      Sign out
    </Button>
  );
}
