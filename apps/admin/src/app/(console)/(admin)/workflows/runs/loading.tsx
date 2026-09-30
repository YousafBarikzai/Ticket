import type { ReactNode } from 'react';
import { WorkflowsListSkeleton } from '../../../../../components/workflows/Skeletons.js';
import '../../../../../components/workflows/workflows.css';

export default function Loading(): ReactNode {
  return <WorkflowsListSkeleton label="Loading runs…" columns={5} />;
}
