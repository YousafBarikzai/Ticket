'use client';

import { useEffect, type ReactNode } from 'react';
import { Button, StatusScreen } from '@itsm/ui';

/**
 * The frame itself could not be drawn — the API is unreachable, or reading
 * the signed-in person failed for a reason other than an ended session
 * (which redirects) or a suspended workspace (which has its own screen).
 *
 * Outside the frame, because the frame is what failed; inside the root
 * layout, so the stylesheet and the theme are already there. Try again
 * re-renders the layout; Sign out is offered because an account in a bad
 * state is one of the ways to get here.
 */
export default function RootError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }): ReactNode {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <StatusScreen
      brand="workbench"
      illustration="error"
      errorBoundary
      title="Workbench couldn’t open"
      body={
        <>
          <p>Something went wrong on our side, or the service can’t be reached. Try again in a moment.</p>
          {error.digest ? <p className="app-Status__digest">Error ID {error.digest}</p> : null}
        </>
      }
    >
      <Button variant="primary" size="lg" fullWidth onClick={retry}>
        Try again
      </Button>
      <form method="post" action="/api/session/logout">
        <Button type="submit" variant="ghost" size="lg" fullWidth>
          Sign out
        </Button>
      </form>
    </StatusScreen>
  );
}
