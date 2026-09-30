import type { ReactNode } from 'react';
import { WorkforceTableSkeleton } from '../../../../../components/workforce/Skeletons.js';
import '../../../../../components/workforce/workforce.css';

export default function Loading(): ReactNode {
  return <WorkforceTableSkeleton label="Loading shifts…" columns={5} />;
}
