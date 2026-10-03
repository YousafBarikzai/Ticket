import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { LegalPage } from '../../components/LegalPage.js';
import { privacyDocument } from '../../legal/privacy.js';

/** `/privacy` (SPEC v3 §6.6; A5 §11): static, from `src/legal/privacy.ts` and the facts in `legal/facts.ts`. */
export const dynamic = 'force-static';

export const metadata: Metadata = { title: 'Privacy policy' };

export default function Page(): ReactNode {
  return <LegalPage document={privacyDocument()} />;
}
