import type { DetailsHTMLAttributes, ReactNode, Ref } from 'react';
import { Icon } from '../icons/Icon.js';
import { cx } from '../web/cx.js';
import { DisclosureMemory } from './DisclosureMemory.js';

export interface DisclosureProps extends Omit<DetailsHTMLAttributes<HTMLDetailsElement>, 'children' | 'open'> {
  /** The always-visible line that opens and closes it. */
  readonly summary: ReactNode;
  readonly defaultOpen?: boolean;
  /**
   * Remembers open or closed on this device under this key — a client
   * enhancement; the element works without it. Keys are app-chosen and
   * should be stable: "ticket.details".
   */
  readonly persistKey?: string;
  readonly children: ReactNode;
  readonly className?: string;
  readonly ref?: Ref<HTMLDetailsElement>;
}

/**
 * Progressive disclosure on the native `<details>` element, which opens and
 * closes with no JavaScript, is announced as expandable by every screen
 * reader, and opens by itself when in-page search finds text inside it.
 * Server-safe.
 *
 * The chevron turns as it opens; where the browser can animate to `auto`
 * height (`interpolate-size`, `::details-content`) the content slides open
 * too, and elsewhere it simply appears — which is also what reduced motion
 * gets everywhere. `persistKey` adds a small client component that restores
 * and records the state; without a key, no JavaScript is sent.
 */
export function Disclosure({ summary, defaultOpen = false, persistKey, children, className, ref, ...rest }: DisclosureProps): ReactNode {
  return (
    <details {...rest} ref={ref} className={cx('itsm-Disclosure', className)} open={defaultOpen || undefined}>
      <summary className="itsm-Disclosure__summary">
        <Icon name="chevron-right" size="sm" className="itsm-Disclosure__chevron" directional />
        <span className="itsm-Disclosure__label">{summary}</span>
      </summary>
      <div className="itsm-Disclosure__content">{children}</div>
      {persistKey ? <DisclosureMemory persistKey={persistKey} /> : null}
    </details>
  );
}
