import type { ReactNode } from 'react';
import { WorkflowSkeleton } from '../../../../../components/workflows/Skeletons.js';
import '../../../../../components/workflows/workflows.css';

export default function Loading(): ReactNode {
  return <WorkflowSkeleton />;
}
