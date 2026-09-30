import type { ReactNode } from 'react';
import { SlaCardsSkeleton } from '../../../../components/sla/Skeletons.js';
import '../../../../components/sla/sla.css';

export default function Loading(): ReactNode {
  return <SlaCardsSkeleton label="Loading service levels…" />;
}
