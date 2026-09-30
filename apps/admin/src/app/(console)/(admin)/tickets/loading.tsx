import type { ReactNode } from 'react';
import { TicketsSkeleton } from '../../../../components/tickets/Skeleton.js';
import '../../../../components/tickets/tickets.css';

export default function Loading(): ReactNode {
  return <TicketsSkeleton />;
}
