'use client';

import type { ReactNode } from 'react';
import { Button } from '@itsm/ui';
import { useHelpFlow } from '../../../components/PortalShell.js';

/**
 * "Report an issue" from Knowledge (SPEC §6.3, X-40): "How can we help?" —
 * at its details step with the searched words as the title when there are
 * some — so a search that found nothing, or a knowledge base with nothing in
 * it yet, is never a dead end. Not drawn for somebody who cannot report
 * anything. Never the filled primary: the top bar's *New request* is this
 * page's one (X-84).
 */
export function ReportButton({ text, children, variant = 'secondary' }: { readonly text?: string; readonly children: ReactNode; readonly variant?: 'secondary' | 'tinted' }): ReactNode {
  const help = useHelpFlow();
  if (!help.available) return null;
  return (
    <Button variant={variant} iconStart="compose" aria-haspopup="dialog" onClick={() => help.open(text ? { step: 'details', text } : {})}>
      {children}
    </Button>
  );
}
