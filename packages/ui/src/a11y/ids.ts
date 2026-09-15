/**
 * Identifier helpers.
 *
 * Accessible relationships (`aria-labelledby`, `aria-describedby`,
 * `aria-controls`) are built out of ids, and ids must survive server rendering
 * and hydration. React's `useId` guarantees that; these helpers only make it
 * pleasant to use and strip the punctuation React puts in the value, which is
 * legal in an id but awkward in a CSS or test selector.
 */
import { useId, useMemo } from 'react';

function sanitise(reactId: string): string {
  return reactId.replace(/[^a-zA-Z0-9_-]/g, '');
}

/** A stable, hydration-safe id, e.g. `itsm-dialog-r1a`. */
export function useStableId(prefix = 'itsm'): string {
  const id = useId();
  return useMemo(() => `${prefix}-${sanitise(id)}`, [prefix, id]);
}

/**
 * A set of related ids from one React id, so a component needs one hook for a
 * label, a hint and an error rather than three.
 */
export function useIds<const T extends readonly string[]>(
  prefix: string,
  parts: T,
): Readonly<Record<T[number], string>> {
  const base = useStableId(prefix);
  return useMemo(() => {
    const out = {} as Record<T[number], string>;
    for (const part of parts) out[part as T[number]] = `${base}-${part}`;
    return out;
  }, [base, parts]);
}

/**
 * Joins the ids that are actually present. `aria-describedby=""` is not the
 * same as omitting the attribute — some screen readers announce an empty
 * description as a pause — so callers should spread `undefined` instead.
 */
export function joinIds(...ids: readonly unknown[]): string | undefined {
  // `unknown` rather than a union of falsy types because callers pass guards
  // such as `hint && ids.hint`, where `hint` is a ReactNode and may be 0.
  const present = ids.filter((id): id is string => typeof id === 'string' && id.length > 0);
  return present.length > 0 ? present.join(' ') : undefined;
}
