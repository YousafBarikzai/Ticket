'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Button, SegmentedControl } from '@itsm/ui';
import { formatLeaf } from './JsonView.js';

/**
 * What changed between two JSON values: an audit event's before and after, a
 * setting's versions, a form's (B §2.7).
 *
 * Compared leaf by leaf, by path (`sla.targets.0.minutes`), so a change deep
 * in a document is one row saying what it was and what it became, instead of
 * two walls of text to compare by eye. Rows are marked *Added*, *Removed* or
 * *Changed* in words as well as colour. Unchanged values are folded behind
 * "Show 12 unchanged" — they are context, not news.
 *
 * Two layouts: side by side (a table: path, before, after) and unified (one
 * list, before then after), which reads better in a narrow drawer. Lazy-loaded
 * by the pages that use it.
 */

export type DiffKind = 'added' | 'removed' | 'changed' | 'same';

export interface DiffRow {
  /** Dot path; array items by index. `(value)` for a top-level leaf. */
  readonly path: string;
  readonly kind: DiffKind;
  /** JSON spelling of the leaf, or absent when the path did not exist on that side. */
  readonly before?: string;
  readonly after?: string;
}

const ROOT = '(value)';

/** Every leaf of a JSON value by path. Empty objects and arrays count as leaves, so `{}` → `{a: 1}` is a change. */
export function flatten(value: unknown, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node) && node.length > 0) {
      node.forEach((child, index) => walk(child, path ? `${path}.${index}` : String(index)));
      return;
    }
    if (node && typeof node === 'object' && !Array.isArray(node) && Object.keys(node).length > 0) {
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) walk(child, path ? `${path}.${key}` : key);
      return;
    }
    out.set(path || ROOT, Array.isArray(node) ? '[]' : node && typeof node === 'object' ? '{}' : formatLeaf(node));
  };
  walk(value, prefix);
  return out;
}

/**
 * The rows of a diff, in the order the paths first appear (the after side's
 * order, then paths only the before side had), so a document reads top to
 * bottom as it is written.
 */
export function diffJson(before: unknown, after: unknown): DiffRow[] {
  const left = flatten(before);
  const right = flatten(after);
  const rows: DiffRow[] = [];
  for (const [path, value] of right) {
    const old = left.get(path);
    if (old === undefined) rows.push({ path, kind: 'added', after: value });
    else rows.push({ path, kind: old === value ? 'same' : 'changed', before: old, after: value });
  }
  for (const [path, value] of left) if (!right.has(path)) rows.push({ path, kind: 'removed', before: value });
  return rows;
}

const KIND_LABEL: Readonly<Record<DiffKind, string>> = { added: 'Added', removed: 'Removed', changed: 'Changed', same: 'Unchanged' };

export interface JsonDiffProps {
  readonly before: unknown;
  readonly after: unknown;
  /** The table's caption: "Changes to vip-requester". */
  readonly label: string;
  /** Default `split`; offers the other as a toggle. */
  readonly layout?: 'split' | 'unified';
  readonly className?: string;
}

export function JsonDiff({ before, after, label, layout: initialLayout = 'split', className }: JsonDiffProps): ReactNode {
  const rows = useMemo(() => diffJson(before, after), [before, after]);
  const [layout, setLayout] = useState<'split' | 'unified'>(initialLayout);
  const [showSame, setShowSame] = useState(false);
  const changed = rows.filter((row) => row.kind !== 'same');
  const same = rows.length - changed.length;
  const shown = showSame ? rows : changed;

  return (
    <section className={className ? `app-Diff ${className}` : 'app-Diff'} aria-label={label}>
      <div className="app-Diff__toolbar">
        <p className="app-Diff__summary">
          {changed.length === 0 ? 'No differences.' : `${changed.length} ${changed.length === 1 ? 'change' : 'changes'}`}
        </p>
        <SegmentedControl
          label="Layout"
          mode="value"
          size="sm"
          value={layout}
          onValueChange={(value) => setLayout(value === 'unified' ? 'unified' : 'split')}
          options={[
            { value: 'split', label: 'Side by side' },
            { value: 'unified', label: 'Unified' },
          ]}
        />
      </div>

      {layout === 'split' ? (
        <div className="app-Diff__scroll">
          <table className="app-Diff__table">
            <caption className="itsm-visually-hidden">{label}</caption>
            <thead>
              <tr>
                <th scope="col">Field</th>
                <th scope="col">Before</th>
                <th scope="col">After</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.path} data-kind={row.kind}>
                  <th scope="row">
                    <code>{row.path}</code>
                    <span className="app-Diff__kind">{KIND_LABEL[row.kind]}</span>
                  </th>
                  <td>{row.before === undefined ? <span className="app-Diff__absent">Not set</span> : <code>{row.before}</code>}</td>
                  <td>{row.after === undefined ? <span className="app-Diff__absent">Not set</span> : <code>{row.after}</code>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="app-Diff__unified">
          {shown.map((row) => (
            <li key={row.path} data-kind={row.kind}>
              <code className="app-Diff__path">{row.path}</code>
              <span className="app-Diff__kind">{KIND_LABEL[row.kind]}</span>
              {row.before !== undefined && row.kind !== 'same' ? (
                <span className="app-Diff__line" data-side="before">
                  <span className="itsm-visually-hidden">Before: </span>
                  <span aria-hidden="true">− </span>
                  <code>{row.before}</code>
                </span>
              ) : null}
              {row.after !== undefined ? (
                <span className="app-Diff__line" data-side={row.kind === 'same' ? 'same' : 'after'}>
                  <span className="itsm-visually-hidden">{row.kind === 'same' ? 'Value: ' : 'After: '}</span>
                  <span aria-hidden="true">{row.kind === 'same' ? '  ' : '+ '}</span>
                  <code>{row.after}</code>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {same > 0 ? (
        <Button size="sm" variant="ghost" onClick={() => setShowSame((value) => !value)} aria-expanded={showSame}>
          {showSame ? 'Hide unchanged' : `Show ${same} unchanged`}
        </Button>
      ) : null}
    </section>
  );
}
