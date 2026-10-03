import type { ReactNode } from 'react';
import { Icon } from '@itsm/ui';
import { DEMO_NOTES } from '../landing/roles-content.js';

/**
 * The three demo sentences under the persona cards and on every role page
 * (SPEC v3 §6.3): when it resets, that it is shared, and not to enter real
 * personal data. One line, separated by middle dots.
 */
export function DemoNotes(): ReactNode {
  return (
    <p className="app-DemoNotes">
      <Icon name="history" size="sm" className="app-DemoNotes__icon" />
      <span>{DEMO_NOTES.join(' · ')}</span>
    </p>
  );
}
