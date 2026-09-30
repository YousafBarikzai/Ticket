import type { ReactNode } from 'react';
import { RotasSkeleton } from '../../../../../components/workforce/Skeletons.js';
import '../../../../../components/workforce/workforce.css';

export default function Loading(): ReactNode {
  return <RotasSkeleton />;
}
