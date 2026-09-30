import type { ReactNode } from 'react';
import { DeliveriesSkeleton } from '../../../../components/integrations/Skeletons.js';
import '../../../../components/integrations/integrations.css';

export default function Loading(): ReactNode {
  return <DeliveriesSkeleton />;
}
