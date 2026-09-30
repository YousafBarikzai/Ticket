'use client';

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button, EmptyState, ProgressBar, SearchField, SegmentedControl, VisuallyHidden, announce } from '@itsm/ui';
import { api } from '../client/api.js';
import { useLiveRefresh } from '../client/live.js';
import { useHelpFlow } from '../components/PortalShell.js';
import { RequestRow } from '../components/RequestRow.js';
import { emptyFor, filterFor, inListOrder, itemOf, listHref, mergeRows, PAGE_SIZE, SCOPES, type RequestItem, type Scope } from './model.js';
import { RetryBanner } from './RetryBanner.js';
import { useConfirmFixed } from './useConfirmFixed.js';
import { useOnline } from './hooks.js';

/**
 * My requests, below the heading (SPEC §6.3 `/tickets`): the scope
 * (Open · Needs you (n) · Resolved · All) as links that live in the URL, a
 * search bound to `?q=`, and the list — what needs the requester first, then
 * what is going on, then what waits for their word, then what is finished.
 *
 * Changing the scope is a link; searching replaces the URL in a transition,
 * so the list stays on screen (busy, with a thin progress line, never
 * dimmed) until the server's answer arrives. *Load more* appends the next
 * page from the cursor, says how many arrived, and puts focus on the first
 * of them. A reply or a change from the desk redraws the list a second after
 * the last notice.
 *
 * Rows are `RequestRow`: one link per request, and beside it, for the two
 * states that are the requester's to move, the move itself — *Reply*, or
 * *Yes, it's fixed* / *No*.
 */

export interface RequestsBrowserProps {
  readonly scope: Scope;
  readonly q: string;
  /** How many wait on the requester; null when it could not be counted. */
  readonly needsCount: { readonly count: number; readonly capped: boolean } | null;
  /** The first page; null when it could not be read. */
  readonly initial: { readonly rows: readonly RequestItem[]; readonly nextCursor: string | null } | null;
  /** Requests with an unread notification. */
  readonly unread: readonly string[];
}

export function RequestsBrowser({ scope, q, needsCount, initial, unread }: RequestsBrowserProps): ReactNode {
  const router = useRouter();
  const [searching, startSearch] = useTransition();
  // Pages appended by Load more, for the scope and search they were read for: a new scope or search starts again from its first page.
  const listKey = `${scope}|${q}`;
  const [appended, setAppended] = useState<{ readonly key: string; readonly rows: readonly RequestItem[]; readonly cursor: string | null }>({
    key: listKey,
    rows: [],
    cursor: null,
  });
  const extra = appended.key === listKey ? appended.rows : [];
  const cursor = appended.key === listKey ? appended.cursor : null;
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  /**
   * Where focus goes once the rows have redrawn: a request's own link — the
   * first new row after Load more, a row after "Yes, it's fixed" — or, when
   * that row has left the list, the row now in its place.
   */
  const focusAfter = useRef<{ readonly number: string; readonly index: number } | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const { refreshing } = useLiveRefresh({ entity: 'ticket' });

  const rows = useMemo(() => inListOrder(mergeRows(initial?.rows ?? [], extra)), [initial, extra]);
  const nextCursor = extra.length > 0 ? cursor : (initial?.nextCursor ?? null);
  const unreadIds = useMemo(() => new Set(unread), [unread]);

  useEffect(() => {
    const wanted = focusAfter.current;
    if (!wanted) return;
    focusAfter.current = null;
    const links = [...(listRef.current?.querySelectorAll<HTMLElement>('.app-RequestRow__link') ?? [])];
    const target = links.find((link) => link.getAttribute('href') === requestHref(wanted.number)) ?? links[Math.min(wanted.index, links.length - 1)];
    (target ?? document.querySelector<HTMLElement>('main h1'))?.focus();
  }, [rows]);

  const moved = (number: string): void => {
    focusAfter.current = { number, index: Math.max(0, rows.findIndex((row) => row.number === number)) };
  };

  // What the field last sent, as typed: the URL keeps the trimmed words, and handing those back
  // would take the space off the end of "vpn " while it is being typed.
  const sent = useRef<{ readonly raw: string; readonly words: string } | null>(null);
  const fieldValue = sent.current && sent.current.words === q ? sent.current.raw : q;

  const search = (value: string): void => {
    const words = value.trim();
    const previous = sent.current?.words ?? q;
    sent.current = { raw: value, words };
    if (words === previous) return;
    startSearch(() => router.replace(listHref(scope, words), { scroll: false }));
  };

  const loadMore = async (): Promise<void> => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setMoreFailed(false);
    try {
      const page = await api.myTickets({ ...filterFor(scope), ...(q ? { q } : {}), limit: PAGE_SIZE, cursor: nextCursor });
      const known = new Set(rows.map((row) => row.id));
      const fresh = page.data.map(itemOf).filter((row) => !known.has(row.id));
      if (fresh[0]) focusAfter.current = { number: fresh[0].number, index: 0 };
      setAppended((current) => ({
        key: listKey,
        rows: [...(current.key === listKey ? current.rows : []), ...fresh],
        cursor: page.nextCursor,
      }));
      announce(fresh.length === 1 ? '1 more request' : `${fresh.length} more requests`);
    } catch {
      setMoreFailed(true);
    } finally {
      setLoadingMore(false);
    }
  };

  const options = SCOPES.map((option) => ({
    value: option.value,
    label: option.label,
    href: listHref(option.value, q),
    ...(option.value === 'needs' && needsCount && needsCount.count > 0 ? { count: needsCount.count } : {}),
  }));

  let body: ReactNode;
  if (!initial) {
    body = <RetryBanner what="your requests" />;
  } else if (rows.length === 0) {
    body = <Empty scope={scope} q={q} />;
  } else {
    body = (
      <>
        <ul ref={listRef} className="app-RequestList" aria-label={q ? `Requests matching ‘${q}’` : 'Your requests'}>
          {rows.map((row) => (
            <RequestRow
              key={row.id}
              ticket={row}
              unread={unreadIds.has(row.id)}
              {...(row.status === 'pending_requester' || row.status === 'resolved' ? { actions: <RowActions row={row} onMoved={moved} /> } : {})}
            />
          ))}
        </ul>
        {nextCursor ? (
          <div className="app-Requests__more">
            <p className="app-Requests__caption">Showing {rows.length} · more available</p>
            {moreFailed ? <p className="app-Requests__caption app-Requests__caption--problem">Couldn’t load more. Try again.</p> : null}
            <Button variant="secondary" loading={loadingMore} loadingLabel="Loading" onClick={() => void loadMore()}>
              Load more
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  const busy = searching || refreshing;
  return (
    <>
      <div className="app-Requests__controls">
        <SegmentedControl mode="nav" label="Show requests" options={options} value={scope} fullWidth className="app-Requests__scopes" />
        <SearchField
          className="app-Requests__search"
          label="Search your requests"
          labelHidden
          value={fieldValue}
          placeholder="Search by words or reference"
          loading={searching}
          onValueChange={search}
          onSubmit={search}
        />
      </div>
      <div className="app-Requests__results" aria-busy={busy || undefined}>
        {busy ? <ProgressBar size="sm" label="Updating your requests" labelHidden className="app-Requests__progress" /> : null}
        {body}
      </div>
    </>
  );
}

/* ------------------------------------------------------------ Row actions */

/**
 * The requester's own move, beside the row's link (never inside it, X-62):
 * *Reply* to a question, or *Yes, it's fixed* / *No* on a resolved request.
 * Each names its request for a screen reader, so a list of them is not a
 * column of identical buttons.
 */
/** Where a request's row leads: the same address `RequestRow` links to. */
function requestHref(number: string): string {
  return `/tickets/${encodeURIComponent(number)}`;
}

function RowActions({ row, onMoved }: { readonly row: RequestItem; readonly onMoved: (number: string) => void }): ReactNode {
  const href = requestHref(row.number);
  if (row.status === 'pending_requester') {
    return (
      <Button size="sm" variant="tinted" iconStart="reply" href={`${href}#reply`}>
        Reply<VisuallyHidden> to {row.title}</VisuallyHidden>
      </Button>
    );
  }
  return <FixedActions row={row} href={href} onMoved={onMoved} />;
}

function FixedActions({ row, href, onMoved }: { readonly row: RequestItem; readonly href: string; readonly onMoved: (number: string) => void }): ReactNode {
  const online = useOnline();
  const fixed = useConfirmFixed(row.number, row.version, { onSettled: () => onMoved(row.number) });
  if (fixed.acknowledged) {
    return (
      <p className="app-Requests__thanks" role="status">
        Thanks for confirming
      </p>
    );
  }
  return (
    <>
      <Button
        size="sm"
        variant="tinted"
        loading={fixed.pending}
        loadingLabel="Closing"
        {...(online ? {} : { disabledReason: 'Needs a connection' })}
        onClick={() => void fixed.confirm()}
      >
        Yes, it’s fixed<VisuallyHidden>: {row.title}</VisuallyHidden>
      </Button>
      <Button size="sm" variant="secondary" href={`${href}?fixed=no`}>
        No<VisuallyHidden>, {row.title} is still broken</VisuallyHidden>
      </Button>
    </>
  );
}

/* ------------------------------------------------------------------ Empty */

function Empty({ scope, q }: { readonly scope: Scope; readonly q: string }): ReactNode {
  const helpFlow = useHelpFlow();
  const copy = emptyFor(scope, q);
  const actions: ReactNode[] = [];
  if (copy.next === 'new-request' && helpFlow.available) {
    actions.push(
      <Button key="new" variant="tinted" iconStart="plus" onClick={() => helpFlow.open()}>
        New request
      </Button>,
    );
  }
  if (copy.next === 'clear-search') {
    actions.push(
      <Button key="clear" variant="secondary" href={listHref(scope)}>
        Clear search
      </Button>,
    );
  }
  if (copy.widen) {
    actions.push(
      <Button key="all" variant="ghost" href={listHref('all', q)}>
        {q ? 'Search all your requests' : 'See all your requests'}
      </Button>,
    );
  }
  return (
    <EmptyState
      size="md"
      headingLevel={2}
      tone={copy.tone}
      icon={copy.icon}
      title={copy.title}
      description={copy.description}
      {...(actions[0] ? { action: actions[0] } : {})}
      {...(actions[1] ? { secondaryAction: actions[1] } : {})}
    />
  );
}
