'use client';

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type KeyboardEvent, type ReactNode } from 'react';
import type { ApprovalDetail } from '@itsm/sdk';
import { newIdempotencyKey, useOutbox } from '@itsm/pwa';
import {
  Button,
  Checkbox,
  EmptyState,
  ProgressBar,
  RelativeTime,
  SegmentedControl,
  StatusPill,
  announce,
  notify,
  useItsm,
  useNow,
} from '@itsm/ui';
import { formatDateTime } from '@itsm/ui/format';
import { useLiveRefresh } from '../client/live.js';
import type { DecisionOutcome } from '../components/ApprovalDecision.js';
import { replyByPhrase } from '../help/timing.js';
import { RetryBanner } from '../requests/RetryBanner.js';
import {
  SCOPES,
  bulkSummary,
  decidedToast,
  emptyFor,
  inListOrder,
  openParam,
  openIdOf,
  outcomePill,
  progressLine,
  scopeHref,
  waitingPill,
  whatLine,
  type ApprovalItem,
  type ApprovalScope,
  type BulkResult,
} from './model.js';

/**
 * The Approvals inbox, below the heading (SPEC §6.3 `/approvals`, §6.4
 * "Approve"): *To decide (n)* and *Decided* as links in the URL, and the
 * list.
 *
 * Each row is an `<li>` holding a checkbox and one button — siblings, never
 * one inside the other (X-62) — and the button opens the request in a sheet
 * (`?open=approval:<id>`, pushed, so Back closes it). Tab reaches every
 * control; ↑ and ↓ move between rows, keeping to the checkboxes or the
 * buttons; there are no letter keys (the portal has none, D14).
 *
 * After a decision the sheet closes, the row leaves, focus moves to the row
 * that took its place (or the heading, when none is left) and the count
 * follows. Ticking rows offers *Approve n* — a confirmation listing them,
 * then one at a time, with a single toast that names any somebody else had
 * already decided. There is no bulk reject: a rejection needs its own reason.
 *
 * A decision made offline is kept in the outbox; its row says "Saved on this
 * device" until it has gone, and the list redraws once it has.
 */

export interface InitialOpen {
  readonly id: string;
  /** The server's copy, on a full load; null when it could not be read, `missing` for a 404. */
  readonly detail: ApprovalDetail | null | 'missing';
}

export interface ApprovalsInboxProps {
  readonly scope: ApprovalScope;
  /** The rows; null when the list could not be read. */
  readonly items: readonly ApprovalItem[] | null;
  /** How many wait on this person (for the segment), null when not known. */
  readonly waitingCount: number | null;
  readonly actorId: string | null;
  readonly initialOpen: InitialOpen | null;
}

const loadSheet = () => import('./ApprovalSheet.js');
const loadBulk = () => import('./BulkApprove.js');
const LazySheet = dynamic(loadSheet, { ssr: false });
const LazyBulk = dynamic(loadBulk, { ssr: false });

/** `/api/proxy/api/v1/approvals/<id>/decide` → the id. */
const DECIDE_PATH = /\/approvals\/([^/]+)\/decide$/;

function idOfPath(path: string): string | null {
  const match = DECIDE_PATH.exec(path);
  return match ? decodeURIComponent(match[1]!) : null;
}

function searchWith(open: string | null): string {
  const params = new URLSearchParams(window.location.search);
  if (open) params.set('open', openParam(open));
  else params.delete('open');
  const query = params.toString();
  return `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
}

export function ApprovalsInbox({ scope, items, waitingCount, actorId, initialOpen }: ApprovalsInboxProps): ReactNode {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const { refreshing: liveRefreshing } = useLiveRefresh({ entity: ['approval', 'notification'] });
  const outbox = useOutbox();

  /* ---- Rows ------------------------------------------------------------- */

  // Rows decided (or found already decided) here, gone before the server's next copy says so.
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set());
  const rows = useMemo(() => inListOrder((items ?? []).filter((item) => !gone.has(item.id)), scope), [items, gone, scope]);
  const [queuedHere, setQueuedHere] = useState<ReadonlySet<string>>(() => new Set());
  const queuedInOutbox = useMemo(() => {
    const ids = new Set<string>();
    for (const entry of outbox.items) {
      if (entry.action !== 'decide-approval' || (entry.status !== 'pending' && entry.status !== 'sending')) continue;
      const id = idOfPath(entry.path);
      if (id) ids.add(id);
    }
    return ids;
  }, [outbox.items]);
  const isQueued = useCallback((id: string) => queuedInOutbox.has(id) || queuedHere.has(id), [queuedInOutbox, queuedHere]);
  // Ticked rows, by id (only on *To decide*, and never one whose decision is already waiting to send).
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());

  // A decision that waited in the outbox has gone: the server's list is the truth again.
  const previouslyQueued = useRef(queuedInOutbox);
  useEffect(() => {
    const sent = [...previouslyQueued.current].some((id) => !queuedInOutbox.has(id));
    previouslyQueued.current = queuedInOutbox;
    if (sent) {
      setQueuedHere(new Set());
      startRefresh(() => router.refresh());
    }
  }, [queuedInOutbox, router]);

  /* ---- Focus after something leaves --------------------------------------- */

  const listRef = useRef<HTMLUListElement | null>(null);
  const focusAfter = useRef<number | null>(null);

  /* ---- The sheet (?open=approval:<id>) ------------------------------------ */

  const [openId, setOpenId] = useState<string | null>(initialOpen?.id ?? null);
  // What the sheet shows: kept after it closes, so it stays mounted and animates away (and gives focus back) rather than vanishing.
  const [shownId, setShownId] = useState<string | null>(initialOpen?.id ?? null);
  // Opened here, so closing goes Back (the entry we pushed); opened from a link, closing replaces the URL.
  const openedHere = useRef(false);
  const afterBack = useRef<(() => void) | null>(null);
  // The sheet's item in a decision's aftermath: somebody else had decided it.
  const stale = useRef(new Set<string>());

  useEffect(() => {
    const onPop = (): void => {
      openedHere.current = false;
      const id = openIdOf(new URLSearchParams(window.location.search).get('open'));
      setOpenId(id);
      if (id) setShownId(id);
      const then = afterBack.current;
      afterBack.current = null;
      then?.();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const prefetchSheet = useCallback(() => void loadSheet().catch(() => undefined), []);
  useEffect(() => {
    if (typeof window.requestIdleCallback !== 'function') return;
    const handle = window.requestIdleCallback(prefetchSheet, { timeout: 6000 });
    return () => window.cancelIdleCallback(handle);
  }, [prefetchSheet]);

  const open = (id: string): void => {
    setShownId(id);
    setOpenId(id);
    openedHere.current = true;
    window.history.pushState(null, '', searchWith(id));
  };

  const refresh = useCallback(() => startRefresh(() => router.refresh()), [router]);

  /** Closes the sheet and, once the URL has settled, runs `then` (a redraw). */
  const closeSheet = (then?: () => void): void => {
    setOpenId(null);
    if (openedHere.current) {
      openedHere.current = false;
      afterBack.current = then ?? null;
      window.history.back();
      // If Back never arrives (the entry was replaced meanwhile), still redraw.
      if (then) {
        window.setTimeout(() => {
          if (afterBack.current === then) {
            afterBack.current = null;
            then();
          }
        }, 600);
      }
    } else {
      window.history.replaceState(null, '', searchWith(null));
      then?.();
    }
  };

  const indexOf = (id: string): number => rows.findIndex((row) => row.id === id);

  const onSheetOpenChange = (next: boolean): void => {
    if (next || !openId) return;
    const id = openId;
    if (stale.current.has(id)) {
      // Already decided elsewhere: it leaves the list now, and the list is read again.
      stale.current.delete(id);
      focusAfter.current = Math.max(0, indexOf(id));
      setGone((current) => new Set(current).add(id));
      closeSheet(refresh);
      return;
    }
    if (isQueued(id) && scope === 'waiting') {
      // Their decision is made (it waits on this device); focus moves on to the next one.
      const index = indexOf(id);
      if (index >= 0 && index + 1 < rows.length) focusAfter.current = index + 1;
    }
    closeSheet();
  };

  const onSettled = (id: string, outcome: DecisionOutcome, title: string): void => {
    if (outcome.kind === 'queued') {
      setQueuedHere((current) => new Set(current).add(id));
      setSelected((current) => without(current, [id]));
      void outbox.refresh();
      return;
    }
    if (outcome.kind === 'conflict') {
      stale.current.add(id);
      return;
    }
    notify(decidedToast(outcome.decision), { tone: 'success', description: title, id: 'approval-decided' });
    focusAfter.current = Math.max(0, indexOf(id));
    setGone((current) => new Set(current).add(id));
    setSelected((current) => without(current, [id]));
    closeSheet(refresh);
  };

  /* ---- Selection and bulk approve ---------------------------------------- */

  const selectable = scope === 'waiting' ? rows.filter((row) => !isQueued(row.id)) : [];
  const chosen = selectable.filter((row) => selected.has(row.id));
  const allChosen = selectable.length > 0 && chosen.length === selectable.length;
  const [bulkWanted, setBulkWanted] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const bulkKeys = useRef(new Map<string, string>());
  const keyFor = useCallback((id: string) => {
    let key = bulkKeys.current.get(id);
    if (!key) {
      key = newIdempotencyKey();
      bulkKeys.current.set(id, key);
    }
    return key;
  }, []);

  const toggle = (id: string, on: boolean): void =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const onBulkDone = (results: readonly BulkResult[]): void => {
    const summary = bulkSummary(results);
    notify(summary.title, { tone: summary.tone, ...(summary.description ? { description: summary.description } : {}) });
    const leaving = results.filter((result) => result.outcome === 'sent' || result.outcome === 'conflict').map((result) => result.id);
    const kept = results.filter((result) => result.outcome === 'failed').map((result) => result.id);
    const queued = results.filter((result) => result.outcome === 'queued').map((result) => result.id);
    for (const result of results) if (result.outcome !== 'failed') bulkKeys.current.delete(result.id);
    const first = results[0] ? indexOf(results[0].id) : -1;
    focusAfter.current = Math.max(0, first);
    setGone((current) => new Set([...current, ...leaving]));
    if (queued.length > 0) {
      setQueuedHere((current) => new Set([...current, ...queued]));
      void outbox.refresh();
    }
    setSelected(new Set(kept));
    setBulkOpen(false);
    if (leaving.length > 0) refresh();
  };

  // Rows that left the list (decided, or found already decided) leave the selection too.
  useEffect(() => {
    setSelected((current) => {
      const present = new Set(rows.map((row) => row.id));
      const next = [...current].filter((id) => present.has(id) && !isQueued(id));
      return next.length === current.size ? current : new Set(next);
    });
  }, [rows, isQueued]);

  // Focus moves on once the row has gone and the sheet (or the dialog) has closed.
  useEffect(() => {
    if (focusAfter.current === null || openId !== null || bulkOpen) return;
    const index = focusAfter.current;
    focusAfter.current = null;
    const buttons = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-approval-control="open"]') ?? [])];
    const target = buttons[Math.min(index, buttons.length - 1)] ?? document.querySelector<HTMLElement>('.app-Approvals__title');
    target?.focus();
  });

  /* ---- Keyboard: ↑ ↓ Home End between rows, Escape clears the selection ---- */

  const onListKeyDown = (event: KeyboardEvent<HTMLUListElement>): void => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Escape' && selected.size > 0) {
      event.preventDefault();
      setSelected(new Set());
      announce('Selection cleared');
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const control = (event.target as HTMLElement).closest<HTMLElement>('[data-approval-control]');
    const kind = control?.dataset.approvalControl;
    if (!control || !kind) return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>(`[data-approval-control="${kind}"]`)].filter(
      (element) => !(element as HTMLInputElement).disabled,
    );
    const index = controls.indexOf(control);
    const next =
      event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1 : event.key === 'ArrowDown' ? index + 1 : index - 1;
    const target = controls[next];
    if (!target || next === index) return;
    event.preventDefault();
    target.focus();
  };

  /* ---- Render ------------------------------------------------------------ */

  // A decision waiting on this device is made, as far as the person is concerned: it is not counted as still to decide.
  const count = scope === 'waiting' ? rows.filter((row) => !isQueued(row.id)).length : waitingCount;
  const options = SCOPES.map((option) => ({
    value: option.value,
    label: option.label,
    href: scopeHref(option.value),
    ...(option.value === 'waiting' && count && count > 0 ? { count } : {}),
  }));

  const shownItem = shownId ? ((items ?? []).find((item) => item.id === shownId) ?? null) : null;
  const busy = refreshing || liveRefreshing;

  let body: ReactNode;
  if (!items) {
    body = <RetryBanner what={scope === 'waiting' ? 'what’s waiting on you' : 'what you’ve decided'} />;
  } else if (rows.length === 0) {
    const copy = emptyFor(scope);
    body = (
      <EmptyState
        size="md"
        headingLevel={2}
        tone={copy.tone}
        icon={copy.icon}
        title={copy.title}
        description={copy.description}
        {...(scope === 'waiting'
          ? {
              action: (
                <Button variant="secondary" href={scopeHref('decided')}>
                  See what you’ve decided
                </Button>
              ),
            }
          : {})}
      />
    );
  } else {
    body = (
      <>
        {scope === 'waiting' && selectable.length > 1 ? (
          <div className="app-Approvals__selectAll">
            <Checkbox
              label={`Select all ${selectable.length}`}
              checked={allChosen}
              indeterminate={chosen.length > 0 && !allChosen}
              onChange={(event) => setSelected(event.target.checked ? new Set(selectable.map((row) => row.id)) : new Set())}
            />
          </div>
        ) : null}
        <ul
          ref={listRef}
          className="app-Approvals__list"
          aria-label={scope === 'waiting' ? 'Waiting on your decision' : 'Decided'}
          onKeyDown={onListKeyDown}
        >
          {rows.map((row) => (
            <ApprovalRow
              key={row.id}
              item={row}
              scope={scope}
              queued={isQueued(row.id)}
              selected={selected.has(row.id)}
              onSelect={(on) => toggle(row.id, on)}
              onOpen={() => open(row.id)}
              onIntent={prefetchSheet}
            />
          ))}
        </ul>
      </>
    );
  }

  return (
    <>
      <SegmentedControl mode="nav" label="Show approvals" options={options} value={scope} className="app-Approvals__scopes" />
      <div className="app-Approvals__results" aria-busy={busy || undefined}>
        {busy ? <ProgressBar size="sm" label="Updating your approvals" labelHidden className="app-Approvals__progress" /> : null}
        {body}
      </div>

      {chosen.length > 0 ? (
        <div className="app-Approvals__bulk" role="region" aria-label="Selected approvals">
          <p className="app-Approvals__bulkCount" aria-live="polite">
            {chosen.length} selected
          </p>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
          <Button
            variant="primary"
            size="sm"
            iconStart="check"
            onPointerEnter={() => void loadBulk().catch(() => undefined)}
            onFocus={() => void loadBulk().catch(() => undefined)}
            onClick={() => {
              setBulkWanted(true);
              setBulkOpen(true);
            }}
          >
            Approve {chosen.length}
          </Button>
        </div>
      ) : null}

      {shownId ? (
        <LazySheet
          key={shownId}
          open={openId === shownId}
          onOpenChange={onSheetOpenChange}
          approvalId={shownId}
          item={shownItem}
          scope={scope}
          actorId={actorId}
          queued={isQueued(shownId)}
          initialDetail={initialOpen && initialOpen.id === shownId ? initialOpen.detail : undefined}
          onSettled={(outcome: DecisionOutcome, title: string) => onSettled(shownId, outcome, title)}
        />
      ) : null}

      {bulkWanted ? <LazyBulk open={bulkOpen} onOpenChange={setBulkOpen} items={chosen} keyFor={keyFor} onDone={onBulkDone} /> : null}
    </>
  );
}

function without(set: ReadonlySet<string>, ids: readonly string[]): ReadonlySet<string> {
  if (!ids.some((id) => set.has(id))) return set;
  const next = new Set(set);
  for (const id of ids) next.delete(id);
  return next;
}

/* -------------------------------------------------------------------- Row */

interface ApprovalRowProps {
  readonly item: ApprovalItem;
  readonly scope: ApprovalScope;
  readonly queued: boolean;
  readonly selected: boolean;
  onSelect(on: boolean): void;
  onOpen(): void;
  /** The pointer or focus arrived: fetch the sheet's code now. */
  onIntent(): void;
}

function ApprovalRow({ item, scope, queued, selected, onSelect, onOpen, onIntent }: ApprovalRowProps): ReactNode {
  const what = whatLine(item);
  const progress = progressLine(item);
  const pill = queued
    ? { label: 'Saved on this device', tone: 'info' as const, icon: 'cloud-off' as const }
    : scope === 'waiting'
      ? waitingPill(item)
      : outcomePill(item);
  return (
    <li className="app-ApprovalRow" data-selected={selected || undefined}>
      {scope === 'waiting' ? (
        <span className="app-ApprovalRow__select">
          <Checkbox
            label={`Select ‘${item.title}’`}
            labelHidden
            checked={selected}
            disabled={queued}
            data-approval-control="select"
            onChange={(event) => onSelect(event.target.checked)}
          />
        </span>
      ) : null}
      <button
        type="button"
        className="app-ApprovalRow__open"
        aria-haspopup="dialog"
        data-approval-control="open"
        onClick={onOpen}
        onPointerEnter={onIntent}
        onFocus={onIntent}
      >
        <span className="app-ApprovalRow__title">{item.title}</span>
        {what ? <span className="app-ApprovalRow__what">{what}</span> : null}
        <span className="app-ApprovalRow__meta">
          {scope === 'decided' && item.decidedAt ? (
            <span>
              Decided <RelativeTime date={item.decidedAt} relativeStyle="long" absoluteStyle="date" />
            </span>
          ) : (
            <span>
              Requested <RelativeTime date={item.requestedAt} relativeStyle="long" absoluteStyle="date" />
            </span>
          )}
          {scope === 'waiting' && item.dueAt ? (
            <span>
              due <DueText at={item.dueAt} />
            </span>
          ) : null}
          {progress ? <span>{progress}</span> : null}
        </span>
        {pill ? <StatusPill className="app-ApprovalRow__pill" size="sm" label={pill.label} tone={pill.tone} icon={pill.icon} /> : null}
      </button>
    </li>
  );
}

/**
 * "Fri 14:00", "14:30 today": a due time as a person reads a deadline, in
 * their zone. The server has no clock to share, so it (and hydration) print
 * the date; the words follow straight after.
 */
function DueText({ at }: { readonly at: string }): ReactNode {
  const { locale, timeZone } = useItsm();
  const now = useNow();
  const text = now === null ? formatDateTime(at, { locale, timeZone, style: 'datetime' }) : (replyByPhrase(at, new Date(now), locale, timeZone) ?? at);
  return (
    <time dateTime={at} suppressHydrationWarning>
      {text}
    </time>
  );
}
