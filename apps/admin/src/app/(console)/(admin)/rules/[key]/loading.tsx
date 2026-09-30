import type { ReactNode } from 'react';
import { RuleBuilderSkeleton } from '../../../../../components/rules/Skeletons.js';
import '../../../../../components/rules/rules.css';

export default function Loading(): ReactNode {
  return <RuleBuilderSkeleton label="Loading the rule…" />;
}
