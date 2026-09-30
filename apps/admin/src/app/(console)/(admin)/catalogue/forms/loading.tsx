import type { ReactNode } from 'react';
import { FormsSkeleton } from '../../../../../components/catalogue/Skeletons.js';
import '../../../../../components/catalogue/catalogue.css';

export default function Loading(): ReactNode {
  return <FormsSkeleton />;
}
