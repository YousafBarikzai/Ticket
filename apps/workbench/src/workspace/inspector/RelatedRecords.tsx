import type { ReactNode } from 'react';

/**
 * The Related card's records beyond tickets and configuration items (v3
 * §7.1.4, R17): the problem with its workaround, the major incident and the
 * changes, each absent when the reader may not see it.
 *
 * A stub that renders nothing until the read exists: WP-72 (wave 6) makes it
 * real on `workbench.ticketRelated` once R17 (WP-61) and the SDK (WP-68)
 * land [V1-M5]. Its props are the interface that work builds on, fixed here
 * so `RelatedCard` need not change when it does.
 */
export interface RelatedRecordsProps {
  /** The ticket's number (`INC-000123`). */
  readonly ticketNumber: string;
}

export function RelatedRecords(_props: RelatedRecordsProps): ReactNode {
  return null;
}
