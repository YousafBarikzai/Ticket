'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { announce } from '../a11y/announcer.js';
import { formatCount, formatNumber } from '../format/format.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import type { Plural } from '../types.js';
import { Button } from '../web/Button.js';
import { cx } from '../web/cx.js';
import { useLatest } from './latest.js';
import { nounFor } from './model.js';

export interface LoadMoreProps {
  readonly hasMore: boolean;
  /** Client only. */
  readonly onLoadMore: () => Promise<void> | void;
  readonly loading?: boolean;
  readonly shown: number;
  readonly noun: Plural;
  /** Loads as the end of the list scrolls into view (the workbench list). */
  readonly auto?: boolean;
  /** How many a load appends, for the button's words: "Load 50 more". */
  readonly pageSize?: number;
  readonly className?: string;
}

/** How long a load may take to show its rows before its announcement is given up on. */
const ANNOUNCE_WINDOW_MS = 10_000;

/**
 * The end of a list without totals: "Showing 100 · more available" and a
 * button that appends the next page (D13). List endpoints have no totals, so
 * the caption never guesses one.
 *
 * When the new rows arrive it says so — "50 more loaded", politely — because
 * rows appearing below the button are otherwise silent for a screen-reader
 * user. Focus stays on the button while there is more; when the last page
 * lands and the button goes, focus moves to the caption rather than falling
 * to the page. A failed load keeps the button, now reading "Try again", with
 * the reason beside it.
 *
 * `auto` adds a sentinel that loads when it scrolls into view (the workbench
 * list); the button stays as the keyboard and fallback path.
 */
export function LoadMore({ hasMore, onLoadMore, loading = false, shown, noun, auto = false, pageSize, className }: LoadMoreProps): ReactNode {
  const locale = useOptionalItsm()?.locale;
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const status = useRef<HTMLParagraphElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  /** The count before the load in flight, and whether the button had focus, until the new rows are counted. */
  const pending = useRef<{ readonly before: number; readonly focused: boolean; readonly at: number } | null>(null);
  const working = loading || busy;
  const latest = useLatest({ hasMore, working, onLoadMore });

  const load = async (): Promise<void> => {
    const current = latest.current;
    if (!current.hasMore || current.working) return;
    pending.current = { before: shown, focused: button.current !== null && button.current === document.activeElement, at: Date.now() };
    setBusy(true);
    setFailed(false);
    try {
      await current.onLoadMore();
    } catch {
      pending.current = null;
      setFailed(true);
      announce("Couldn't load more", { politeness: 'assertive' });
    } finally {
      setBusy(false);
    }
  };

  const loadLatest = useLatest(load);

  // The rows have arrived: say how many, and keep focus somewhere sensible.
  useEffect(() => {
    const load = pending.current;
    if (!load) return;
    if (Date.now() - load.at > ANNOUNCE_WINDOW_MS) {
      pending.current = null;
      return;
    }
    if (shown === load.before) return;
    pending.current = null;
    const added = shown - load.before;
    if (added > 0) announce(`${formatNumber(added, { locale })} more loaded`);
    if (!hasMore && load.focused && (document.activeElement === document.body || document.activeElement === null)) status.current?.focus();
  }, [shown, hasMore, locale]);

  // Auto-loading: the sentinel entering the viewport is a request for more.
  useEffect(() => {
    if (!auto || !hasMore || typeof IntersectionObserver === 'undefined' || !sentinel.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadLatest.current();
      },
      { rootMargin: '0px 0px 200px 0px' },
    );
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [auto, hasMore, loadLatest]);

  const more = pageSize ? `Load ${formatNumber(pageSize, { locale })} more` : 'Load more';
  return (
    <div className={cx('itsm-LoadMore', className)} data-state={failed ? 'failed' : working ? 'loading' : undefined}>
      <p className="itsm-LoadMore__status" ref={status} tabIndex={-1}>
        {formatCount(shown, hasMore, noun, locale)}
        {failed ? <span className="itsm-LoadMore__error"> · Couldn't load more {nounFor(2, noun)}</span> : null}
      </p>
      {hasMore ? (
        <Button ref={button} variant="secondary" size="sm" loading={working} loadingLabel={`Loading more ${noun.other}`} onClick={() => void load()}>
          {failed ? 'Try again' : more}
        </Button>
      ) : null}
      {auto && hasMore ? <div ref={sentinel} className="itsm-LoadMore__sentinel" aria-hidden="true" /> : null}
    </div>
  );
}
