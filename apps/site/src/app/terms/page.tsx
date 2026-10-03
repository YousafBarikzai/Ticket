import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { LegalPage } from '../../components/LegalPage.js';
import { termsDocument } from '../../legal/terms.js';

/** `/terms` (SPEC v3 §6.6; A5 §11): static, from `src/legal/terms.ts` and the facts in `legal/facts.ts`. */
export const dynamic = 'force-static';

export const metadata: Metadata = { title: 'Terms of use' };

export default function Page(): ReactNode {
  return <LegalPage document={termsDocument()} />;
}
