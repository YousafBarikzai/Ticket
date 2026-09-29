'use client';

import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';

export interface FormErrorSummaryProps {
  /** Each links to its field by id. */
  readonly errors: readonly { readonly fieldId: string; readonly message: string }[];
  readonly title?: string;
  readonly className?: string;
}

/**
 * The list of what stopped a submit, focused when it appears, each item a
 * link to the field it is about.
 *
 * Stub (SPEC §4.4): renders the alert and its links; the forms package adds
 * focus management and styling.
 */
export function FormErrorSummary({ errors, title = 'There is a problem', className }: FormErrorSummaryProps): ReactNode {
  if (errors.length === 0) return null;
  return (
    <div role="alert" className={cx('itsm-FormErrorSummary', className)}>
      <p>{title}</p>
      <ul>
        {errors.map((error) => (
          <li key={error.fieldId}>
            <a href={`#${error.fieldId}`}>{error.message}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}
