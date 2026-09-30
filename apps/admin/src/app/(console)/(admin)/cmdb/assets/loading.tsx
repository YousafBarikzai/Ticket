import type { ReactNode } from 'react';
import { AssetsSkeleton } from '../../../../../components/cmdb/Skeletons.js';
import '../../../../../components/cmdb/cmdb.css';

export default function Loading(): ReactNode {
  return <AssetsSkeleton />;
}
