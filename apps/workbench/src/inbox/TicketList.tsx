'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { keepPreviousData, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useLive } from '@itsm/pwa/live';
import { ApiError } from '@itsm/sdk';
import {
  Banner,
  EmptyState,
  ProblemState,
  ProgressBar,
  RelativeTime,
  SkeletonList,
  notify,
  useItsm,
  useNow,
  useTheme,
  type Problem,
} from '@itsm/ui';
import { isTextEntry, useCollectionKeyboard, type ActivateHow } from '@itsm/ui/a11y';
import { LoadMore } from '@itsm/ui/data';
import { formatDateTime } from '@itsm/ui/format';
import type { MenuItemSpec } from '@itsm/ui/overlays';
import { BottomDock } from '@itsm/ui/shell';
import { currentTicket, fetchDeskList } from '../client/desk-list.js';
import { deskKeys, shouldRetry } from '../client/query-client.js';
import type { DeskCounts } from './counts.js';
import { BulkReportSheet, InboxBulkBar, canChangeFromList, useTicketWrites, type WriteResult } from './InboxBulkBar.js';
import { personName, problemOf, stateLabel, type PeopleMap } from './presentation.js';
import {
  EMPTY_LIST,
  LIST_CONTEXT_KEY,
  PRIORITIES,
  TICKET_NOUN,
  applyServer,
  dropMoved,
  isUnread,
  listContext,
  listSearch,
  markSeen,
  movedLabel,
  newTicketsMessage,
  parseSeen,
  PREFETCH_INTENT_MS,
  peopleOf,
  prefetchTicket,
  reconcileLive,
  rowsOf,
  seenStorageKey,
  type BulkChange,
  type ListPage,
  type ListRow,
  type ListState,
  type SeenRecord,
} from './queries.js';
import { TicketRow } from './TicketRow.js';
import { transitionsFrom } from '../queue/transitions.js';
import { PAGE_SIZE, type InboxView } from './views.js';

/**
 * The inbox list (SPEC §6.2): keyboard-first, calm, and live without ever
 * moving under the person.
 *
 * - **Data.** One infinite query per view and filter set, seeded by the
 *   server render and fed by `GET /api/desk/list`. A filter change is a new
 *   key: the old rows stay (with the refresh line) until the new ones land.
 * - **Live.** A ticket notice (debounced 1 s) invalidates the view. What
 *   comes back is folded in by `reconcileLive`: rows change in place (a few
 *   flash), rows that left stay put with a still label until they scroll out
 *   of sight or the person acts, and new rows wait behind "3 new · Show". The
 *   live region `[data-live="inbox"]` says "3 new tickets", at most once in
 *   five seconds, and says nothing when a refresh changed nothing.
 * - **Keyboard.** `useCollectionKeyboard`: one tab stop; ↑↓ and `j`/`k`;
 *   ←→ between a row's checkbox, link and ⋯; `x`/Space; Shift to extend;
 *   mod+A; Enter opens beside the list; `o` full page; mod+Enter a new tab;
 *   `.` the row's menu; Escape clears; `i` assigns to you.
 * - **Selection.** Checkboxes on hover and focus, on every row once one is
 *   ticked, and through "Select" on touch; the bulk bar docks at the foot.
 */

export interface InboxPermissions {
  readonly read: boolean;
  readonly assign: boolean;
  readonly transition: boolean;
  readonly update: boolean;
  readonly readPeople: boolean;
}

export interface ListCount {
  readonly shown: number;
  readonly hasMore: boolean;
}

/**
 * How an open was asked for: beside the list with focus moving there (Enter),
 * beside the list with focus staying on the row (a click), as the full page
 * (`o`), or in a new tab (mod+Enter).
 */
export type OpenHow = 'pane' | 'select' | 'page' | 'newTab';

export interface TicketListProps {
  readonly view: InboxView;
  readonly me: string | null;
  readonly meName?: string;
  readonly can: InboxPermissions;
  /** Team names by id, for the team on each row. */
  readonly teamNames?: Readonly<Record<string, string>>;
  /** Names known before the first page (filter chips), merged with each page's. */
  readonly people?: PeopleMap;
  /** The number of the ticket open beside the list. */
  readonly selected: string | null;
  /** A failure from the server render: shown in place, and not retried until the person asks. */
  readonly problem?: Problem | null;
  /** The server's clock when it rendered, so deadlines read the same before and after hydration. */
  readonly renderedAt?: number;
  /** Keeps this person's unread record apart from the next person's on a shared machine. */
  readonly storageScope?: string | null;
  /** Touch: a tap selects instead of opening ("Select" in the header). */
  readonly selectMode?: boolean;
  readonly onOpen: (row: ListRow, how: OpenHow) => void;
  /** The keyboard moved to another row: the detail pane follows (the caller waits for a pause). */
  readonly onFollow?: (row: ListRow) => void;
  /** Whether the detail pane is showing (wide enough): a click then opens beside the list. */
  readonly paneVisible?: () => boolean;
  readonly onCount?: (count: ListCount) => void;
  readonly onClearFilters?: () => void;
}

/** A burst of notices is one refresh (SPEC §6.2). */
export const LIVE_SETTLE_MS = 1_000;
/** At most one "N new tickets" in this window (SPEC §6.2). */
export const ANNOUNCE_INTERVAL_MS = 5_000;
/** How long a changed row's highlight lasts (SPEC §1.9). */
export const FLASH_MS = 1_200;

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

interface Shown {
  /** The server rows last folded in. */
  readonly source: readonly ListRow[];
  readonly search: string;
  readonly list: ListState;
  readonly hadMore: boolean;
  /** Whether `source` was an answer at all: the first one is shown as it is, not held back as "new". */
  readonly hadData: boolean;
  /** `apply`: the next data is the answer to something the person did, shown as it is. */
  readonly mode: 'live' | 'apply';
}

function readSeen(key: string): SeenRecord | null {
  try {
    return parseSeen(window.localStorage.getItem(key));
  } catch {
    return null;
  }
}

function writeSeen(key: string, record: SeenRecord): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(record));
  } catch {
    // Blocked storage: unread marks last for this page only.
  }
}

/**
 * The inbox's own polite region, always in the tree (a region added with its
 * first message is a message most screen readers never read). One message
 * per window: the first at once, the newest of a burst when the window
 * closes, a repeat of what was just said never.
 */
function useInboxAnnouncer(): { readonly message: string; announce(message: string): void } {
  const { prefs } = useTheme();
  const enabled = prefs.announceLive !== 'off';
  const [message, setMessage] = useState('');
  const state = useRef<{ last: number; waiting: string | null; timer: ReturnType<typeof setTimeout> | null; said: string | null }>({
    last: Number.NEGATIVE_INFINITY,
    waiting: null,
    timer: null,
    said: null,
  });
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(
    () => () => {
      if (state.current.timer) clearTimeout(state.current.timer);
    },
    [],
  );

  const announce = useCallback((next: string) => {
    if (!enabledRef.current) return;
    const current = state.current;
    const speak = (text: string): void => {
      current.last = Date.now();
      current.said = text;
      setMessage(text);
    };
    const since = Date.now() - current.last;
    if (since >= ANNOUNCE_INTERVAL_MS && !current.timer) {
      speak(next);
      return;
    }
    current.waiting = next;
    if (current.timer) return;
    current.timer = setTimeout(() => {
      current.timer = null;
      const waiting = current.waiting;
      current.waiting = null;
      if (waiting && waiting !== current.said && enabledRef.current) speak(waiting);
    }, Math.max(0, ANNOUNCE_INTERVAL_MS - since));
  }, []);

  return { message, announce };
}

export function TicketList({
  view,
  me,
  meName = 'You',
  can,
  teamNames = {},
  people: knownPeople = {},
  selected,
  problem: serverProblem = null,
  renderedAt,
  storageScope = null,
  selectMode = false,
  onOpen,
  onFollow,
  paneVisible = () => false,
  onCount,
  onClearFilters,
}: TicketListProps): ReactNode {
  const client = useQueryClient();
  const { locale, timeZone } = useItsm();
  const { prefs } = useTheme();
  const search = listSearch(view);
  const queryKey = useMemo(() => deskKeys.view(view.key, search), [view.key, search]);

  /* ---------------------------------------------------------------- Data */

  const [retried, setRetried] = useState(false);
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam, signal }) => fetchDeskList(search, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last: ListPage) => last.nextCursor,
    placeholderData: keepPreviousData,
    enabled: can.read && (serverProblem === null || retried),
    retry: shouldRetry,
  });
  const serverRows = useMemo(() => rowsOf(query.data), [query.data]);
  const people = useMemo(() => peopleOf(query.data, knownPeople), [query.data, knownPeople]);
  const hasMore = query.hasNextPage;
  const isPlaceholder = query.isPlaceholderData;
  const cachedAt = query.data?.pages.find((page) => page.cachedAt)?.cachedAt ?? null;

  const [shown, setShown] = useState<Shown>(() => ({
    source: serverRows,
    search,
    list: applyServer(EMPTY_LIST, serverRows),
    hadMore: hasMore,
    hadData: query.data !== undefined,
    mode: 'live',
  }));
  const rows = shown.list.rows;

  /* --------------------------------------------------- Selection and focus */

  const selectable = can.read && canChangeFromList(can);
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set());
  const rowElements = useRef<(HTMLLIElement | null)[]>([]);
  const listElement = useRef<HTMLUListElement | null>(null);
  const activeId = useRef<string | null>(null);
  const navByKey = useRef(false);
  const selectedId = useMemo(() => rows.find((entry) => entry.row.number === selected)?.row.id ?? null, [rows, selected]);

  /** Rows that must not vanish under the person: the open ticket, the focused row, what they ticked. */
  const keepIds = useCallback((): Set<string> => {
    const keep = new Set<string>(checked);
    if (selectedId) keep.add(selectedId);
    const focused = typeof document === 'undefined' ? null : document.activeElement;
    if (activeId.current && focused && listElement.current?.contains(focused)) keep.add(activeId.current);
    return keep;
  }, [checked, selectedId]);

  // Fold each answer in: a new view is shown as it is; an answer to the
  // person's own action is applied; anything else is live, and moves nothing.
  const hasData = query.data !== undefined;
  useIsomorphicLayoutEffect(() => {
    if (isPlaceholder) return;
    if (shown.source === serverRows && shown.search === search) return;
    const keep = keepIds();
    setShown((previous) => {
      if (previous.search !== search || !previous.hadData) {
        return { source: serverRows, search, list: applyServer(EMPTY_LIST, serverRows), hadMore: hasMore, hadData: hasData, mode: 'live' };
      }
      const list = previous.mode === 'apply' ? applyServer(previous.list, serverRows, keep) : reconcileLive(previous.list, serverRows, previous.hadMore);
      return { source: serverRows, search, list, hadMore: hasMore, hadData: hasData, mode: 'live' };
    });
  }, [serverRows, search, isPlaceholder, hasMore, hasData, keepIds, shown.source, shown.search]);

  // A new view starts with nothing ticked.
  useEffect(() => {
    setChecked(new Set());
  }, [search]);

  // Ticked rows that have gone (after an action, say) leave the selection.
  useEffect(() => {
    setChecked((current) => {
      if (current.size === 0) return current;
      const present = new Set(rows.map((entry) => entry.row.id));
      const next = new Set([...current].filter((id) => present.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [rows]);

  const applyNext = useCallback(() => setShown((previous) => ({ ...previous, mode: 'apply' })), []);

  /* ------------------------------------------------------------ Counting */

  const current = rows.filter((entry) => !entry.moved).length;
  useEffect(() => {
    onCount?.({ shown: current, hasMore });
  }, [onCount, current, hasMore]);

  /* ----------------------------------------------------------------- Live */

  const { message, announce } = useInboxAnnouncer();
  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const versions = useRef(new Map<string, number>());
  versions.current = new Map(rows.map((entry) => [entry.row.id, entry.row.version]));

  const refresh = useCallback(() => {
    if (liveTimer.current) clearTimeout(liveTimer.current);
    liveTimer.current = setTimeout(() => {
      liveTimer.current = null;
      void client.invalidateQueries({ queryKey });
    }, LIVE_SETTLE_MS);
  }, [client, queryKey]);
  useEffect(
    () => () => {
      if (liveTimer.current) clearTimeout(liveTimer.current);
    },
    [],
  );

  useLive({
    entity: 'ticket',
    enabled: can.read,
    onNotice: (notice) => {
      // A notice about a version this list already shows is its own echo.
      const known = versions.current.get(notice.id);
      if (known !== undefined && notice.version !== undefined && known >= notice.version) return;
      refresh();
    },
    // A gap in the stream is a gap in the list: whatever happened meanwhile is unknown.
    onReconnect: refresh,
  });

  // "3 new tickets": only when the waiting count grows, never for a refresh that changed nothing.
  const heldCount = shown.list.held.length;
  const lastHeld = useRef(heldCount);
  useEffect(() => {
    if (heldCount > lastHeld.current) {
      const text = newTicketsMessage(heldCount);
      if (text) announce(text);
    }
    lastHeld.current = heldCount;
  }, [heldCount, announce]);

  // A row changed in place is highlighted briefly — colour only, nothing moves.
  const [flashing, setFlashing] = useState<ReadonlySet<string>>(() => new Set());
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const changed = shown.list.changed;
  useEffect(() => {
    if (changed.length === 0) return;
    setFlashing(new Set(changed));
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => {
      flashTimer.current = null;
      setFlashing(new Set());
    }, FLASH_MS);
  }, [changed]);
  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  // What a row that left the view is now: "Now assigned to Jo".
  const [movedLabels, setMovedLabels] = useState<ReadonlyMap<string, string>>(() => new Map());
  const askedAbout = useRef(new Set<string>());
  useEffect(() => {
    for (const entry of rows) {
      // Back in the view: if it leaves again, it is asked about again.
      if (!entry.moved) askedAbout.current.delete(entry.row.id);
      if (!entry.moved || askedAbout.current.has(entry.row.id)) continue;
      askedAbout.current.add(entry.row.id);
      const before = entry.row;
      currentTicket(before.number)
        .then((after) => movedLabel(before, after, people, me))
        .catch(() => 'No longer in this view')
        .then((label) => setMovedLabels((labels) => new Map(labels).set(before.id, label)));
    }
  }, [rows, people, me]);

  // A row that left the view goes once it is out of sight (never the open or focused one).
  const keepRef = useRef(keepIds);
  keepRef.current = keepIds;
  const movedKey = rows
    .filter((entry) => entry.moved)
    .map((entry) => entry.row.id)
    .join(',');
  useEffect(() => {
    if (!movedKey || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      const keep = keepRef.current();
      for (const entry of entries) {
        const id = entry.target.getAttribute('data-row-id');
        if (!id || entry.isIntersecting || keep.has(id)) continue;
        setShown((previous) => ({ ...previous, list: dropMoved(previous.list, id) }));
      }
    });
    for (const id of movedKey.split(',')) {
      const element = rowElements.current.find((candidate) => candidate?.getAttribute('data-row-id') === id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [movedKey]);

  const showHeld = (): void => {
    const first = shown.list.held[0]?.id;
    setShown((previous) => ({ ...previous, list: applyServer(previous.list, previous.source, keepIds()) }));
    // The person asked to see them: take them to the first one.
    requestAnimationFrame(() => {
      const index = rowElements.current.findIndex((element) => element?.getAttribute('data-row-id') === first);
      if (index >= 0) kbRef.current?.setActiveIndex(index, { focus: true });
    });
  };

  // Where the ticket's ‹ › and "Back to My work" go (this tab only).
  const contextKey = `${view.key}|${search}|${rows.map((entry) => (entry.moved ? '' : entry.row.number)).join(',')}`;
  const contextView = useRef(view);
  contextView.current = view;
  useEffect(() => {
    try {
      window.sessionStorage.setItem(LIST_CONTEXT_KEY, JSON.stringify(listContext(contextView.current, latestRows.current)));
    } catch {
      // Blocked storage: the ticket page falls back to its own way back.
    }
  }, [contextKey]);

  /* --------------------------------------------------------------- Unread */

  const seenKey = seenStorageKey(storageScope);
  const [seen, setSeen] = useState<SeenRecord | null>(null);
  useEffect(() => {
    let record = readSeen(seenKey);
    if (!record) {
      record = { since: new Date().toISOString(), seen: {} };
      writeSeen(seenKey, record);
    }
    setSeen(record);
  }, [seenKey]);
  const markRowsSeen = useCallback(
    (list: readonly { readonly id: string; readonly updatedAt: string }[]) => {
      setSeen((record) => {
        if (!record) return record;
        const next = markSeen(record, list);
        if (next !== record) writeSeen(seenKey, next);
        return next;
      });
    },
    [seenKey],
  );
  const selectedRow = rows.find((entry) => entry.row.id === selectedId)?.row;
  useEffect(() => {
    if (selectedRow) markRowsSeen([selectedRow]);
  }, [selectedRow, markRowsSeen]);

  /* --------------------------------------------------------------- Writes */

  const writes = useTicketWrites({ me, people, onApplied: applyNext });
  const latestRows = useRef(rows);
  latestRows.current = rows;
  const finish = useCallback(
    (result: WriteResult) => {
      markRowsSeen(result.tickets);
      if (result.done.length === 0) return;
      const done = new Set(result.done);
      setChecked((current) => new Set([...current].filter((id) => !done.has(id))));
    },
    [markRowsSeen],
  );
  const change = useCallback((next: BulkChange, targets: readonly ListRow[]) => void writes.run(next, targets).then(finish), [writes, finish]);

  /* ------------------------------------------------------------- Keyboard */

  const checkedRows = useMemo(() => rows.filter((entry) => checked.has(entry.row.id)).map((entry) => entry.row), [rows, checked]);
  const toggle = (index: number): void => {
    const id = rows[index]?.row.id;
    if (!id) return;
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const anchor = useRef<number | null>(null);
  const extend = (from: number, to: number): void => {
    const [start, end] = from <= to ? [from, to] : [to, from];
    const ids = rows.slice(start, end + 1).map((entry) => entry.row.id);
    setChecked((current) => new Set([...current, ...ids]));
  };

  const [menuFor, setMenuFor] = useState<string | null>(null);
  /** The control a row menu was opened from — the row's link after ".", the ⋯ after a click — where focus goes back. */
  const menuReturn = useRef<HTMLElement | null>(null);
  const kb = useCollectionKeyboard({
    count: rows.length,
    getRow: (index) => rowElements.current[index] ?? null,
    columns: selectable ? ['select', 'primary', 'menu'] : ['primary', 'menu'],
    defaultIndex: Math.max(0, rows.findIndex((entry) => entry.row.number === selected)),
    onActivate: (index: number, how: ActivateHow) => {
      const row = rows[index]?.row;
      if (row) onOpen(row, how === 'inPlace' ? 'pane' : how);
    },
    ...(selectable
      ? {
          onToggleSelect: toggle,
          onExtendSelect: extend,
          onSelectAll: () => setChecked(new Set(rows.filter((entry) => !entry.moved).map((entry) => entry.row.id))),
          onClearSelection: () => {
            if (checked.size === 0) return 'none' as const;
            const before = checked;
            setChecked(new Set());
            if (before.size > 3) {
              notify('Selection cleared', {
                tone: 'neutral',
                id: 'inbox-selection',
                undo: async () => setChecked(before),
              });
              return 'confirm' as const;
            }
            return 'cleared' as const;
          },
        }
      : {}),
    onRowMenu: (index: number) => {
      menuReturn.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setMenuFor(rows[index]?.row.id ?? null);
    },
    onActiveChange: (index: number) => {
      const row = rows[index]?.row;
      activeId.current = row?.id ?? null;
      if (row && navByKey.current) onFollow?.(row);
      navByKey.current = false;
      // The rows either side are the next j or k: have their tickets ready.
      for (const neighbour of [rows[index - 1], rows[index + 1]]) if (neighbour) prefetchTicket(client, neighbour.row.number);
    },
  });
  const kbRef = useRef(kb);
  kbRef.current = kb;

  // The tab stop follows its row when rows are added above it or leave.
  useEffect(() => {
    const id = activeId.current;
    if (!id) return;
    const index = rows.findIndex((entry) => entry.row.id === id);
    if (index >= 0 && index !== kbRef.current.activeIndex) kbRef.current.setActiveIndex(index);
  }, [rows]);

  // Opening a ticket from elsewhere (the palette, a link) moves the tab stop to its row.
  useEffect(() => {
    if (!selected) return;
    const index = latestRows.current.findIndex((entry) => entry.row.number === selected);
    if (index >= 0 && index !== kbRef.current.activeIndex) {
      activeId.current = latestRows.current[index]!.row.id;
      kbRef.current.setActiveIndex(index);
    }
  }, [selected]);

  const shortcutsOn = prefs.shortcuts !== 'off';
  const onListKeyDown = (event: KeyboardEvent<HTMLUListElement>): void => {
    const target = event.target as HTMLElement;
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    navByKey.current = plain && (key === 'ArrowDown' || key === 'ArrowUp' || key === 'j' || key === 'k' || key === 'Home' || key === 'End');
    if (key === 'i' && plain && !event.shiftKey && shortcutsOn && can.assign && me && !isTextEntry(target)) {
      const targets = checkedRows.length > 0 ? checkedRows : rows[kb.activeIndex] ? [rows[kb.activeIndex]!.row] : [];
      if (targets.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        change({ kind: 'assign', assigneeId: me, name: meName }, targets);
        return;
      }
    }
    kb.onKeyDown(event);
    navByKey.current = false;
  };

  /* --------------------------------------------------------- Row handlers */

  const latest = useRef({ rows, selectMode, paneVisible, onOpen, kb, toggle, extend, checked });
  latest.current = { rows, selectMode, paneVisible, onOpen, kb, toggle, extend, checked };

  const rowRef = useCallback((index: number, element: HTMLLIElement | null) => {
    rowElements.current[index] = element;
  }, []);

  const onLinkClick = useCallback((index: number, event: MouseEvent<HTMLAnchorElement>) => {
    const { rows: list, selectMode: selecting, paneVisible: visible, onOpen: open, kb: keyboard, toggle: flip } = latest.current;
    const row = list[index]?.row;
    if (!row || event.defaultPrevented) return;
    // A new tab or window is the browser's to open.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (selecting) {
      event.preventDefault();
      flip(index);
      return;
    }
    keyboard.setActiveIndex(index);
    activeId.current = row.id;
    if (!visible()) return;
    event.preventDefault();
    open(row, 'select');
  }, []);

  const onCheck = useCallback((index: number, next: boolean, shift: boolean) => {
    const { rows: list, extend: range, kb: keyboard } = latest.current;
    const id = list[index]?.row.id;
    if (!id) return;
    keyboard.setActiveIndex(index);
    if (shift && anchor.current !== null) {
      range(anchor.current, index);
    } else {
      setChecked((current) => {
        const updated = new Set(current);
        if (next) updated.add(id);
        else updated.delete(id);
        return updated;
      });
    }
    anchor.current = index;
  }, []);

  const intentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (intentTimer.current) clearTimeout(intentTimer.current);
    },
    [],
  );
  const onIntent = useCallback(
    (index: number, resting: boolean) => {
      if (intentTimer.current) clearTimeout(intentTimer.current);
      intentTimer.current = null;
      const number = latest.current.rows[index]?.row.number;
      if (!resting || !number) return;
      intentTimer.current = setTimeout(() => prefetchTicket(client, number), PREFETCH_INTENT_MS);
    },
    [client],
  );

  const onMenuOpenChange = useCallback((index: number, open: boolean) => {
    const id = latest.current.rows[index]?.row.id ?? null;
    if (open) menuReturn.current = rowElements.current[index]?.querySelector<HTMLElement>('[data-itsm-control="menu"]') ?? null;
    setMenuFor(open ? id : null);
  }, []);

  const onMenuKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>) => {
    // In a list, ↑↓ move between rows as from any other control; the menu
    // opens with Enter, Space or ".". Taken here, before the button's own
    // handler would open the menu on ↓.
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !event.metaKey && !event.ctrlKey) {
      navByKey.current = true;
      latest.current.kb.onKeyDown(event as unknown as KeyboardEvent<HTMLElement>);
      navByKey.current = false;
    }
  }, []);

  const menuItemsFor = (row: ListRow): MenuItemSpec[] => {
    const items: MenuItemSpec[] = [
      { id: 'open', label: 'Open', onSelect: () => onOpen(row, 'select') },
      { id: 'page', label: 'Open full page', shortcut: 'o', onSelect: () => onOpen(row, 'page') },
      { id: 'tab', label: 'Open in new tab', icon: 'external-link', onSelect: () => onOpen(row, 'newTab') },
      {
        id: 'copy',
        label: 'Copy link',
        icon: 'copy',
        onSelect: () => {
          const url = new URL(`/tickets/${row.number}`, window.location.origin).toString();
          void navigator.clipboard
            ?.writeText(url)
            .then(() => notify('Link copied', { tone: 'success', id: 'inbox-copy' }))
            .catch(() => notify('Couldn’t copy the link', { tone: 'warning', id: 'inbox-copy' }));
        },
      },
    ];
    const act: MenuItemSpec[] = [];
    if (can.assign && me && row.assigneeId !== me) {
      act.push({ id: 'assign-me', label: 'Assign to me', icon: 'user', shortcut: 'i', onSelect: () => change({ kind: 'assign', assigneeId: me, name: meName }, [row]) });
    }
    if (can.assign && row.assigneeId) {
      act.push({ id: 'unassign', label: 'Unassign', onSelect: () => change({ kind: 'assign', assigneeId: null }, [row]) });
    }
    const moves = transitionsFrom(row.status).filter((to) => to !== 'cancelled' && to !== 'closed');
    if (can.transition && moves.length > 0) {
      act.push({
        type: 'submenu',
        id: 'status',
        label: 'Status',
        items: moves.map((to) => ({ id: `status-${to}`, label: stateLabel(to), onSelect: () => change({ kind: 'status', to }, [row]) })),
      });
    }
    if (can.update) {
      act.push({
        type: 'submenu',
        id: 'priority',
        label: 'Priority',
        items: [
          {
            type: 'radio',
            id: 'priority-choice',
            label: 'Priority',
            value: row.priority.toUpperCase(),
            items: PRIORITIES.map((priority) => ({ value: priority, label: priority })),
            onValueChange: (value) => {
              const priority = PRIORITIES.find((candidate) => candidate === value);
              if (priority) change({ kind: 'priority', priority }, [row]);
            },
          },
        ],
      });
    }
    return act.length > 0 ? [...items, { type: 'separator' }, ...act] : items;
  };

  /* ---------------------------------------------------------------- Render */

  const clock = useNow();
  const now = clock ?? renderedAt ?? Date.now();
  const hasProblem = (serverProblem !== null && !retried) || (query.isError && query.data === undefined);
  const problem: Problem | null = serverProblem !== null && !retried ? serverProblem : query.isError && query.data === undefined ? problemOf(query.error) : null;
  const refreshFailed = query.isError && query.data !== undefined && !(query.error instanceof ApiError && query.error.status === 401);
  const loading = !hasProblem && query.data === undefined && can.read;
  const refreshing = isPlaceholder || (query.isRefetching && shown.mode === 'apply');
  const empty = !loading && !hasProblem && rows.length === 0;
  const narrow = useNarrow();

  const retry = (): void => {
    setRetried(true);
    void query.refetch();
  };

  // The sidebar's counts, read from the frame's cache without fetching them again.
  const counts = useSyncExternalStore(
    useCallback((notify: () => void) => client.getQueryCache().subscribe(notify), [client]),
    () => client.getQueryData<DeskCounts>(deskKeys.counts()),
    () => undefined,
  );
  const unassigned = counts?.counts.unassigned;

  const emptyState = (): ReactNode => {
    if (view.filtered) {
      return (
        <EmptyState
          size="sm"
          tone="search"
          title="No tickets match"
          description="Nothing in this view matches these filters."
          {...(onClearFilters ? { action: { id: 'clear', label: 'Clear filters' }, onAction: () => onClearFilters() } : {})}
        />
      );
    }
    const pickUp = view.key === 'mine' && (!unassigned || unassigned.count > 0);
    const pickUpLabel = unassigned && unassigned.count > 0 ? `Pick up from Unassigned (${unassigned.count > 99 || unassigned.capped ? '99+' : unassigned.count})` : 'Pick up from Unassigned';
    return (
      <EmptyState
        size="sm"
        tone={view.empty.tone}
        title={view.empty.title}
        description={
          view.empty.tone === 'success' && query.dataUpdatedAt > 0 ? (
            <>
              {view.empty.description} Checked <RelativeTime date={new Date(query.dataUpdatedAt).toISOString()} mode="relative" relativeStyle="long" />.
            </>
          ) : (
            view.empty.description
          )
        }
        {...(pickUp ? { action: { id: 'unassigned', label: pickUpLabel, href: '/inbox/unassigned', variant: 'secondary' as const } } : {})}
      />
    );
  };

  const body = (): ReactNode => {
    if (!can.read || problem?.status === 403) {
      return (
        <EmptyState
          size="sm"
          tone="forbidden"
          title="Your account can’t read tickets"
          description="Ask an administrator for the agent role."
        />
      );
    }
    if (problem) return <ProblemState size="sm" problem={problem} context="tickets" onRetry={retry} />;
    if (loading) return <SkeletonList rows={8} label="Loading tickets…" />;
    if (empty) return emptyState();
    return null;
  };

  const bulkBar =
    selectable && (checked.size > 0 || writes.job) ? (
      <InboxBulkBar
        rows={checkedRows}
        writes={writes}
        me={me}
        meName={meName}
        can={can}
        onClear={() => {
          setChecked(new Set());
          kb.focusActive();
        }}
        onDone={finish}
      />
    ) : null;

  return (
    <div
      className="app-TicketList"
      data-selecting={checked.size > 0 || selectMode || undefined}
      data-long={rows.length > 200 || undefined}
      aria-busy={refreshing || loading || undefined}
    >
      {refreshing ? <ProgressBar className="app-TicketList__progress" label="Refreshing tickets" labelHidden size="sm" /> : null}
      {cachedAt ? (
        <Banner tone="info" icon="wifi-off" variant="subtle" live={false} className="app-TicketList__notice">
          Offline · showing the copy from {formatDateTime(cachedAt, { locale, timeZone, style: 'time' })}
        </Banner>
      ) : null}
      {refreshFailed ? (
        <Banner
          tone="warning"
          className="app-TicketList__notice"
          title="Couldn’t refresh this list"
          action={{ id: 'retry', label: 'Retry' }}
          onAction={() => void query.refetch()}
          live={false}
        >
          Showing what was loaded before.
        </Banner>
      ) : null}
      {heldCount > 0 ? (
        <div className="app-TicketList__new">
          <button type="button" className="app-TicketList__newButton" onClick={showHeld}>
            {heldCount} new · Show
          </button>
        </div>
      ) : null}

      {body()}

      {rows.length > 0 && !hasProblem ? (
        <ul
          ref={listElement}
          className="app-TicketList__rows"
          aria-label={`Tickets, ${view.title}`}
          aria-describedby="inbox-list-hint"
          onKeyDown={onListKeyDown}
          onFocus={kb.onFocus}
        >
          {rows.map((entry, index) => {
            const { row } = entry;
            const assignee = view.showAssignee && row.assigneeId ? people[row.assigneeId] ?? { name: personName(row.assigneeId, people, me), initials: '?' } : null;
            return (
              <TicketRow
                key={row.id}
                row={row}
                index={index}
                href={`/tickets/${encodeURIComponent(row.number)}`}
                requester={row.requesterId ? personName(row.requesterId, people, me) : null}
                assignee={assignee}
                team={view.showTeam && row.groupId ? (teamNames[row.groupId.toLowerCase()] ?? null) : null}
                current={row.number === selected}
                selectable={selectable}
                checked={checked.has(row.id)}
                unread={isUnread(row, seen, me)}
                moved={entry.moved ? (movedLabels.get(row.id) ?? 'No longer in this view') : null}
                flash={flashing.has(row.id)}
                now={now}
                tabStop={index === kb.activeIndex ? kb.activeColumn : null}
                menuOpen={menuFor === row.id}
                menuItems={menuFor === row.id ? menuItemsFor(row) : NO_ITEMS}
                menuReturn={menuReturn}
                onMenuOpenChange={onMenuOpenChange}
                onLinkClick={onLinkClick}
                onCheck={onCheck}
                onMenuKeyDown={onMenuKeyDown}
                onIntent={onIntent}
                rowRef={rowRef}
              />
            );
          })}
        </ul>
      ) : null}
      <p id="inbox-list-hint" hidden>
        {selectable
          ? 'Use the arrow keys or J and K to move, X to select, Enter to open.'
          : 'Use the arrow keys or J and K to move, Enter to open.'}
      </p>

      {rows.length > 0 && !hasProblem ? (
        <LoadMore
          className="app-TicketList__more"
          auto
          hasMore={hasMore}
          loading={query.isFetchingNextPage}
          shown={current}
          noun={TICKET_NOUN}
          pageSize={PAGE_SIZE}
          onLoadMore={async () => {
            applyNext();
            const result = await query.fetchNextPage();
            if (result.isFetchNextPageError) throw result.error;
          }}
        />
      ) : null}

      <p className="itsm-visually-hidden" data-live="inbox" role="status" aria-live="polite" aria-atomic="true">
        {message}
      </p>

      {bulkBar ? narrow ? <BottomDock bar={bulkBar} /> : <div className="app-TicketList__bulk">{bulkBar}</div> : null}
      <BulkReportSheet
        report={writes.report}
        me={me}
        people={people}
        onClose={() => {
          writes.openReport(null);
          kb.focusActive();
        }}
        onRetry={(report) => {
          writes.openReport(null);
          const fresh = new Map(latestRows.current.map((entry) => [entry.row.id, entry.row]));
          change(report.change, report.failures.map((failure) => fresh.get(failure.row.id) ?? failure.row));
        }}
      />
    </div>
  );
}

const NO_ITEMS: readonly MenuItemSpec[] = [];

/** Below 768 px the bulk bar joins the frame's bottom dock (SPEC §4.7 BulkActionBar `dock`). */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(max-width: 47.99rem)');
    const update = (): void => setNarrow(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return narrow;
}
