'use client';

import type { ReactNode, Ref } from 'react';
import { Button, type IconName } from '@itsm/ui';

/**
 * The ticket's one obvious next step (SPEC §6.2): a single tinted button at
 * the end of the property row, so the move an agent makes most often from
 * each state is one press — never a status menu and a Save.
 *
 * Tinted, not filled: the composer's Send is the view's one filled button,
 * and two filled buttons would argue about which is the point of the screen.
 */

export type NextStepKind = 'start' | 'resolve' | 'resume' | 'close' | 'follow-up';

export interface NextStepSpec {
  readonly kind: NextStepKind;
  readonly label: string;
  readonly icon: IconName;
  /** The state it moves to; absent for Resolve… (it asks first) and Raise follow-up (a new ticket). */
  readonly to?: string;
  /** What the step needs: moving the ticket, or raising a new one. */
  readonly needs: 'transition' | 'create';
}

/**
 * What comes next from each state: new or reopened → Start work; in
 * progress → Resolve…; waiting on someone → Resume; resolved → Close;
 * finished → Raise follow-up. A state this does not know (a tenant's own,
 * managed by a workflow) has no next step: guessing one would be a button
 * that the service refuses.
 */
export function nextStepFor(status: string): NextStepSpec | null {
  switch (status) {
    case 'new':
    case 'reopened':
      return { kind: 'start', label: 'Start work', icon: 'play', to: 'in_progress', needs: 'transition' };
    case 'in_progress':
      return { kind: 'resolve', label: 'Resolve…', icon: 'circle-check', needs: 'transition' };
    case 'pending_requester':
    case 'pending_third_party':
    case 'pending_approval':
      return { kind: 'resume', label: 'Resume', icon: 'play', to: 'in_progress', needs: 'transition' };
    case 'resolved':
      return { kind: 'close', label: 'Close', icon: 'archive', to: 'closed', needs: 'transition' };
    case 'closed':
    case 'cancelled':
      return { kind: 'follow-up', label: 'Raise follow-up', icon: 'plus', needs: 'create' };
    default:
      return null;
  }
}

export interface NextStepProps {
  readonly step: NextStepSpec;
  /** A state gate, said out loud: "Needs a connection". */
  readonly disabledReason?: string;
  readonly busy?: boolean;
  readonly onClick?: () => void;
  readonly ref?: Ref<HTMLButtonElement>;
}

export function NextStep({ step, disabledReason, busy = false, onClick, ref, ...rest }: NextStepProps): ReactNode {
  return (
    <Button
      {...rest}
      ref={ref}
      variant="tinted"
      size="sm"
      className="app-NextStep"
      iconStart={step.icon}
      loading={busy}
      loadingLabel="Working…"
      disabledReason={disabledReason}
      onClick={onClick}
      data-step={step.kind}
    >
      {step.label}
    </Button>
  );
}
