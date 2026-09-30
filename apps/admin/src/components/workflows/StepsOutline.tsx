'use client';

import type { ReactNode } from 'react';
import { Badge, Icon } from '@itsm/ui';
import { steps, type FlowGraph } from './graph.js';

/**
 * The workflow as an ordered list (SPEC §6.1, X-69): each step's type, name
 * and what it does, then where it goes next and on what condition. The same
 * graph as the diagram, in the form a screen reader and a phone read best —
 * it is the default below 768 px. Selecting a step shows its settings.
 */
export function StepsOutline({
  graph,
  selected = null,
  onSelect,
  problems,
}: {
  readonly graph: FlowGraph;
  readonly selected?: string | null;
  /** Client only. */
  readonly onSelect?: (key: string) => void;
  readonly problems?: ReadonlySet<string>;
}): ReactNode {
  const list = steps(graph);
  return (
    <ol className="app-Steps" aria-label="Steps, in the order they run">
      {list.map((step) => (
        <li key={step.key} className="app-Steps__step" data-selected={selected === step.key ? '' : undefined} data-unreachable={step.reachable ? undefined : ''}>
          <div className="app-Steps__head">
            <span className="app-Steps__number" aria-hidden="true">
              {step.number}
            </span>
            <Icon name={step.type.icon} size="sm" />
            <span className="app-Steps__type">{step.type.label}</span>
            {onSelect ? (
              <button type="button" className="app-Steps__title" aria-pressed={selected === step.key} onClick={() => onSelect(step.key)}>
                {step.title}
              </button>
            ) : (
              <span className="app-Steps__title">{step.title}</span>
            )}
            {problems?.has(step.key) ? (
              <Badge size="sm" tone="danger" icon="circle-alert">
                Problem
              </Badge>
            ) : null}
            {step.reachable ? null : (
              <Badge size="sm" tone="warning">
                Never reached
              </Badge>
            )}
          </div>
          {step.description !== step.title ? <p className="app-Steps__does">{step.description}</p> : null}
          {step.next.length > 0 ? (
            <ul className="app-Steps__next" aria-label={`After ${step.title}`}>
              {step.next.map((next, index) => (
                <li key={`${next.key}:${index}`}>
                  <Icon name="arrow-right" size="xs" directional />
                  <span>
                    {next.title}
                    {next.condition ? <span className="app-Steps__condition"> — {next.condition}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="app-Steps__end">The workflow ends here.</p>
          )}
        </li>
      ))}
    </ol>
  );
}
