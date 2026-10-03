import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { LegalPage } from '../../components/LegalPage.js';
import { cookiesDocument } from '../../legal/cookies.js';

/** `/cookies` (SPEC v3 §6.6; A5 §11): static, from `src/legal/cookies.ts` and the facts in `legal/facts.ts`. */
export const dynamic = 'force-static';

export const metadata: Metadata = { title: 'Cookie policy' };

export default function Page(): ReactNode {
  return <LegalPage document={cookiesDocument()} />;
}
