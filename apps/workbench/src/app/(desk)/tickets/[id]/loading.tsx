import type { ReactNode } from 'react';
import { SkeletonPage } from '@itsm/ui';

/**
 * The ticket while its conversation loads: the header, the property chips,
 * three messages and the composer, inside the frame (SPEC §4.10, §6.2).
 * Revealed after 200 ms, so a quick load shows no skeleton at all. Below the
 * layout's gate, so a missing ticket still answers 404.
 */
export default function TicketLoading(): ReactNode {
  return <SkeletonPage variant="workspace" label="Loading ticket…" />;
}
