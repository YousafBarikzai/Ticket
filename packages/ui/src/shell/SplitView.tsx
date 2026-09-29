'use client';

import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';

export interface SplitPane {
  readonly id: string;
  /** The pane's landmark name; also what F6 lands on. */
  readonly label: string;
  readonly as?: 'section' | 'article' | 'aside';
  /** Pixel bounds and starting width. */
  readonly min: number;
  readonly max?: number;
  readonly defaultSize?: number;
  readonly collapsible?: boolean;
  readonly children: ReactNode;
}

export interface SplitViewProps {
  readonly panes: readonly SplitPane[];
  /** Remembers pane widths on this device. */
  readonly persistKey?: string;
  readonly className?: string;
}

/**
 * Resizable side-by-side panes — the workbench inbox — each scrolling on its
 * own, each an F6 region, with keyboard-resizable separators.
 *
 * Stub (SPEC §4.9): renders the panes as labelled landmarks; the shell package
 * adds sizing, separators and scroll restoration.
 */
export function SplitView({ panes, className }: SplitViewProps): ReactNode {
  return (
    <div className={cx('itsm-SplitView', className)}>
      {panes.map(({ id, label, as: Tag = 'section', children }) => (
        <Tag key={id} id={id} aria-label={label}>
          {children}
        </Tag>
      ))}
    </div>
  );
}
