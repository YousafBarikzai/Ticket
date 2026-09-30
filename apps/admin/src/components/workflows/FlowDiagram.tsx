'use client';

import { useId, useMemo, type CSSProperties, type ReactNode } from 'react';
import { Icon, VisuallyHidden } from '@itsm/ui';
import { NODE_HEIGHT, NODE_WIDTH, layout, nodeTitle, nodeType, steps, type FlowGraph } from './graph.js';

/**
 * A workflow's graph, drawn (SPEC §6.1 `/workflows/[key]`): steps as boxes
 * from top to bottom in the order they can run, arrows between them with
 * their conditions, loops curving back up the side. Read-only — there is no
 * graph editor this release (SPEC §7.5).
 *
 * The steps are real buttons (when a step can be selected), in the order a
 * reader meets them, each naming where it leads, so the diagram works from
 * the keyboard and reads sensibly aloud; the arrows are decoration over
 * that. The Steps outline beside it says the same in a list, and is the
 * default on a phone (X-69). Lazy-loaded by the pages that draw it.
 */
export interface FlowDiagramProps {
  readonly graph: FlowGraph;
  /** The diagram's name: "Diagram of Close a resolved ticket". */
  readonly label: string;
  readonly selected?: string | null;
  /** Client only. Makes the steps selectable. */
  readonly onSelect?: (key: string) => void;
  /** A run's steps: where it is, what failed, what is done. */
  readonly highlight?: { readonly current?: readonly string[]; readonly failed?: readonly string[]; readonly done?: readonly string[] };
  /** Steps the check found a problem with. */
  readonly problems?: ReadonlySet<string>;
  /** Smaller, for the run drawer. */
  readonly compact?: boolean;
}

export default function FlowDiagram({ graph, label, selected = null, onSelect, highlight, problems, compact = false }: FlowDiagramProps): ReactNode {
  const placed = useMemo(() => layout(graph), [graph]);
  const outline = useMemo(() => steps(graph), [graph]);
  const marker = `flow-arrow-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const byKey = new Map(placed.nodes.map((node) => [node.key, node]));
  const nodes = new Map(graph.nodes.map((node) => [node.key, node]));
  const current = new Set(highlight?.current ?? []);
  const failed = new Set(highlight?.failed ?? []);
  const done = new Set(highlight?.done ?? []);

  const stateOf = (key: string): 'failed' | 'current' | 'done' | undefined =>
    failed.has(key) ? 'failed' : current.has(key) ? 'current' : done.has(key) ? 'done' : undefined;
  const stateWords: Readonly<Record<string, string>> = { failed: 'failed here', current: 'the run is here', done: 'done' };

  return (
    <div className="app-Flow" data-compact={compact ? '' : undefined} role="group" aria-label={label}>
      <div className="app-Flow__scroll">
        <div className="app-Flow__canvas" style={{ inlineSize: placed.width, blockSize: placed.height } as CSSProperties}>
          <svg className="app-Flow__edges" width={placed.width} height={placed.height} viewBox={`0 0 ${placed.width} ${placed.height}`} aria-hidden="true" focusable="false">
            <defs>
              <marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" className="app-Flow__arrow" />
              </marker>
            </defs>
            {placed.edges.map((edge, index) => (
              <g key={`${edge.from}->${edge.to}:${index}`} className="app-Flow__edge" data-back={edge.back ? '' : undefined}>
                <path d={edge.path} markerEnd={`url(#${marker})`} />
                {edge.label && !compact ? (
                  <text x={edge.labelX} y={edge.labelY} className="app-Flow__edgeLabel" textAnchor={edge.labelAnchor} dominantBaseline="middle">
                    {edge.label}
                  </text>
                ) : null}
              </g>
            ))}
          </svg>
          <ol className="app-Flow__nodes">
            {outline.map((step) => {
              const box = byKey.get(step.key);
              const node = nodes.get(step.key);
              if (!box || !node) return null;
              const state = stateOf(step.key);
              const type = nodeType(node.type);
              const next =
                step.next.length === 0
                  ? 'The workflow ends here.'
                  : `Then ${step.next.map((entry) => (entry.condition ? `${entry.title} (${entry.condition})` : entry.title)).join('; or ')}.`;
              const style = { insetInlineStart: box.x, insetBlockStart: box.y, inlineSize: NODE_WIDTH, blockSize: NODE_HEIGHT } as CSSProperties;
              const content = (
                <>
                  <span className="app-Flow__icon" aria-hidden="true">
                    <Icon name={type.icon} size="sm" />
                  </span>
                  <span className="app-Flow__text">
                    <span className="app-Flow__title">{nodeTitle(node)}</span>
                    <span className="app-Flow__type">{type.label}</span>
                  </span>
                  <VisuallyHidden>
                    {`, step ${step.number}`}
                    {state ? `, ${stateWords[state]}` : ''}
                    {problems?.has(step.key) ? ', has a problem' : ''}
                    {step.reachable ? '' : ', never reached'}. {next}
                  </VisuallyHidden>
                </>
              );
              return (
                <li
                  key={step.key}
                  className="app-Flow__node"
                  style={style}
                  data-state={state}
                  data-selected={selected === step.key ? '' : undefined}
                  data-problem={problems?.has(step.key) ? '' : undefined}
                  data-unreachable={step.reachable ? undefined : ''}
                  data-start={graph.start === step.key ? '' : undefined}
                >
                  {onSelect ? (
                    <button type="button" className="app-Flow__box" aria-pressed={selected === step.key} onClick={() => onSelect(step.key)}>
                      {content}
                    </button>
                  ) : (
                    <span className="app-Flow__box">{content}</span>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}
