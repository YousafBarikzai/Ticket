'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { HelpFlow, type HelpFlowParts, type HelpFlowStart } from './HelpFlow.js';
import type { HelpCan, KnownIssue } from './model.js';
import './help.css';

/**
 * `/report`: "How can we help?" as a page (SPEC §6.3, Y-1.3.5) — the same
 * two steps as the sheet, in the page's reading column under its own
 * heading. It is what the manifest's *New request* shortcut opens, and what
 * *New request* opens when the network is gone: the service worker keeps
 * this page, the flow needs nothing from the server to run, and a report
 * written here offline goes into the outbox with the same key it will be
 * sent with.
 */

export interface ReportFlowProps {
  readonly userId: string | null;
  readonly can: HelpCan;
  readonly knownIssues: { readonly issues: readonly KnownIssue[]; readonly followUrl: string | null };
  readonly start?: HelpFlowStart;
}

function PageParts({ parts }: { readonly parts: HelpFlowParts }): ReactNode {
  const { initialFocusRef } = parts;
  // The page is the flow: its one field starts with the caret in it.
  useEffect(() => {
    initialFocusRef.current?.focus({ preventScroll: true });
  }, [initialFocusRef]);

  return (
    <section className="app-Report__card" aria-label={parts.stepLabel ?? parts.title} data-phase={parts.phase}>
      {parts.stepLabel ? (
        <p className="app-Report__step" aria-hidden="true">
          {parts.stepLabel}
        </p>
      ) : null}
      {parts.body}
      <div className="app-HelpFlow__footer app-Report__actions">{parts.footer}</div>
    </section>
  );
}

export function ReportFlow({ userId, can, knownIssues, start }: ReportFlowProps): ReactNode {
  const router = useRouter();
  return (
    <HelpFlow variant="page" userId={userId} can={can} knownIssues={knownIssues} {...(start ? { start } : {})} onClose={() => router.push('/')}>
      {(parts) => <PageParts parts={parts} />}
    </HelpFlow>
  );
}
