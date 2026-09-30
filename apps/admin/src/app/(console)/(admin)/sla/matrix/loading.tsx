import type { ReactNode } from 'react';
import { SlaMatrixSkeleton } from '../../../../../components/sla/Skeletons.js';
import '../../../../../components/sla/sla.css';

export default function Loading(): ReactNode {
  return <SlaMatrixSkeleton />;
}
