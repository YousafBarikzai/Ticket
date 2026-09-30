'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useItsm } from '@itsm/ui';
import { Sheet } from '@itsm/ui/overlays';
import { useFullScreenFlow } from '@itsm/ui/shell';
import type { HelpFlowRequest } from '../components/PortalShell.js';
import { HelpFlow } from './HelpFlow.js';
import type { HelpCan } from './model.js';
import './help.css';

/**
 * "How can we help?" as a sheet (SPEC D17, §6.3, X-40, X-92): from the end
 * edge at 768 px and up, the whole screen on a phone with the tab bar out
 * of the way. The frame loads it on first use (and prefetches it when idle)
 * through the default export, and opens it from *New request*, "Report 'x'
 * as an issue" and "Report it again" (`useHelpFlow().open(…)`).
 *
 * Each opening is a fresh flow, started where it was asked to start: a
 * plain *New request* picks up the draft left on this device, "Report 'vpn'
 * as an issue" starts at the details with "vpn" as the title. Closing keeps
 * what was typed (as the draft), so it is never a question of discarding.
 * A page change underneath — *Track it*, a service or an answer opened from
 * the results — closes it.
 */

export interface HelpSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Where to start, and with what text. */
  readonly request?: HelpFlowRequest;
  /** What the person may search while describing; everything, when the frame does not say. */
  readonly can?: HelpCan;
}

export default function HelpSheet({ open, onOpenChange, request, can }: HelpSheetProps): ReactNode {
  const pathname = usePathname();
  const shownOn = useRef(pathname);
  const userId = useItsm().storageScope ?? null;
  useFullScreenFlow(open);

  // A new flow each time the sheet opens (derived from the previous render, not an effect: no frame shows the old one).
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSession((count) => count + 1);
  }

  // The page changed underneath (a report went through, or they followed a result): the sheet's job is done.
  useEffect(() => {
    if (shownOn.current !== pathname && open) onOpenChange(false);
    shownOn.current = pathname;
  }, [pathname, open, onOpenChange]);

  return (
    <HelpFlow
      key={session}
      variant="sheet"
      userId={userId}
      {...(can ? { can } : {})}
      {...(request ? { start: request } : {})}
      onClose={() => onOpenChange(false)}
    >
      {(parts) => (
        <Sheet
          open={open}
          onOpenChange={(next) => onOpenChange(next)}
          title={parts.title}
          {...(parts.stepLabel ? { description: parts.stepLabel } : {})}
          initialFocusRef={parts.initialFocusRef}
          footer={<div className="app-HelpFlow__footer">{parts.footer}</div>}
          className="app-HelpSheet"
        >
          {parts.body}
        </Sheet>
      )}
    </HelpFlow>
  );
}
