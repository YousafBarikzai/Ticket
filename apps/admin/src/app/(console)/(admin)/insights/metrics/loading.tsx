import type { ReactNode } from 'react';
import { TableSkeleton } from '../../../../../components/insights/Skeletons.js';
import '../../../../../components/insights/insights.css';

/** Insights › Metrics while it loads: the header, the search field and the table's rows. */
export default function Loading(): ReactNode {
  return <TableSkeleton label="Loading metrics…" columns={4} />;
}
