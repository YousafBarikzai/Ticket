import type { ReactNode } from 'react';
import { AccessSkeleton } from '../../../../../components/security/Skeletons.js';
import '../../../../../components/security/security.css';

export default function Loading(): ReactNode {
  return <AccessSkeleton />;
}
