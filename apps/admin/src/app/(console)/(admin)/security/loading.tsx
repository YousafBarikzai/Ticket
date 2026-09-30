import type { ReactNode } from 'react';
import { AlertsSkeleton } from '../../../../components/security/Skeletons.js';
import '../../../../components/security/security.css';

export default function Loading(): ReactNode {
  return <AlertsSkeleton />;
}
