'use client';

import type { ReactNode } from 'react';
import { Button } from '@itsm/ui';
import { useHelpFlow } from '../../../components/PortalShell.js';

/**
 * "Report 'vpn' as an issue" (SPEC §6.3, X-40): the way on from any search,
 * found or not — "How can we help?" at its details step, with the words as
 * the title. Not drawn for somebody who cannot report anything. Never the
 * filled primary: the top bar's *New request* is this page's one (X-84).
 */
export function ReportFromSearch({ query, variant = 'secondary' }: { readonly query: string; readonly variant?: 'tinted' | 'secondary' }): ReactNode {
  const help = useHelpFlow();
  if (!help.available) return null;
  return (
    <Button variant={variant} iconStart="compose" aria-haspopup="dialog" onClick={() => help.open({ step: 'details', text: query })}>
      Report ‘{query}’ as an issue
    </Button>
  );
}
