import type { ReactNode } from 'react';
import { EmptyState } from '@itsm/ui';
import type { Read } from '../server/read.js';

/**
 * One list on a screen that shows several.
 *
 * The console's read-only sections all have the same three states — it failed,
 * it is empty, here it is — and the failure is the one that kept being written
 * differently on each page. A panel that could not load says so in its own
 * place, with the API's own reason, and the rest of the screen still renders;
 * a page that let the exception out would show nothing at all because one of
 * six lists was refused.
 *
 * Not a client component. Nothing here holds state, and a server component
 * that renders on the first paint is the point of the whole arrangement.
 */
export interface PanelProps<T> {
  readonly title: string;
  readonly description?: ReactNode;
  readonly result: Read<T>;
  /** Shown when the value is an empty array. */
  readonly empty?: string;
  readonly children: (value: T) => ReactNode;
}

export function Panel<T>({ title, description, result, empty, children }: PanelProps<T>): ReactNode {
  return (
    <section className="itsm-Panel" aria-label={title}>
      <h2 className="itsm-Panel__title">{title}</h2>
      {description ? <p className="itsm-Panel__lede">{description}</p> : null}
      {!result.ok ? (
        <EmptyState tone="error" title={`${title} could not be loaded`} description={result.message} />
      ) : empty !== undefined && Array.isArray(result.value) && result.value.length === 0 ? (
        <EmptyState title={empty} />
      ) : (
        children(result.value)
      )}
    </section>
  );
}
