import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';

export interface SkipLinksProps {
  readonly links: readonly { readonly label: string; readonly targetId: string }[];
  readonly className?: string;
}

/**
 * "Skip to content" and friends: the first focusable elements on the page.
 * Server-safe.
 *
 * Stub (SPEC §4.9): renders the links; the shell package hides them until focused.
 */
export function SkipLinks({ links, className }: SkipLinksProps): ReactNode {
  return (
    <div className={cx('itsm-SkipLinks', className)}>
      {links.map((link) => (
        <a key={link.targetId} href={`#${link.targetId}`}>
          {link.label}
        </a>
      ))}
    </div>
  );
}
