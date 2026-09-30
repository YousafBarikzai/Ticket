import type { ReactNode } from 'react';
import { ModulesSkeleton } from '../../../../../components/settings/Skeletons.js';
import '../../../../../components/settings/settings.css';

export default function Loading(): ReactNode {
  return <ModulesSkeleton />;
}
