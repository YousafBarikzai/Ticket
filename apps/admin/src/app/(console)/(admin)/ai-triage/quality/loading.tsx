import type { ReactNode } from 'react';
import { QualitySkeleton } from '../../../../../components/ai-triage/Skeletons.js';
import '../../../../../components/ai-triage/ai-triage.css';

export default function Loading(): ReactNode {
  return <QualitySkeleton />;
}
