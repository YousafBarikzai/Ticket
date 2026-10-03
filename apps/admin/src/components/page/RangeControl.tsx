'use client';

import { lazy, Suspense, useTransition, type MouseEvent, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { SegmentedControl } from '@itsm/ui';
import { useRoutePending } from '@itsm/ui/shell';
import { rangeHref, visibleRanges, type PageRangeKey, type RangeOptionInput } from './range.js';
import './page.css';

/** The calendar, fetched only once a custom period is chosen: most visits never need it. */
const DateRangePicker = lazy(() => import('@itsm/ui/overlays').then((module) => ({ default: module.DateRangePicker })));

export interface RangeControlProps {
  /** The period the page is showing. */
  readonly value: PageRangeKey;
  /** What `rangesFor(me, page)` offers this person on this page (`server/periods.ts`), in order. */
  readonly options: readonly RangeOptionInput[];
  /** The control's name: "Period", "Period for every card on this page". */
  readonly label: string;
  /**
   * A shared-demo session (`me.demo`): 12 months, year to date and 180 days
   * are never offered (D17), whatever `options` says.
   */
  readonly demo?: boolean;
  /** For `custom`: the chosen dates and the earliest allowed (`min`, the demo's T0 − 120 days), as `YYYY-MM-DD`. */
  readonly custom?: { readonly from?: string; readonly to?: string; readonly min?: string; readonly max?: string };
  readonly className?: string;
}

/** A plain left click on a link, which this control handles itself (anything else is the browser's). */
function isPlainClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/**
 * The page's period (A7 §2.3, §2.4): one control in the toolbar that every
 * card on the page answers to — never a range per card (A7-S4).
 *
 * The periods are links (`SegmentedControl mode="nav"`) that keep every other
 * query parameter and replace `range` (`rangeHref`), so a period survives a
 * reload and opens in a new tab. A plain click replaces the URL in a
 * transition without scrolling, so the page stays on screen while the new
 * period loads (the 2 px line, no skeleton flash). "Custom" shows two date
 * fields and a calendar, loaded only then.
 */
export function RangeControl({ value, options, label, demo = false, custom, className }: RangeControlProps): ReactNode {
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();
  useRoutePending(pending);

  const query = search?.toString() ?? '';
  const shown = visibleRanges(options, demo);
  if (shown.length === 0) return null;
  // A period the control does not offer (a hidden one in an old link) selects
  // nothing rather than a segment that would lie about what is drawn.
  const current = shown.some((option) => option.value === value) ? value : '';

  const go = (href: string): void => {
    startTransition(() => router.replace(href, { scroll: false }));
  };

  const onClick = (event: MouseEvent<HTMLDivElement>): void => {
    const link = (event.target as Element).closest('a');
    if (!link || !isPlainClick(event)) return;
    const href = link.getAttribute('href');
    if (!href) return;
    event.preventDefault();
    go(href);
  };

  return (
    <div className={className ? `app-RangeControl ${className}` : 'app-RangeControl'} aria-busy={pending || undefined}>
      <div onClickCapture={onClick}>
        <SegmentedControl
          label={label}
          mode="nav"
          size="sm"
          wrap
          options={shown.map((option) => ({
            value: option.value,
            label: option.label,
            href: rangeHref(pathname, query, option.value, option.value === 'custom' ? custom : undefined),
          }))}
          value={current}
        />
      </div>
      {current === 'custom' ? (
        <Suspense fallback={<span className="app-RangeControl__custom">{customText(custom)}</span>}>
          <DateRangePicker
            label="Custom period"
            size="sm"
            value={custom?.from && custom.to ? { from: custom.from, to: custom.to } : null}
            {...(custom?.min ? { min: custom.min } : {})}
            {...(custom?.max ? { max: custom.max } : {})}
            onChange={(next) => {
              if (next?.from && next.to) go(rangeHref(pathname, query, 'custom', next));
            }}
            className="app-RangeControl__custom"
          />
        </Suspense>
      ) : null}
    </div>
  );
}

function customText(custom: RangeControlProps['custom']): string {
  return custom?.from && custom.to ? `${custom.from} to ${custom.to}` : 'Choose dates';
}
