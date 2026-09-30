import type { ReactNode } from 'react';
import { DashboardsSkeleton } from '../../../../components/insights/Skeletons.js';
import '../../../../components/insights/insights.css';

/** Insights › Dashboards while it loads: the list beside twelve-column widget ghosts (SPEC §6.1). */
export default function Loading(): ReactNode {
  return <DashboardsSkeleton />;
}
