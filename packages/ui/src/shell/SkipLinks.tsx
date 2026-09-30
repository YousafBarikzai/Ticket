import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';

export interface SkipLinksProps {
  readonly links: readonly { readonly label: string; readonly targetId: string }[];
  readonly className?: string;
}

/**
 * "Skip to content" and friends — the first focusable things on the page, so
 * a keyboard user is not walked through the whole navigation on every page
 * (WCAG 2.4.1). Out of sight until focused, then a solid pill at the top
 * start corner, above everything. The workbench adds "Skip to ticket list",
 * "Skip to conversation" and "Skip to reply".
 *
 * Each target must be focusable (`tabindex="-1"`, as the frame's `main` is),
 * or the browser scrolls to it but leaves focus behind.
 *
 * Server-safe: plain anchors, no script.
 */
export function SkipLinks({ links, className }: SkipLinksProps): ReactNode {
  if (links.length === 0) return null;
  return (
    <div className={cx('itsm-SkipLinks', className)}>
      {links.map((link) => (
        <a key={link.targetId} className="itsm-SkipLinks__link" href={`#${link.targetId}`}>
          {link.label}
        </a>
      ))}
    </div>
  );
}
