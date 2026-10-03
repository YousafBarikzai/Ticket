import type { ReactNode } from 'react';
import './page.css';

export interface PageToolbarProps {
  /** The scope the page's numbers cover (`ScopeSelect`): first, because everything after it depends on it. */
  readonly scope?: ReactNode;
  /** The page's one "As at" (`AsAt`). A page has no other: not in a chip, not in a card (X-M4). */
  readonly asAt?: ReactNode;
  /** The period (`RangeControl`). */
  readonly range?: ReactNode;
  /** Anything else that belongs with the page's reading controls: a search field, a view picker. */
  readonly start?: ReactNode;
  /** How fresh the page is (`Freshness`), at the start of the action end. */
  readonly freshness?: ReactNode;
  /** Page actions: `ExportMenu`, a ⋯ menu. Never a primary button — that is `primary`. */
  readonly actions?: ReactNode;
  /** Anything else at the action end, before the primary. */
  readonly end?: ReactNode;
  /** The page's one primary action ("+ New rule"), always last (G2). */
  readonly primary?: ReactNode;
  /** Sticks under the frame's top bar while the page scrolls (dashboards). */
  readonly sticky?: boolean;
  /** The group's name for assistive technology. */
  readonly label?: string;
  readonly className?: string;
}

/**
 * The row under the top bar that every Administration page shares (G2, A7
 * §2.1): scope · As at · range on the reading side, then freshness · Export ·
 * the one primary action on the other.
 *
 * The order is the component's, not the caller's: each part has its own slot,
 * so no page can put Export before the range or a second primary in the
 * middle, and the parity checks (§12.5.1) find the same row on every page. It
 * is a `group`, not a `toolbar`: `role="toolbar"` promises arrow keys between
 * the controls, and a select, a set of links and a menu button are not one
 * widget. A server component; it adds no JavaScript of its own.
 */
export function PageToolbar({
  scope,
  asAt,
  range,
  start,
  freshness,
  actions,
  end,
  primary,
  sticky = false,
  label = 'Page controls',
  className,
}: PageToolbarProps): ReactNode {
  const reading = [scope, asAt, range, start].some(present);
  const acting = [freshness, actions, end, primary].some(present);
  if (!reading && !acting) return null;
  return (
    <div
      role="group"
      aria-label={label}
      className={className ? `app-Toolbar ${className}` : 'app-Toolbar'}
      data-sticky={sticky || undefined}
    >
      {reading ? (
        <div className="app-Toolbar__start">
          {slot('scope', scope)}
          {slot('as-at', asAt)}
          {slot('range', range)}
          {slot('start', start)}
        </div>
      ) : null}
      {acting ? (
        <div className="app-Toolbar__end">
          {slot('freshness', freshness)}
          {slot('actions', actions)}
          {slot('end', end)}
          {slot('primary', primary)}
        </div>
      ) : null}
    </div>
  );
}

function present(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== '';
}

/** One part in its own box, named, so a stylesheet and a test can tell the parts apart. */
function slot(name: string, node: ReactNode): ReactNode {
  if (!present(node)) return null;
  return (
    <div className="app-Toolbar__slot" data-slot={name}>
      {node}
    </div>
  );
}
