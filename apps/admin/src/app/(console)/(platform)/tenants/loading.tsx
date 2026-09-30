import type { ReactNode } from 'react';
import { PlatformSkeleton } from '../../../../components/platform/Skeletons.js';
import '../../../../components/platform/platform.css';

/** Below the `(platform)` layout's gate, so a non-operator still gets a real 404 (Y-1.3.3). */
export default function Loading(): ReactNode {
  return <PlatformSkeleton kind="tenants" />;
}
