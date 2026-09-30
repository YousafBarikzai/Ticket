import type { ReactNode } from 'react';
import { AuditSkeleton } from '../../../../components/audit/Skeleton.js';
import '../../../../components/audit/audit.css';

export default function Loading(): ReactNode {
  return <AuditSkeleton />;
}
