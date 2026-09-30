'use client';

import type { ReactNode } from 'react';
import { EmptyState } from '@itsm/ui';
import { PageHeader } from '@itsm/ui/shell';
import { openCommandPalette } from '../../client/palette.js';

/**
 * "That page isn't here", inside the frame (SPEC §4.10 "Not found").
 *
 * Also what a non-operator sees at `/tenants` and `/plans`: the platform
 * layout answers `notFound()` rather than "you may not see this", so the
 * console never announces that a platform section exists — and this page is
 * deliberately the same one a mistyped address gets.
 *
 * *Search* opens the command palette, which finds pages by the words people
 * use for them; the link home is the other way out.
 */
export default function ConsoleNotFound(): ReactNode {
  return (
    <div className="app-Page">
      <PageHeader title="Page not found" />
      <EmptyState
        size="lg"
        illustration="search"
        title="We couldn’t find that page"
        description="It may have moved, or the link may be incomplete. Search for what you were looking for, or start from the Command centre."
        action={{ id: 'search', label: 'Search', icon: 'search', variant: 'primary' }}
        secondaryAction={{ id: 'home', label: 'Go to Command centre', href: '/', variant: 'secondary' }}
        onAction={(id) => {
          if (id === 'search') openCommandPalette();
        }}
      />
    </div>
  );
}
