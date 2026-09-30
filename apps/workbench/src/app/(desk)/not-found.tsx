import type { ReactNode } from 'react';
import { ProblemState } from '@itsm/ui';

/**
 * Not found, inside the frame (SPEC §4.10): a ticket that does not exist or
 * is outside the reader's teams, a view that is not one. The sidebar stays,
 * so the way on is one click away as well as the button.
 */
export default function DeskNotFound(): ReactNode {
  return (
    <ProblemState
      size="lg"
      headingLevel={1}
      problem={{ status: 404 }}
      secondaryAction={{ id: 'inbox', label: 'Back to inbox', href: '/inbox' }}
    />
  );
}
