'use client';

import type { ReactNode } from 'react';
import { SegmentedControl, type SegmentedOption } from '@itsm/ui';

/**
 * The toolbar's scope and period controls (A6 §5.2.2): links with
 * `aria-current`, so a scope or a period is an address that reloads, opens
 * in a new tab and survives a refresh.
 *
 * A client module of the page's own rather than `SegmentedControl` used
 * straight from the server sections, for the page's weight. A server
 * component's import makes every client module of the barrel it comes
 * through a client reference of the page — the design system's controls
 * barrel brings its number, duration, time and filter fields with it,
 * about 6 kB nobody here uses — whereas an import from a client module is
 * tree-shaken like any other, and costs the control alone.
 */

export interface ControlGroup {
  /** The group's accessible name: "Scope", "Period". */
  readonly label: string;
  readonly value: string;
  readonly options: readonly SegmentedOption[];
}

export function OverviewControls({ scope, period }: { readonly scope: ControlGroup | null; readonly period: ControlGroup }): ReactNode {
  return (
    <>
      {scope ? <SegmentedControl mode="nav" label={scope.label} value={scope.value} options={scope.options} /> : null}
      <SegmentedControl mode="nav" size="sm" label={period.label} value={period.value} options={period.options} />
    </>
  );
}
