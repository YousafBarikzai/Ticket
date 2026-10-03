import type { ReactNode } from 'react';
import { IconTile } from '@itsm/ui';
import type { HowStep } from '../landing/content.js';

/**
 * "How the demo works", as five numbered cards (A5 §4.6). An ordered list, so
 * the order is the list's and the "01" … "05" drawn on each card is
 * decoration a screen reader does not hear twice.
 */
export function HowSteps({ steps }: { readonly steps: readonly HowStep[] }): ReactNode {
  return (
    <ol className="app-Steps">
      {steps.map((step, index) => (
        <li key={step.title} className="app-Step">
          <div className="app-Step__top">
            <IconTile icon={step.icon} size={40} tone="neutral" />
            <span className="app-Step__number" aria-hidden="true">
              {String(index + 1).padStart(2, '0')}
            </span>
          </div>
          <h3 className="app-Step__title">{step.title}</h3>
          <p className="app-Step__body">{step.body}</p>
        </li>
      ))}
    </ol>
  );
}
