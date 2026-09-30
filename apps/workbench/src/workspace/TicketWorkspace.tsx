'use client';

import type { ReactNode } from 'react';
import { EmptyState } from '@itsm/ui';

/**
 * The ticket workspace: header, property chips, next step, conversation and
 * composer — in the inbox's detail pane and as the full `/tickets/[id]` page
 * (SPEC §6.2).
 *
 * **Stub → WP24.** This is the contract the frame and the inbox build
 * against. Until WP24 lands, the pane offers the full page, which is where
 * the ticket can be worked today.
 */

export interface TicketWorkspaceProps {
  /** The ticket's number (`INC-000123`) or id. */
  readonly ticketId: string;
  /** `pane`: beside the inbox list, title as `h2`. `page`: the whole content column, title as the page's `h1`. */
  readonly mode: 'pane' | 'page';
  /** Where "‹ Back" goes on the full page: the view the person came from. */
  readonly back?: { readonly href: string; readonly label: string };
}

export function TicketWorkspace({ ticketId, mode }: TicketWorkspaceProps): ReactNode {
  if (mode === 'page') return null;
  return (
    <EmptyState
      size="md"
      icon="ticket"
      title={ticketId}
      description="Open the full page to read and work this ticket."
      action={{ id: 'open', label: 'Open full page', href: `/tickets/${encodeURIComponent(ticketId)}`, variant: 'secondary' }}
    />
  );
}
