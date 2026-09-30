import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { NotFoundScreen } from '../../components/NotFoundScreen.js';

export const metadata: Metadata = { title: 'Not found' };

/** Not found, inside the frame: an address the portal does not have (see `NotFoundScreen`). */
export default function PortalNotFound(): ReactNode {
  return <NotFoundScreen />;
}
