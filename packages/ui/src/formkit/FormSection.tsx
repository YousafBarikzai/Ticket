'use client';

import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';

export interface FormSectionProps {
  readonly title: string;
  readonly description?: string;
  readonly headingLevel?: 2 | 3;
  readonly columns?: 1 | 2;
  /** Guidance shown beside the fields on wide screens. */
  readonly aside?: ReactNode;
  /** Renders as `<details>`, for settings most people never change. */
  readonly collapsible?: boolean;
  readonly defaultOpen?: boolean;
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * A titled group of fields.
 *
 * Stub (SPEC §4.4): a section with its heading; the forms package adds the
 * columns, aside and collapsible variant.
 */
export function FormSection({ title, headingLevel = 2, children, className }: FormSectionProps): ReactNode {
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  return (
    <section className={cx('itsm-FormSection', className)}>
      <Heading>{title}</Heading>
      {children}
    </section>
  );
}
