'use client';

import type { ReactNode } from 'react';
import { EmptyState } from '@itsm/ui';
import { PageHeader } from '@itsm/ui/shell';
import { openCommandPalette } from '../../client/palette.js';
import { NOT_FOUND_TITLE } from '../../navigation.js';

/**
 * "We can't find that page", inside the frame (A7 §8, T6; SPEC §4.10 "Not
 * found").
 *
 * Also what a non-operator sees at `/tenants` and `/plans`: the platform
 * layout answers `notFound()` rather than "you may not see this", so the
 * console never announces that a platform section exists — and this page is
 * deliberately the same one a mistyped address gets.
 *
 * The top bar reads "Page not found": the frame's route titles end with the
 * catch-all, so the server HTML already says it, and the header publishes the
 * same title once hydrated. The state is the dashed page placeholder (A1),
 * not a card. *Search* opens the command palette, which finds pages by the
 * words people use for them; the link home is the other way out.
 */
export default function ConsoleNotFound(): ReactNode {
  return (
    <div className="app-Page">
      <PageHeader title={NOT_FOUND_TITLE} />
      <EmptyState
        frame="dashed"
        size="lg"
        illustration="search"
        title="We can’t find that page"
        description="It may have moved, or the link may be incomplete. Search for what you were looking for, or start from the Command centre."
        action={{ id: 'search', label: 'Search', icon: 'search', variant: 'primary' }}
        secondaryAction={{ id: 'home', label: 'Go to the Command centre', href: '/', variant: 'secondary' }}
        onAction={(id) => {
          if (id === 'search') openCommandPalette();
        }}
      />
    </div>
  );
}
