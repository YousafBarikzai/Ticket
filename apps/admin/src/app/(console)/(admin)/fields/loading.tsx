import type { ReactNode } from 'react';
import { FieldsSkeleton } from '../../../../components/fields/Skeleton.js';
import '../../../../components/fields/fields.css';

export default function Loading(): ReactNode {
  return <FieldsSkeleton />;
}
