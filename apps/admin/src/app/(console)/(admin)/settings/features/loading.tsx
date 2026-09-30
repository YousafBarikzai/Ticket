import type { ReactNode } from 'react';
import { SettingsSkeleton } from '../../../../../components/settings/Skeletons.js';
import '../../../../../components/settings/settings.css';

export default function Loading(): ReactNode {
  return <SettingsSkeleton label="Loading features…" sections={[6, 1, 1]} />;
}
