import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';

export type StepStatus = 'complete' | 'current' | 'upcoming' | 'error' | 'skipped' | 'waiting';

export interface StepperStep {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly status: StepStatus;
}

export interface StepperProps {
  /** The list's accessible name, e.g. "Request progress". */
  readonly label: string;
  readonly steps: readonly StepperStep[];
  readonly orientation?: 'horizontal' | 'vertical';
  readonly size?: 'sm' | 'md';
  readonly className?: string;
}

/**
 * Progress through known stages, as an ordered list with the current step
 * marked `aria-current="step"`. Server-safe.
 *
 * Stub (SPEC §4.6): renders the list; the display package adds the status
 * icons, hidden status text and layout.
 */
export function Stepper({ label, steps, orientation = 'horizontal', size = 'md', className }: StepperProps): ReactNode {
  return (
    <ol aria-label={label} className={cx('itsm-Stepper', className)} data-orientation={orientation} data-size={size}>
      {steps.map((step) => (
        <li key={step.id} data-status={step.status} aria-current={step.status === 'current' ? 'step' : undefined}>
          {step.label}
        </li>
      ))}
    </ol>
  );
}
