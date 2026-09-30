'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useFullScreenFlow } from '@itsm/ui/shell';
import { Sheet } from '@itsm/ui/overlays';
import { ReportForm } from '../components/ReportForm.js';
import type { HelpFlowRequest } from '../components/PortalShell.js';

/**
 * "How can we help?" — the portal's one way in to getting help (SPEC D17,
 * §6.3, X-40). **Stub from WP14, owned by WP26**, which builds the real
 * two-step flow (Describe with answers inline → Details → confirmation with
 * the expected reply time) in place of this file's body.
 *
 * The contract the frame relies on, and which WP26 keeps:
 *
 *   - the **default export**, so the frame can load it with `next/dynamic` on
 *     first use (and prefetch it when idle) — it is a sheet and a form the
 *     first paint of every page does not need;
 *   - `open` / `onOpenChange`, and `request` — where to start (`describe`,
 *     or `details` for "Report 'vpn' as an issue") and the text to start
 *     with;
 *   - it hides the tab bar while open (a full-screen flow on phones, X-92)
 *     and closes itself when the page changes underneath it (after a
 *     successful report the form moves to the new request).
 *
 * Until then it is the existing report form in a sheet, so *New request* is
 * never a dead end.
 */

export interface HelpSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Where to start, and with what text. The stub always starts at the details it has: the report form. */
  readonly request?: HelpFlowRequest;
}

export default function HelpSheet({ open, onOpenChange }: HelpSheetProps): ReactNode {
  const pathname = usePathname();
  const shownOn = useRef(pathname);
  useFullScreenFlow(open);

  // A report that went through navigates to the new request: the sheet's job is done.
  useEffect(() => {
    if (shownOn.current !== pathname && open) onOpenChange(false);
    shownOn.current = pathname;
  }, [pathname, open, onOpenChange]);

  return (
    <Sheet open={open} onOpenChange={(next) => onOpenChange(next)} title="How can we help?" description="Tell us what’s wrong in your own words.">
      <ReportForm />
    </Sheet>
  );
}
