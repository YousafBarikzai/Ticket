import type { ReactNode } from 'react';
import { OrganisationsSkeleton } from '../../../../../components/people/Skeletons.js';
import '../../../../../components/people/people.css';

export default function Loading(): ReactNode {
  return <OrganisationsSkeleton />;
}
