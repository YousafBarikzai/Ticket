import type { ReactNode } from 'react';
import { CisSkeleton } from '../../../../components/cmdb/Skeletons.js';
import '../../../../components/cmdb/cmdb.css';

export default function Loading(): ReactNode {
  return <CisSkeleton />;
}
