import type { ReactNode } from 'react';
import { RulesListSkeleton } from '../../../../components/rules/Skeletons.js';
import '../../../../components/rules/rules.css';

export default function Loading(): ReactNode {
  return <RulesListSkeleton />;
}
