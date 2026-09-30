'use client';

import { useState, useTransition, type MouseEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Card, SegmentedControl } from '@itsm/ui';
import { useRoutePending } from '@itsm/ui/shell';
import { RANGE_LABELS } from '../insights/presentation.js';
import type { VolumeRange } from './data.js';

export type VolumeViewId = 'time' | 'channel' | 'team';

const VIEWS: readonly { readonly value: VolumeViewId; readonly label: string }[] = [
  { value: 'time', label: 'Over time' },
  { value: 'channel', label: 'By channel' },
  { value: 'team', label: 'By team' },
];

const RANGES: readonly { readonly value: VolumeRange; readonly label: string }[] = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
];

/** The card's own address for a period: the page with `?range=`. */
export function rangeHref(range: VolumeRange): string {
  return `/?range=${range}`;
}

/** A plain left click on a link, which this card handles itself (anything else is the browser's). */
function isPlainClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/**
 * The Volume card (SPEC §6.1): one chart, three views and a period that
 * applies to this card only (X-30).
 *
 * The views — Raised vs resolved over time, by channel, by team — are local
 * state (`SegmentedControl mode="value"`): all three are already rendered on
 * the server for the period, so switching is instant and fetches nothing.
 * The period is in the URL (`?range=`) as real links (`mode="nav"`), so it
 * survives reload and opens in a new tab; a plain click replaces the URL in a
 * transition without scrolling the page, keeping the chart on screen while
 * the new period loads (the 2 px line, no skeleton flash).
 */
export function VolumeView({ range, views }: { readonly range: VolumeRange; readonly views: Readonly<Record<VolumeViewId, ReactNode>> }): ReactNode {
  const router = useRouter();
  const [view, setView] = useState<VolumeViewId>('time');
  const [pending, startTransition] = useTransition();
  useRoutePending(pending);

  const onRangeClick = (event: MouseEvent<HTMLDivElement>): void => {
    const link = (event.target as Element).closest('a');
    if (!link || !isPlainClick(event)) return;
    const href = link.getAttribute('href');
    if (!href) return;
    event.preventDefault();
    startTransition(() => router.replace(href, { scroll: false }));
  };

  return (
    <Card title="Volume">
      {/* The card's own toolbar, under its title so it wraps on a phone: the view, then the period (this card only). */}
      <div className="app-Volume__controls">
        <SegmentedControl
          label="Show volume"
          mode="value"
          size="sm"
          options={VIEWS}
          value={view}
          onValueChange={(next) => setView(next as VolumeViewId)}
        />
        <div onClickCapture={onRangeClick}>
          <SegmentedControl
            label="Period for the volume chart"
            mode="nav"
            size="sm"
            options={RANGES.map((option) => ({ ...option, href: rangeHref(option.value) }))}
            value={range}
          />
        </div>
      </div>
      <div className="app-Volume__body app-Refetch" aria-busy={pending || undefined}>
        <p className="app-Volume__range">
          {view === 'time' ? 'Raised and resolved' : view === 'channel' ? 'Raised, by channel' : 'Raised, by team'} · {RANGE_LABELS[range].toLowerCase()}
        </p>
        {views[view]}
      </div>
    </Card>
  );
}
