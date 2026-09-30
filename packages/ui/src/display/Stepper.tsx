import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { Icon } from '../icons/Icon.js';
import type { IconName } from '../types.js';
import { cx } from '../web/cx.js';

export type StepStatus = 'complete' | 'current' | 'upcoming' | 'error' | 'skipped' | 'waiting';

export interface StepperStep {
  readonly id: string;
  readonly label: string;
  /** A second line: a date, "Waiting for you". */
  readonly description?: string;
  readonly status: StepStatus;
}

export interface StepperProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** The list's accessible name, e.g. "Request progress". */
  readonly label: string;
  readonly steps: readonly StepperStep[];
  /** `horizontal` (default) becomes vertical by itself in a container narrower than 30 rem (480 px). */
  readonly orientation?: 'horizontal' | 'vertical';
  readonly size?: 'sm' | 'md';
  readonly className?: string;
  readonly ref?: Ref<HTMLDivElement>;
}

/** What each status says to a screen reader, after the step's name. */
export const stepStatusText: Readonly<Record<StepStatus, string>> = {
  complete: 'completed',
  current: 'current step',
  upcoming: 'not started',
  error: 'needs attention',
  skipped: 'skipped',
  waiting: 'waiting',
};

const statusGlyph: Readonly<Partial<Record<StepStatus, IconName>>> = {
  complete: 'check',
  error: 'x',
  waiting: 'hourglass',
  skipped: 'minus',
};

/**
 * Progress through known stages: an ordered list with the current step marked
 * `aria-current="step"`. Server-safe.
 *
 * Every status has a shape of its own in the indicator — a tick on the
 * accent, a ringed dot for the current step, an empty ring for what is to
 * come, a cross on red for a step that failed, an hourglass for waiting, a
 * dash in a broken ring for skipped — and its word in hidden text after the label
 * ("Resolved, not started"), so neither colour nor shape is needed to follow
 * it. The indicator is static; nothing here moves (SPEC §1.9).
 *
 * The connector after a completed step is drawn in the accent, so the path
 * travelled reads at a glance.
 */
export function Stepper({ label, steps, orientation = 'horizontal', size = 'md', className, ref, ...rest }: StepperProps): ReactNode {
  return (
    <div {...rest} ref={ref} className={cx('itsm-Stepper', className)} data-orientation={orientation} data-size={size}>
      <ol className="itsm-Stepper__list" aria-label={label}>
        {steps.map((step) => {
          const glyph = statusGlyph[step.status];
          return (
            <li
              key={step.id}
              className="itsm-Stepper__step"
              data-status={step.status}
              aria-current={step.status === 'current' ? 'step' : undefined}
            >
              <span className="itsm-Stepper__track" aria-hidden="true">
                <span className="itsm-Stepper__indicator">
                  {glyph ? <Icon name={glyph} size={size === 'sm' ? 10 : 'xs'} className="itsm-Stepper__glyph" /> : null}
                </span>
                <span className="itsm-Stepper__connector" />
              </span>
              <span className="itsm-Stepper__text">
                <span className="itsm-Stepper__label">
                  {step.label}
                  <span className="itsm-visually-hidden">{`, ${stepStatusText[step.status]}`}</span>
                </span>
                {step.description ? <span className="itsm-Stepper__description">{step.description}</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
