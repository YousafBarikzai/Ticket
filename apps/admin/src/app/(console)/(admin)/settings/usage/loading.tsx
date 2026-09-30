import type { ReactNode } from 'react';
import { UsageSkeleton } from '../../../../../components/settings/Skeletons.js';
import '../../../../../components/settings/settings.css';

export default function Loading(): ReactNode {
  return <UsageSkeleton />;
}
