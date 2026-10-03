'use client';

import { DEMO_COPY } from '@itsm/contracts/demo';
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { announce } from '../a11y/announcer.js';
import { ConfirmDialog } from '../overlays/ConfirmDialog.js';
import { Popover } from '../overlays/Popover.js';
import type { ConfirmSpec } from '../types.js';
import { demoBarState, updateDemoBarState, type DemoNoticeSpec } from './DemoBarControls.js';
import { etaText, noteDemoStatus, readDemoStatus, requestDemoReset, resetBlock, resetBlockText, syncResetBlocked, type FetchLike } from './demo-watch.js';

export interface DemoResetDialogProps {
  /** The bar's Reset button; the reason popover is anchored to it. */
  readonly trigger: ReactElement<{ id?: string }>;
  /** The flow is running: checking, saying why not, or confirming. */
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly endpoints: { readonly status: string; readonly reset: string };
  /** Shows a notice under the bars ("A reset is already running."). */
  readonly onNotice: (notice: DemoNoticeSpec) => void;
  readonly fetch?: FetchLike;
}

/** The confirm (A2 §9.4): danger, Cancel first, the consequence spelt out. */
export const DEMO_RESET_CONFIRM: ConfirmSpec = {
  title: DEMO_COPY.resetConfirm.title,
  body: DEMO_COPY.resetConfirm.body,
  confirmLabel: DEMO_COPY.resetConfirm.confirm,
  tone: 'danger',
  consequences: [{ label: DEMO_COPY.resetConfirm.note }],
};

/** When the reset route gave no answer the bar can use. */
export const DEMO_RESET_FAILED = 'The demo data couldn’t be reset just now. Try again in a moment.';

type Phase = 'idle' | 'checking' | 'reason' | 'confirm';

const serverNow = (): number => Date.now() + demoBarState().skewMs;

/**
 * Reset demo data (A2 §9.4), loaded on intent.
 *
 * 1. It asks for the status first: in the cooldown, while a reset runs or
 *    while resetting is paused it says why in a small popover on the button
 *    ("Known in advance: say so at once") instead of confirming.
 * 2. Otherwise the `ConfirmDialog`: danger, Cancel focused first.
 * 3. `POST /api/demo/reset`: 202 puts the bar in its busy state and says
 *    "Resetting the demo data. This takes about 2 minutes; you can keep
 *    exploring."; the watch reloads the page when the new data is live. 409
 *    says "A reset is already running." under the bars and shows the busy
 *    state. 429 (and 503, a pause) closes the confirm and shows the
 *    cooldown, backoff or pause reason.
 *    403 and 404 take Reset off the bar. Anything else keeps the confirm open
 *    with the failure inline, so the visitor can try again.
 *
 * The trigger is always wrapped in the popover's root, opened or not, so the
 * button is one element from start to end and focus never jumps.
 */
export function DemoResetDialog({ trigger, open, onOpenChange, endpoints, onNotice, fetch: fetcher }: DemoResetDialogProps): ReactNode {
  const [phase, setPhase] = useState<Phase>('idle');
  const [reason, setReason] = useState('');
  const toReason = useRef(false);
  const run = useRef(0);

  const showReason = (text: string): void => {
    setReason(text);
    setPhase('reason');
  };

  useEffect(() => {
    if (!open) {
      setPhase('idle');
      return;
    }
    const id = (run.current += 1);
    setPhase('checking');
    void (async () => {
      const read = await readDemoStatus(endpoints.status, fetcher);
      if (id !== run.current) return;
      // Noted like a poll: the skew, the building state, a reset this page already started.
      const state = read ? noteDemoStatus(read) : demoBarState();
      const block = resetBlock(state.status, state.building !== null, serverNow());
      if (block) showReason(resetBlockText(block, serverNow()));
      else setPhase('confirm');
    })();
  }, [open, endpoints.status, fetcher]);

  const confirm = async (): Promise<void> => {
    const outcome = await requestDemoReset(endpoints.reset, fetcher);
    switch (outcome.kind) {
      case 'started':
        updateDemoBarState({
          building: { etaText: etaText(outcome.etaSec) },
          pending: { generation: outcome.nextGeneration, since: Date.now(), etaSec: outcome.etaSec, mine: true },
        });
        syncResetBlocked();
        announce(DEMO_COPY.resetStarted(outcome.etaSec));
        return;
      case 'running': {
        const live = demoBarState().status;
        const etaSec = live?.build?.etaSec ?? null;
        updateDemoBarState({
          building: { etaText: etaText(etaSec) },
          pending: { generation: live && live.generation !== null ? live.generation + 1 : null, since: Date.now(), etaSec, mine: false },
        });
        syncResetBlocked();
        onNotice({ kind: 'running', text: DEMO_COPY.resetRunning });
        return;
      }
      case 'refused': {
        const read = await readDemoStatus(endpoints.status, fetcher);
        const status = (read ? noteDemoStatus(read) : demoBarState()).status;
        const now = serverNow();
        const block =
          resetBlock(status, false, now) ??
          (outcome.retryAfterSec !== null && status && status.lastResetAt !== null
            ? { kind: 'cooldown' as const, since: status.lastResetAt, until: now + outcome.retryAfterSec * 1000 }
            : { kind: 'backoff' as const, until: null });
        toReason.current = true;
        setReason(resetBlockText(block, now));
        return;
      }
      case 'unavailable':
        updateDemoBarState({ resetHidden: true });
        return;
      default:
        throw new Error(DEMO_RESET_FAILED);
    }
  };

  return (
    <>
      <Popover
        trigger={trigger}
        open={phase === 'reason'}
        onOpenChange={(next) => {
          if (next) {
            // A press on the button: start (or keep) the flow; the check decides what opens.
            if (!open) onOpenChange(true);
            return;
          }
          if (phase === 'reason') onOpenChange(false);
        }}
        width="sm"
        align="end"
        className="itsm-DemoReset__reason"
      >
        <p className="itsm-DemoReset__reasonText">{reason}</p>
      </Popover>
      <ConfirmDialog
        open={phase === 'confirm'}
        onOpenChange={(next) => {
          if (next) return;
          if (toReason.current) {
            // The route said "not now" (429): the reason replaces the confirm.
            toReason.current = false;
            setPhase('reason');
            return;
          }
          onOpenChange(false);
        }}
        spec={DEMO_RESET_CONFIRM}
        onConfirm={confirm}
      />
    </>
  );
}
