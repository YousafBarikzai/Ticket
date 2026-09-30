'use client';

import { useState, type ReactNode } from 'react';
import { Button } from '@itsm/ui';

/**
 * A read-only view of a JSON value: an audit event's before and after, a
 * failed delivery's payload, a CI's attributes, a setting this console has no
 * control for, a condition written outside the builder (B §2.7).
 *
 * Collapsible by `<details>`, so it needs no script to open and close and
 * every level is reachable by keyboard; the first levels start open. *Copy*
 * puts the whole value on the clipboard, formatted. Nothing here edits:
 * ADR-0049 rules out a JSON text box as a way to change configuration, and a
 * view that looked editable would invite exactly that.
 *
 * Pages load it lazily (`next/dynamic`) where it sits in a drawer: most people
 * never open the payload.
 */
export interface JsonViewProps {
  readonly value: unknown;
  /** What it is, for the region's name and the copy confirmation: "Payload". */
  readonly label: string;
  /** Levels open at first. Default 2. */
  readonly openDepth?: number;
  /** Offer *Copy*. Default true. */
  readonly copy?: boolean;
  readonly className?: string;
}

type Kind = 'null' | 'string' | 'number' | 'boolean' | 'array' | 'object' | 'other';

function kindOf(value: unknown): Kind {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return 'array';
  switch (typeof value) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'object':
      return 'object';
    default:
      return 'other';
  }
}

/** A leaf as it would be written in JSON: strings quoted, `null` spelled out. */
export function formatLeaf(value: unknown): string {
  if (value === undefined) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return String(value);
  return JSON.stringify(value) ?? String(value);
}

/** "3 items", "1 key": what a collapsed branch holds. */
export function summarise(value: unknown): string {
  if (Array.isArray(value)) return value.length === 1 ? '1 item' : `${value.length} items`;
  if (value && typeof value === 'object') {
    const count = Object.keys(value).length;
    return count === 1 ? '1 key' : `${count} keys`;
  }
  return formatLeaf(value);
}

function Node({ name, value, depth, openDepth }: { readonly name: string | null; readonly value: unknown; readonly depth: number; readonly openDepth: number }): ReactNode {
  const kind = kindOf(value);
  const label = name === null ? null : <span className="app-Json__key">{name}</span>;

  if (kind === 'array' || kind === 'object') {
    const entries: [string, unknown][] = kind === 'array' ? (value as unknown[]).map((item, index) => [String(index), item]) : Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return (
        <li className="app-Json__leaf">
          {label}
          {label ? <span className="app-Json__colon">: </span> : null}
          <span className="app-Json__value" data-kind={kind}>
            {kind === 'array' ? '[]' : '{}'}
          </span>
        </li>
      );
    }
    return (
      <li className="app-Json__branch">
        <details open={depth < openDepth}>
          <summary>
            {label}
            {label ? <span className="app-Json__colon">: </span> : null}
            <span className="app-Json__summary">
              {kind === 'array' ? '[' : '{'} {summarise(value)} {kind === 'array' ? ']' : '}'}
            </span>
          </summary>
          <ul className="app-Json__children">
            {entries.map(([key, child]) => (
              <Node key={key} name={key} value={child} depth={depth + 1} openDepth={openDepth} />
            ))}
          </ul>
        </details>
      </li>
    );
  }

  return (
    <li className="app-Json__leaf">
      {label}
      {label ? <span className="app-Json__colon">: </span> : null}
      <span className="app-Json__value" data-kind={kind}>
        {formatLeaf(value)}
      </span>
    </li>
  );
}

export function JsonView({ value, label, openDepth = 2, copy = true, className }: JsonViewProps): ReactNode {
  const [copied, setCopied] = useState(false);
  const onCopy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(value, null, 2) ?? 'null').then(
      () => setCopied(true),
      () => undefined,
    );
  };
  return (
    <section className={className ? `app-Json ${className}` : 'app-Json'} aria-label={label}>
      {copy ? (
        <div className="app-Json__toolbar">
          <Button size="sm" variant="ghost" iconStart={copied ? 'check' : 'copy'} onClick={onCopy}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <span className="itsm-visually-hidden" role="status">
            {copied ? `${label} copied to the clipboard` : ''}
          </span>
        </div>
      ) : null}
      <ul className="app-Json__root">
        <Node name={null} value={value} depth={0} openDepth={openDepth} />
      </ul>
    </section>
  );
}
