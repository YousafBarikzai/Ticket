'use client';

import { useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Banner, Button } from '@itsm/ui';

/**
 * "Couldn't load your requests · Retry" (SPEC §4.10): a part of the page
 * that failed says so in its own place, and the rest carries on. Never an
 * empty list — "Nothing open" over a failed read is a false answer to the
 * one question the page is there for.
 *
 * Retry redraws the page from the server in a transition, so what is on
 * screen stays put until the new copy arrives.
 */
export function RetryBanner({ what }: { readonly what: string }): ReactNode {
  const router = useRouter();
  const [pending, startRetry] = useTransition();
  return (
    <Banner
      tone="danger"
      variant="subtle"
      live={false}
      title={`Couldn’t load ${what}`}
      action={
        <Button size="sm" variant="secondary" iconStart="refresh-cw" loading={pending} loadingLabel="Trying again" onClick={() => startRetry(() => router.refresh())}>
          Retry
        </Button>
      }
    >
      Check your connection, then try again.
    </Banner>
  );
}
