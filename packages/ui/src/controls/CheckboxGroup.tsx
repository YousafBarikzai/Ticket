'use client';

import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';

export interface CheckboxGroupOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
  readonly disabled?: boolean;
}

export interface CheckboxGroupProps {
  /** The `legend`. */
  readonly label: string;
  readonly options: readonly CheckboxGroupOption[];
  readonly value: readonly string[];
  /** Client only. */
  readonly onChange: (value: string[]) => void;
  readonly orientation?: 'vertical' | 'horizontal';
  readonly hint?: string;
  readonly error?: string;
  readonly className?: string;
}

/**
 * Several related checkboxes answering one question, as a `fieldset` whose
 * `legend` is the question.
 *
 * Stub (SPEC §4.2): renders the fieldset and legend; the actions-and-inputs
 * package renders the options with `Checkbox`, the hint and the error.
 */
export function CheckboxGroup({ label, orientation = 'vertical', className }: CheckboxGroupProps): ReactNode {
  return (
    <fieldset className={cx('itsm-CheckboxGroup', className)} data-orientation={orientation}>
      <legend>{label}</legend>
    </fieldset>
  );
}
