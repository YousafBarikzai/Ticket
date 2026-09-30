import type { ReactNode } from 'react';
import { IntegrationsTableSkeleton } from '../../../../../components/integrations/Skeletons.js';
import '../../../../../components/integrations/integrations.css';

export default function Loading(): ReactNode {
  return <IntegrationsTableSkeleton label="Loading credentials…" columns={5} action />;
}
