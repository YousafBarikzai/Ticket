import type { ReactNode } from 'react';
import { RequestTypesSkeleton } from '../../../../components/catalogue/Skeletons.js';
import '../../../../components/catalogue/catalogue.css';

export default function Loading(): ReactNode {
  return <RequestTypesSkeleton />;
}
