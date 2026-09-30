import type { ReactNode } from 'react';
import { SettingsSkeleton } from '../../../../../components/settings/Skeletons.js';
import '../../../../../components/settings/settings.css';

export default function Loading(): ReactNode {
  return <SettingsSkeleton label="Loading AI settings…" sections={[5, 3, 3]} />;
}
