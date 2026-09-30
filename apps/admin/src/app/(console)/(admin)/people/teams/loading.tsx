import type { ReactNode } from 'react';
import { TeamsSkeleton } from '../../../../../components/people/Skeletons.js';
import '../../../../../components/people/people.css';

export default function Loading(): ReactNode {
  return <TeamsSkeleton />;
}
