'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutbox } from '@itsm/pwa';
import { useLive, useLiveState } from '@itsm/pwa/live';
import { ApiError, type Ticket } from '@itsm/sdk';
import {
  Banner,
  Button,
  EmptyState,
  ProblemState,
  Region,
  SkeletonPage,
  describeProblem,
  notify,
  useHotkey,
  useItsm,
  useLiveAnnouncer,
  useRecordRecent,
  useRegisterCommands,
  type CommandItem,
} from '@itsm/ui';
import { formatDateTime } from '@itsm/ui/format';
import { ConflictDialog, Dialog, Sheet, type ConflictChange, type MenuItemSpec } from '@itsm/ui/overlays';
import '../app/(desk)/tickets/[id]/workspace.css';
import { useDeskSkipLinks } from '../components/DeskShell.js';
import {
  categoriesQuery,
  teamsQuery,
  ticketQuery,
  type TicketBundle,
} from '../client/desk-ticket.js';
import {
  applyOptimistic,
  changeSummary,
  conflictChanges,
  fieldsOf,
  isConflict,
  isPreconditionRequired,
  raiseFollowUp,
  stillApplies,
  valueText,
  watchTicket,
  writeChange,
  type ChangedField,
  type Directory,
  type TicketChange,
} from '../client/mutations.js';
import { isCommentFor, newIdempotencyKey, queuedComment, sendComment } from '../client/outbox.js';
import { deskKeys } from '../client/query-client.js';
import { personName, problemOf, stateLabel } from '../inbox/presentation.js';
import { LIST_CONTEXT_KEY, type ListContext } from '../inbox/queries.js';
import { INBOX_REGIONS } from '../inbox/views.js';
import { transitionsFrom } from '../queue/transitions.js';
import { Composer, sendFailure, type ComposerHandle, type ComposerMode } from './Composer.js';
import { Conversation, conversationModel, newSinceId, type QueuedMessage } from './Conversation.js';
import { ArticleSheet } from './ArticleSheet.js';
import { Header, type Neighbours } from './Header.js';
import { Inspector } from './inspector/Inspector.js';
import { NextStep, nextStepFor } from './NextStep.js';
import { PropertyChips, type ChipChangeOptions, type ChipMenu } from './PropertyChips.js';
import { ResolveDialog, ResolvePopover, type ResolveInput } from './ResolvePopover.js';

/**
 * The ticket workspace (SPEC §6.2, D16): the header with the ticket's
 * properties and its next step, the conversation, the composer and the
 * inspector — beside the inbox list (`mode="pane"`) and as the full
 * `/tickets/[id]` page (`mode="page"`).
 *
 * It reads one cache entry, `['ticket', number]` (`GET
 * /api/desk/tickets/[id]`), which the server seeds on a hard load and the
 * list prefetches on hover and for the rows either side, so `j`/`k` swaps
 * tickets instantly. Every write goes through one writer: optimistic, with
 * the version the person saw as `If-Match`, a 409 explained in the conflict
 * dialog ("Jo changed Status to In progress · 2 min ago") and the lists and
 * counts refreshed after. A live notice about this ticket refetches it; a
 * reply by someone else is announced once and offered with "Show".
 *
 * Regions: in the pane, the inbox's `article` is the ticket and this adds
 * the inspector's `aside "Details"`; on the page the workspace is the
 * `article` itself. `#ticket-conversation` and `#ticket-reply` are the skip
 * links' targets in both.
 */

export interface TicketWorkspaceProps {
  /** The ticket's number (`INC-000123`) or id. */
  readonly ticketId: string;
  /** `pane`: beside the inbox list, title as `h2`. `page`: the whole content column, title as the page's `h1`. */
  readonly mode: 'pane' | 'page';
  /** Where "‹ Back" goes on the full page: the view the person came from. Read from the list context when absent. */
  readonly back?: { readonly href: string; readonly label: string };
}

/* ------------------------------------------------------------ The seam */

export type WriteOutcome = 'done' | 'conflict' | 'failed';

/**
 * What the rest of the ticket's screen — the inspector, Assist, triage
 * (WP25) — may ask of the workspace, so there is one writer, one composer
 * and one cache entry however many parts of the screen change the ticket.
 */
export interface WorkspaceApi {
  readonly bundle: TicketBundle;
  readonly mode: 'pane' | 'page';
  /** Why nothing can be changed right now ("Needs a connection"), for a control to say so; absent when changes are possible. */
  readonly gate?: string;
  /** Re-reads the ticket: after a write made elsewhere (a triage accept). */
  refresh(): Promise<void>;
  /** A change with the workspace's conflict handling and feedback (and, optionally, what to offer after it lands). */
  change(change: TicketChange, options?: ChipChangeOptions): Promise<WriteOutcome>;
  /** Adds text to the reply (an AI draft's "Insert into reply", an article link) without losing what is there. */
  insertIntoReply(text: string, options?: { readonly suggestionId?: string; readonly mode?: ComposerMode }): void;
  /** Opens the composer in a mode. */
  openComposer(mode?: ComposerMode): void;
}

const WorkspaceContext = createContext<WorkspaceApi | null>(null);

/** The open ticket's workspace, for a part of its screen; `null` outside one. */
export function useTicketWorkspace(): WorkspaceApi | null {
  return useContext(WorkspaceContext);
}

/* --------------------------------------------------------- Small hooks */

/** How wide the workspace is: the inspector is a column from here, a sheet below. */
const INSPECTOR_COLUMN_MIN = 800;
const INSPECTOR_PREF_KEY = 'itsm-wb-inspector';

function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const next = Math.round(entries[0]?.contentRect.width ?? 0);
      setWidth((current) => (current === next ? current : next));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

function readStorage(storage: 'local' | 'session', key: string): string | null {
  try {
    return (storage === 'local' ? window.localStorage : window.sessionStorage).getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // A preference that cannot be remembered is still applied for now.
  }
}

/** The list this ticket was opened from, for ‹ › and "‹ Back to My work" (written by the inbox list). */
export function neighboursFrom(context: ListContext | null, number: string, back?: { href: string; label: string }): Neighbours {
  const index = context ? context.numbers.indexOf(number) : -1;
  const fromList = context && index >= 0 ? { href: context.href, label: context.title } : null;
  return {
    previous: context && index > 0 ? (context.numbers[index - 1] ?? null) : null,
    next: context && index >= 0 ? (context.numbers[index + 1] ?? null) : null,
    back: back ?? fromList ?? { href: '/inbox', label: 'inbox' },
  };
}

function useListContext(): ListContext | null {
  const [context, setContext] = useState<ListContext | null>(null);
  useEffect(() => {
    const raw = readStorage('session', LIST_CONTEXT_KEY);
    if (!raw) return;
    try {
      const value = JSON.parse(raw) as Partial<ListContext>;
      if (typeof value.href === 'string' && typeof value.title === 'string' && Array.isArray(value.numbers)) {
        setContext({ href: value.href, title: value.title, numbers: value.numbers.filter((entry): entry is string => typeof entry === 'string') });
      }
    } catch {
      // A context that cannot be read is no context: the arrows are simply absent.
    }
  }, []);
  return context;
}

/** Visits to each ticket on this device, for "New since your last visit". Cleared at sign-out (`itsm-wb-`). */
export const VISIT_KEY = 'itsm-wb-visits';
const MAX_VISITS = 300;

/** When this person last had this ticket open here (read once, then this visit is recorded). */
function useLastVisit(ticketId: string, scope: string | null): string | null | undefined {
  const [last, setLast] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const key = `${VISIT_KEY}${scope ? `:${scope}` : ''}`;
    let visits: Record<string, string> = {};
    try {
      const parsed = JSON.parse(readStorage('local', key) ?? '{}') as unknown;
      if (parsed && typeof parsed === 'object') visits = parsed as Record<string, string>;
    } catch {
      visits = {};
    }
    setLast(typeof visits[ticketId] === 'string' ? visits[ticketId]! : null);
    delete visits[ticketId];
    visits[ticketId] = new Date().toISOString();
    const ids = Object.keys(visits);
    for (const id of ids.slice(0, Math.max(0, ids.length - MAX_VISITS))) delete visits[id];
    writeStorage(key, JSON.stringify(visits));
  }, [ticketId, scope]);
  return last;
}

function signInHref(): string {
  if (typeof window === 'undefined') return '/api/session/login';
  return `/api/session/login?redirectTo=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`;
}

/** A write's failure in words, for the toast (the service's own detail where it has one). */
function writeFailure(error: unknown): { title: string; description?: string; retryAt?: number } {
  const problem = problemOf(error);
  if (problem.status === 429) {
    const seconds = problem.retryAfterSeconds ?? 20;
    return { title: `Too many changes at once. Try again in ${seconds} s.`, retryAt: Date.now() + seconds * 1000 };
  }
  if (problem.status === 402) return { title: 'Your organisation has reached a plan limit' };
  if (problem.status === 403) return { title: 'You can’t make this change', ...(problem.detail ? { description: problem.detail } : {}) };
  if (problem.status === 422) return { title: 'The change was refused', ...(problem.detail ? { description: problem.detail } : {}) };
  const described = describeProblem(problem);
  return { title: `That didn’t work. ${described.title}.`, ...(described.body ? { description: described.body } : {}) };
}

/* ----------------------------------------------------------- The writer */

interface ConflictState {
  readonly change: TicketChange;
  readonly changes: readonly ConflictChange[];
  readonly retryOnly: boolean;
}

interface Writer {
  run(change: TicketChange, options?: { readonly afterComment?: boolean; readonly quiet?: boolean } & ChipChangeOptions): Promise<WriteOutcome>;
  readonly pending: TicketChange | null;
  readonly conflict: ConflictState | null;
  resolveConflict(choice: 'mine' | 'theirs'): Promise<void>;
  /** Fields this tab changed a moment ago: a refetch showing them is not "someone else's change". */
  readonly ownWrites: RefObject<{ fields: ReadonlySet<ChangedField>; at: number }>;
}

function useWriter(number: string, directory: Directory, onSessionEnded: () => void): Writer {
  const client = useQueryClient();
  const key = useMemo(() => ticketQuery(number).queryKey, [number]);
  const [pending, setPending] = useState<TicketChange | null>(null);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const ownWrites = useRef<{ fields: ReadonlySet<ChangedField>; at: number }>({ fields: new Set(), at: 0 });
  const latestDirectory = useRef(directory);
  latestDirectory.current = directory;

  const current = useCallback((): TicketBundle | undefined => client.getQueryData<TicketBundle>(key), [client, key]);
  const setTicket = useCallback(
    (ticket: Ticket) => client.setQueryData<TicketBundle>(key, (old) => (old ? { ...old, ticket } : old)),
    [client, key],
  );
  const afterWrite = useCallback(() => {
    // The history gains the event; the lists and counts may have moved.
    void client.invalidateQueries({ queryKey: key });
    void client.invalidateQueries({ queryKey: deskKeys.views() });
    void client.invalidateQueries({ queryKey: deskKeys.counts() });
  }, [client, key]);
  const fresh = useCallback(async (): Promise<TicketBundle | null> => {
    try {
      return await client.fetchQuery({ ...ticketQuery(number), staleTime: 0 });
    } catch {
      return null;
    }
  }, [client, number]);

  const run = useCallback<Writer['run']>(
    async (change, options = {}) => {
      const before = current()?.ticket;
      if (!before) return 'failed';
      ownWrites.current = { fields: new Set(fieldsOf(change)), at: Date.now() };
      setTicket(applyOptimistic(before, change));
      setPending(change);
      const attempt = async (ticket: Ticket, retried: boolean): Promise<WriteOutcome> => {
        try {
          const updated = await writeChange(ticket, change);
          ownWrites.current = { fields: new Set(fieldsOf(change)), at: Date.now() };
          setTicket(updated);
          afterWrite();
          if (!options.quiet) {
            const followUp = options.followUp;
            notify(changeSummary(change, latestDirectory.current), {
              tone: 'success',
              ...(followUp ? { action: { label: followUp.label, onClick: () => void run(followUp.change, { quiet: false }) } } : {}),
            });
          }
          return 'done';
        } catch (error) {
          if (isPreconditionRequired(error) && !retried) {
            // Reload once and try again (SPEC §4.10): the version was missing, not wrong.
            const reloaded = await fresh();
            if (reloaded) return attempt(reloaded.ticket, true);
          }
          if (isConflict(error) || (isPreconditionRequired(error) && retried)) {
            const reloaded = await fresh();
            if (!reloaded) {
              setTicket(before);
              notify('Someone else changed this ticket first', { tone: 'warning', description: 'Reload it to see what they did.' });
              return 'conflict';
            }
            const theirs = reloaded.ticket;
            if (!stillApplies(change, theirs)) {
              // Nothing to put on top: it already is what they wanted, or the move no longer exists from there.
              const already = change.kind === 'status' ? theirs.status === change.to : true;
              const field = fieldsOf(change)[0]!;
              notify(
                already
                  ? `Someone else already made this change`
                  : `Someone else changed ${field === 'status' ? 'the status' : 'this ticket'} first`,
                { tone: 'info', description: `It’s now ${valueText(field, theirs, latestDirectory.current, change.kind === 'custom' ? change.key : undefined)}.` },
              );
              return 'conflict';
            }
            setConflict({
              change,
              changes: conflictChanges(change, before, theirs, reloaded.entries, latestDirectory.current),
              retryOnly: options.afterComment === true,
            });
            return 'conflict';
          }
          setTicket(before);
          if (error instanceof ApiError && error.status === 401) {
            onSessionEnded();
            return 'failed';
          }
          // Permission revoked mid-session (SPEC §4.10): re-read the ticket, whose viewer rights hide what is no longer allowed.
          if (error instanceof ApiError && error.status === 403) void client.invalidateQueries({ queryKey: key });
          const failure = writeFailure(error);
          notify(failure.title, {
            tone: 'danger',
            ...(failure.description ? { description: failure.description } : {}),
            ...(failure.retryAt ? { retryAt: failure.retryAt } : {}),
          });
          return 'failed';
        }
      };
      try {
        return await attempt(before, false);
      } finally {
        setPending(null);
      }
    },
    [current, setTicket, afterWrite, fresh, onSessionEnded, client, key],
  );

  const resolveConflict = useCallback<Writer['resolveConflict']>(
    async (choice) => {
      const open = conflict;
      if (!open) return;
      if (choice === 'theirs') {
        setConflict(null);
        return;
      }
      const ticket = current()?.ticket;
      if (!ticket) throw new Error('The ticket is no longer loaded.');
      // Straight to the service with the newer version: a failure stays in the dialog.
      const updated = await writeChange(ticket, open.change);
      ownWrites.current = { fields: new Set(fieldsOf(open.change)), at: Date.now() };
      setTicket(updated);
      afterWrite();
      setConflict(null);
      notify(changeSummary(open.change, latestDirectory.current), { tone: 'success' });
    },
    [conflict, current, setTicket, afterWrite],
  );

  return { run, pending, conflict, resolveConflict, ownWrites };
}

/* ------------------------------------------------------------- States */

function NotAvailable({ ticketId, mode }: { readonly ticketId: string; readonly mode: 'pane' | 'page' }): ReactNode {
  const close = (): void => {
    const url = new URL(window.location.href);
    url.searchParams.delete('t');
    window.history.pushState(null, '', `${url.pathname}${url.search}`);
  };
  return (
    <div className="app-Ws__state">
      <EmptyState
        size="md"
        icon="ticket"
        tone="search"
        headingLevel={mode === 'page' ? 2 : 3}
        title={`${ticketId} isn’t available`}
        description="It may have been deleted, or it’s outside your teams."
        action={
          mode === 'pane' ? (
            <Button variant="secondary" onClick={close}>
              Close
            </Button>
          ) : (
            { id: 'inbox', label: 'Back to inbox', href: '/inbox', variant: 'secondary' }
          )
        }
      />
    </div>
  );
}

/* ---------------------------------------------------------------- Root */

export function TicketWorkspace({ ticketId, mode, back }: TicketWorkspaceProps): ReactNode {
  const query = useQuery(ticketQuery(ticketId));

  if (!query.data) {
    if (query.error) {
      const problem = problemOf(query.error);
      if (problem.status === 404 || problem.status === 403) return <NotAvailable ticketId={ticketId} mode={mode} />;
      return (
        <div className="app-Ws__state">
          <ProblemState
            problem={problem}
            context={`ticket ${ticketId}`}
            onRetry={() => void query.refetch()}
            signInHref={signInHref()}
            headingLevel={mode === 'page' ? 1 : 2}
          />
        </div>
      );
    }
    return <SkeletonPage variant="workspace" label={`Loading ${ticketId}…`} className="app-Ws__skeleton" />;
  }

  return <Workspace bundle={query.data} error={query.error} refetch={() => query.refetch()} mode={mode} {...(back ? { back } : {})} />;
}

/* ------------------------------------------------------ The workspace */

interface WorkspaceProps {
  readonly bundle: TicketBundle;
  /** A refetch that failed while the last good copy is shown. */
  readonly error: Error | null;
  readonly refetch: () => Promise<unknown>;
  readonly mode: 'pane' | 'page';
  readonly back?: { readonly href: string; readonly label: string };
}

/** How long after a live notice the ticket is re-read: a burst of changes is one request. */
const LIVE_SETTLE_MS = 400;
/** A refetch showing a field this tab wrote within this long is its own echo, not someone else's change. */
const OWN_ECHO_MS = 5000;
/** How long a field someone else changed stays highlighted (SPEC §1.9). */
const FLASH_MS = 1200;

function Workspace({ bundle, error, refetch, mode, back }: WorkspaceProps): ReactNode {
  const { ticket, viewer } = bundle;
  const number = ticket.number;
  const me = viewer.id;
  const can = viewer.can;
  const client = useQueryClient();
  const { router, locale, timeZone } = useItsm();
  const titleId = useId();

  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const composer = useRef<ComposerHandle | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const composerText = useRef<Record<ComposerMode, string>>({ reply: '', note: '' });

  /* The directories: team and category names, one read per tab. */
  const teams = useQuery(teamsQuery()).data;
  const categories = useQuery(categoriesQuery()).data;
  const directory = useMemo<Directory>(() => ({ people: bundle.people, me, teams, categories }), [bundle.people, me, teams, categories]);

  /* Connection and the outbox. */
  const outbox = useOutbox();
  const live = useLiveState();
  const [sessionEnded, setSessionEnded] = useState(false);
  const endSession = useCallback(() => setSessionEnded(true), []);
  const lostAccess = error instanceof ApiError && (error.status === 403 || error.status === 404);
  const gate = lostAccess
    ? 'You no longer have access to this ticket'
    : live.state === 'ended' || sessionEnded
      ? 'Sign in again first'
      : !outbox.online
        ? 'Needs a connection'
        : undefined;

  const writer = useWriter(number, directory, endSession);

  /* Layout: the inspector is a column when there is room, a sheet otherwise. */
  const width = useWidth(rootRef);
  const wide = width >= INSPECTOR_COLUMN_MIN;
  const [columnOpen, setColumnOpen] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  useEffect(() => {
    if (readStorage('local', INSPECTOR_PREF_KEY) === 'closed') setColumnOpen(false);
  }, []);
  const inspectorOpen = wide ? columnOpen : sheetOpen;
  const toggleInspector = useCallback(() => {
    if (wide) {
      setColumnOpen((open) => {
        writeStorage(INSPECTOR_PREF_KEY, open ? 'closed' : 'open');
        return !open;
      });
    } else setSheetOpen((open) => !open);
  }, [wide]);

  /* Menus opened by shortcuts, the title editor, the resolve popover. */
  const [menu, setMenu] = useState<ChipMenu | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  /** Resolve…: a popover on the next-step button, or a dialog when asked for from elsewhere. */
  const [resolving, setResolving] = useState<'popover' | 'dialog' | null>(null);
  const [condensed, setCondensed] = useState(false);
  const openMenuFrom = useCallback((which: ChipMenu, invoker: HTMLElement | null) => {
    returnFocus.current = invoker && !rootRef.current?.contains(invoker) ? invoker : null;
    setMenu(which);
  }, []);
  const menuReturn = returnFocus.current ? returnFocus : null;

  /* The conversation, "new since" and live replies. */
  const model = useMemo(() => conversationModel(bundle, me), [bundle, me]);
  const lastVisit = useLastVisit(ticket.id, me);
  const [newSince, setNewSince] = useState<string | null>(null);
  const placedNewSince = useRef(false);
  useEffect(() => {
    if (lastVisit === undefined || placedNewSince.current) return;
    placedNewSince.current = true;
    const id = newSinceId(model, lastVisit);
    setNewSince(id);
    if (id) requestAnimationFrame(() => document.getElementById(`${INBOX_REGIONS.conversation}-new`)?.scrollIntoView?.({ block: 'start' }));
  }, [lastVisit, model]);

  const announce = useLiveAnnouncer('ticket-workspace');
  const known = useRef<Set<string>>(new Set(model.othersMessages.map((message) => message.id)));
  const [arrived, setArrived] = useState<{ readonly name: string; readonly internal: boolean } | null>(null);
  const atBottom = useCallback((): boolean => {
    const scroller = scrollerRef.current;
    if (!scroller || scroller.scrollHeight <= scroller.clientHeight) return true;
    return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 48;
  }, []);
  const showLatest = useCallback(() => {
    const scroller = scrollerRef.current;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
    setArrived(null);
    scroller?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const fresh = model.othersMessages.filter((message) => !known.current.has(message.id));
    if (fresh.length === 0) return;
    for (const message of fresh) known.current.add(message.id);
    const last = fresh[fresh.length - 1]!;
    announce(`${last.name} ${last.internal ? 'added an internal note' : 'replied'} on ${number}`);
    const writing = composerText.current.reply.trim() !== '' || composerText.current.note.trim() !== '';
    if (!writing && atBottom()) requestAnimationFrame(showLatest);
    else setArrived({ name: last.name, internal: last.internal });
  }, [model, announce, atBottom, showLatest, number]);

  /* Someone else's change to a property flashes once. */
  const [flash, setFlash] = useState<ReadonlySet<ChipMenu>>(new Set());
  const previousTicket = useRef(ticket);
  useEffect(() => {
    const before = previousTicket.current;
    previousTicket.current = ticket;
    if (before === ticket || before.id !== ticket.id) return;
    const own = writer.ownWrites.current;
    const recent = Date.now() - own.at < OWN_ECHO_MS;
    const map: [ChipMenu, ChangedField][] = [
      ['status', 'status'],
      ['priority', 'priority'],
      ['assignee', 'assigneeId'],
      ['team', 'groupId'],
      ['category', 'categoryId'],
    ];
    const changed = new Set(map.filter(([, field]) => before[field] !== ticket[field] && !(recent && own.fields.has(field))).map(([chip]) => chip));
    if (changed.size === 0) return;
    setFlash(changed);
    const timer = setTimeout(() => setFlash(new Set()), FLASH_MS);
    return () => clearTimeout(timer);
  }, [ticket, writer.ownWrites]);

  /* Live: a notice about this ticket re-reads it; a gap in the stream does too. */
  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (liveTimer.current) clearTimeout(liveTimer.current);
    },
    [],
  );
  const scheduleRefetch = useCallback(() => {
    if (liveTimer.current) return;
    liveTimer.current = setTimeout(() => {
      liveTimer.current = null;
      void client.invalidateQueries({ queryKey: deskKeys.ticket(number) });
    }, LIVE_SETTLE_MS);
  }, [client, number]);
  const reachesTab =
    (me !== null && (ticket.assigneeId?.toLowerCase() === me || ticket.requesterId?.toLowerCase() === me)) ||
    (ticket.groupId !== null && viewer.teamIds.includes(ticket.groupId.toLowerCase()));
  useLive({
    entity: 'ticket',
    id: ticket.id,
    // The frame's stream already carries notices for the person's own tickets and teams;
    // a ticket outside them needs its own topic while it is open.
    topics: reachesTab ? [] : [`ticket:${ticket.id}`],
    onNotice: scheduleRefetch,
    onReconnect: scheduleRefetch,
  });

  /* Queued comments on this ticket, from the outbox. */
  const queued = useMemo<QueuedMessage[]>(
    () =>
      outbox.items
        .filter((item) => isCommentFor(item, number, ticket.id) && item.status !== 'sent')
        .map((item) => {
          const comment = queuedComment(item);
          return {
            id: item.id,
            body: comment?.body ?? item.summary,
            internal: comment?.internal ?? false,
            state: item.status === 'failed' || item.status === 'conflict' ? ('failed' as const) : ('waiting' as const),
            problem: item.problem,
          };
        }),
    [outbox.items, number, ticket.id],
  );
  const queuedCount = useRef(queued.length);
  useEffect(() => {
    // One left the queue (it was sent): the conversation now has it for real.
    if (queued.length < queuedCount.current) void client.invalidateQueries({ queryKey: deskKeys.ticket(number) });
    queuedCount.current = queued.length;
  }, [queued.length, client, number]);

  /* Recents, and skip links on the page (the inbox adds its own for the pane). */
  useRecordRecent({ id: number, label: `${number} ${ticket.title}`, href: `/tickets/${encodeURIComponent(number)}`, kind: 'ticket', meta: stateLabel(ticket.status) });
  useDeskSkipLinks(
    mode === 'page'
      ? [
          { label: 'Skip to conversation', targetId: INBOX_REGIONS.conversation },
          { label: 'Skip to reply', targetId: INBOX_REGIONS.reply },
        ]
      : [],
  );

  /* Where the arrows and "Back" go. */
  const context = useListContext();
  const neighbours = useMemo(() => neighboursFrom(context, number, back), [context, number, back]);
  const step = useCallback(
    (next: string) => {
      if (mode === 'page') {
        router.push(`/tickets/${encodeURIComponent(next)}`);
        return;
      }
      const url = new URL(window.location.href);
      url.searchParams.set('t', next);
      window.history.pushState(null, '', `${url.pathname}${url.search}`);
    },
    [mode, router],
  );

  /* Writes. */
  const change = useCallback(
    (next: TicketChange, options?: ChipChangeOptions) => {
      if (gate) {
        notify(gate, { tone: 'warning' });
        return;
      }
      void writer.run(next, options);
    },
    [gate, writer],
  );

  const resolveKey = useRef<{ key: string; text: string } | null>(null);
  const resolve = useCallback(
    async ({ text, private: keepPrivate }: ResolveInput): Promise<string | void> => {
      if (text) {
        const same = resolveKey.current?.text === `${keepPrivate}:${text}`;
        const key = same ? resolveKey.current!.key : newIdempotencyKey();
        resolveKey.current = { key, text: `${keepPrivate}:${text}` };
        try {
          const sent = await sendComment({ ticket: number, body: text, internal: keepPrivate, idempotencyKey: key });
          if (sent.status === 'queued') {
            return 'You’re offline. The comment is queued, but resolving needs a connection.';
          }
        } catch (failure) {
          if (failure instanceof ApiError && failure.status === 401) endSession();
          return sendFailure(failure, keepPrivate);
        }
        resolveKey.current = null;
        const mode: ComposerMode = keepPrivate ? 'note' : 'reply';
        if (composer.current?.text(mode).trim() === text) composer.current.clear(mode);
        void client.invalidateQueries({ queryKey: deskKeys.ticket(number) });
      }
      const outcome = await writer.run({ kind: 'status', to: 'resolved', ...(text ? { reason: text } : {}) }, { afterComment: Boolean(text) });
      if (outcome === 'failed' && !text) return 'That didn’t resolve it. Try again.';
      return undefined;
    },
    [client, number, writer, endSession],
  );

  const followUpKey = useRef<string | null>(null);
  const [raising, setRaising] = useState(false);
  const followUp = useCallback(async () => {
    if (raising) return;
    if (gate) {
      notify(gate, { tone: 'warning' });
      return;
    }
    followUpKey.current ??= newIdempotencyKey();
    setRaising(true);
    try {
      const created = await raiseFollowUp(ticket, followUpKey.current);
      followUpKey.current = null;
      void client.invalidateQueries({ queryKey: deskKeys.views() });
      void client.invalidateQueries({ queryKey: deskKeys.counts() });
      notify(`${created.number} raised`, {
        tone: 'success',
        description: `Linked to ${number}.`,
        action: { label: 'Open', onClick: () => router.push(`/tickets/${encodeURIComponent(created.number)}`) },
      });
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) endSession();
      else notify(writeFailure(failure).title, { tone: 'danger' });
    } finally {
      setRaising(false);
    }
  }, [raising, gate, ticket, client, number, router, endSession]);

  const saveTitle = useCallback(
    async (title: string): Promise<boolean> => {
      if (gate) {
        notify(gate, { tone: 'warning' });
        return false;
      }
      setEditingTitle(false);
      const outcome = await writer.run({ kind: 'title', title });
      if (outcome === 'failed') setEditingTitle(true);
      return outcome !== 'failed';
    },
    [gate, writer],
  );

  const copy = useCallback(async (text: string, done: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify(done, { tone: 'success' });
    } catch {
      notify('Couldn’t copy that', { tone: 'warning', description: text });
    }
  }, []);
  const link = typeof window === 'undefined' ? `/tickets/${number}` : `${window.location.origin}/tickets/${encodeURIComponent(number)}`;

  /* The ⋯ menu. */
  const moreItems = useMemo<MenuItemSpec[]>(
    () => [
      { id: 'copy-link', label: 'Copy link', icon: 'link', onSelect: () => void copy(link, 'Link copied') },
      { id: 'copy-number', label: 'Copy number', icon: 'copy', onSelect: () => void copy(number, `${number} copied`) },
      ...(can.watch && me
        ? [
            {
              id: 'watch',
              label: 'Watch',
              icon: 'eye' as const,
              description: 'Hear about every change to it',
              ...(gate ? { disabled: true, disabledReason: gate } : {}),
              onSelect: () => {
                void watchTicket(ticket, me).then(
                  () => notify(`You’re watching ${number}`, { tone: 'success' }),
                  (failure: unknown) => notify(writeFailure(failure).title, { tone: 'danger' }),
                );
              },
            },
          ]
        : []),
      ...(can.create
        ? [
            { type: 'separator' as const },
            {
              id: 'follow-up',
              label: 'Raise follow-up',
              icon: 'plus' as const,
              description: 'A new ticket for the same requester, linked to this one',
              ...(gate ? { disabled: true, disabledReason: gate } : {}),
              onSelect: () => void followUp(),
            },
          ]
        : []),
      ...(mode === 'pane' ? [{ type: 'separator' as const }, { id: 'open', label: 'Open full page', icon: 'external-link' as const, shortcut: 'o', href: `/tickets/${encodeURIComponent(number)}` }] : []),
    ],
    [copy, link, number, can.watch, can.create, me, gate, ticket, followUp, mode],
  );

  /* The next step. */
  const next = nextStepFor(ticket.status);
  const canResolve = can.transition && transitionsFrom(ticket.status).includes('resolved');
  const openResolve = useCallback(() => {
    if (gate) {
      notify(gate, { tone: 'warning' });
      return;
    }
    // Beside the next-step button when that is Resolve…; a small dialog otherwise.
    setResolving(next?.kind === 'resolve' && can.transition ? 'popover' : 'dialog');
  }, [gate, next?.kind, can.transition]);
  const nextAllowed = next && (next.needs === 'create' ? can.create : can.transition);
  const nextStepGate = gate ?? (writer.pending ? 'Saving the last change…' : undefined);
  const nextStep =
    next && nextAllowed ? (
      next.kind === 'resolve' ? (
        <ResolvePopover
          open={resolving === 'popover'}
          onOpenChange={(open) => setResolving(open ? 'popover' : null)}
          initialText={composer.current?.text('reply') ?? ''}
          canReply={can.reply}
          canNote={can.note}
          onResolve={resolve}
          trigger={<NextStep step={next} {...(nextStepGate ? { disabledReason: nextStepGate } : {})} />}
        />
      ) : (
        <NextStep
          step={next}
          busy={next.kind === 'follow-up' ? raising : writer.pending?.kind === 'status' && writer.pending.to === next.to}
          {...(nextStepGate ? { disabledReason: nextStepGate } : {})}
          onClick={() => {
            if (next.kind === 'follow-up') void followUp();
            else if (next.to) change({ kind: 'status', to: next.to });
          }}
        />
      )
    ) : null;

  /* The API the rest of the screen uses. */
  const api = useMemo<WorkspaceApi>(
    () => ({
      bundle,
      mode,
      ...(gate ? { gate } : {}),
      refresh: async () => {
        await client.invalidateQueries({ queryKey: deskKeys.ticket(number) });
      },
      change: (next, options) => (gate ? Promise.resolve('failed' as const) : writer.run(next, options)),
      insertIntoReply: (text, options) => composer.current?.insert(text, options),
      openComposer: (which) => composer.current?.open(which),
    }),
    [bundle, mode, client, number, gate, writer],
  );

  /* Keyboard (SPEC §5.6): the ticket's keys, anywhere in the ticket or the list beside it. */
  const assignedToMe = me !== null && ticket.assigneeId?.toLowerCase() === me;
  useHotkey({ keys: 'r', description: 'Reply', group: 'This ticket', enabled: can.reply, handler: () => composer.current?.open('reply') });
  useHotkey({ keys: 'n', description: 'Internal note', group: 'This ticket', enabled: can.note, handler: () => composer.current?.open('note') });
  useHotkey({ keys: 'e', description: 'Edit title', group: 'This ticket', enabled: can.update && !gate, handler: () => setEditingTitle(true) });
  useHotkey({
    keys: 'i',
    description: 'Assign to me',
    group: 'This ticket',
    enabled: can.assign && me !== null && !assignedToMe,
    handler: () => me && change({ kind: 'assign', assigneeId: me }),
  });
  useHotkey({ keys: 'a', description: 'Assignee', group: 'This ticket', enabled: can.assign, handler: (_event, hot) => openMenuFrom('assignee', hot.invoker) });
  useHotkey({ keys: 't', description: 'Team', group: 'This ticket', enabled: can.assign && Boolean(teams?.length), handler: (_event, hot) => openMenuFrom('team', hot.invoker) });
  useHotkey({ keys: 's', description: 'Status', group: 'This ticket', enabled: can.transition, handler: (_event, hot) => openMenuFrom('status', hot.invoker) });
  useHotkey({ keys: 'p', description: 'Priority, then 1–4', group: 'This ticket', enabled: can.update, handler: (_event, hot) => openMenuFrom('priority', hot.invoker) });
  useHotkey({ keys: ']', description: 'Show or hide details', group: 'This ticket', handler: toggleInspector });
  useHotkey({
    keys: '.',
    description: 'More actions',
    group: 'This ticket',
    handler: (_event, hot) => {
      returnFocus.current = hot.invoker && !rootRef.current?.contains(hot.invoker) ? hot.invoker : null;
      setMoreOpen(true);
    },
  });
  useHotkey({
    keys: 'o',
    description: 'Open full page',
    group: 'This ticket',
    enabled: mode === 'pane',
    handler: () => router.push(`/tickets/${encodeURIComponent(number)}`),
  });
  useHotkey({
    keys: 'mod+shift+enter',
    description: 'Send options',
    group: 'This ticket',
    allowInFields: true,
    handler: () => composer.current?.openSendOptions(),
  });

  /* The palette's "This ticket" group. */
  const commands = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [];
    const group = 'This ticket';
    if (can.reply) items.push({ id: 'ticket-reply', label: 'Reply', icon: 'reply', shortcut: 'r', group, run: () => composer.current?.open('reply') });
    if (can.note) items.push({ id: 'ticket-note', label: 'Add internal note', icon: 'lock', shortcut: 'n', group, run: () => composer.current?.open('note') });
    if (can.assign && me && !assignedToMe) items.push({ id: 'ticket-assign-me', label: 'Assign to me', icon: 'user', shortcut: 'i', group, run: () => change({ kind: 'assign', assigneeId: me }) });
    if (can.assign) items.push({ id: 'ticket-assign', label: 'Assign to…', icon: 'user-plus', shortcut: 'a', group, run: () => openMenuFrom('assignee', null) });
    if (can.transition) {
      if (canResolve) items.push({ id: 'ticket-resolve', label: 'Resolve…', icon: 'circle-check', group, run: openResolve });
      items.push({ id: 'ticket-status', label: 'Change status', icon: 'history', shortcut: 's', group, run: () => openMenuFrom('status', null) });
    }
    if (can.update) items.push({ id: 'ticket-priority', label: 'Change priority', icon: 'flag', shortcut: 'p', group, run: () => openMenuFrom('priority', null) });
    if (can.assign && teams?.length) items.push({ id: 'ticket-team', label: 'Move to team', icon: 'people', shortcut: 't', group, run: () => openMenuFrom('team', null) });
    items.push({ id: 'ticket-copy-link', label: 'Copy link', icon: 'link', group, run: () => void copy(link, 'Link copied') });
    if (mode === 'pane') items.push({ id: 'ticket-open', label: 'Open full page', icon: 'external-link', shortcut: 'o', group, href: `/tickets/${encodeURIComponent(number)}` });
    items.push({ id: 'ticket-details', label: inspectorOpen ? 'Hide details' : 'Show details', icon: 'panel-right', shortcut: ']', group, run: toggleInspector });
    return items.map((item) => ({ ...item, description: number }));
  }, [can, me, assignedToMe, canResolve, openResolve, teams?.length, mode, number, link, copy, change, openMenuFrom, inspectorOpen, toggleInspector]);
  useRegisterCommands(commands, [commands]);

  /* Condense the header once the conversation (or, on a phone, the page) has scrolled. */
  const onConversationScroll = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    setCondensed(scroller.scrollTop > 24);
    if (arrived && atBottom()) setArrived(null);
  }, [arrived, atBottom]);
  useEffect(() => {
    if (mode !== 'page') return;
    const onScroll = (): void => {
      const scroller = scrollerRef.current;
      // Only when the page, not the conversation, is what scrolls (one column).
      if (scroller && scroller.scrollHeight > scroller.clientHeight + 1) return;
      setCondensed(window.scrollY > 24);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [mode]);

  /* The banners: lost access, a failed refresh, an offline copy. */
  let banner: ReactNode = null;
  if (lostAccess) {
    banner = (
      <Banner tone="warning" icon="lock" title="You no longer have access to this ticket" className="app-Ws__banner">
        This is the copy you had open. It may have moved to a team you’re not in.
      </Banner>
    );
  } else if (error && !(error instanceof ApiError && error.status === 401)) {
    banner = (
      <Banner
        tone="neutral"
        variant="subtle"
        title="Couldn’t refresh this ticket"
        className="app-Ws__banner"
        action={{ id: 'retry', label: 'Retry' }}
        onAction={() => void refetch()}
        live={false}
      >
        Showing what was loaded earlier.
      </Banner>
    );
  } else if (bundle.cachedAt) {
    banner = (
      <Banner tone="neutral" variant="subtle" icon="wifi-off" className="app-Ws__banner" live={false}>
        {`Offline · showing the copy from ${formatDateTime(bundle.cachedAt, { locale, timeZone, style: 'time' })}`}
      </Banner>
    );
  }

  const inspectorColumn = wide && columnOpen;
  const requesterName = ticket.requesterId ? personName(ticket.requesterId.toLowerCase(), bundle.people, me) : null;

  const content = (
    <>
      {banner}
      <Header
        ticket={ticket}
        mode={mode}
        titleId={titleId}
        canEditTitle={can.update}
        {...(gate ? { gate } : {})}
        editingTitle={editingTitle}
        onEditingTitleChange={setEditingTitle}
        onSaveTitle={saveTitle}
        neighbours={neighbours}
        onStep={step}
        {...(mode === 'pane' ? { fullPageHref: `/tickets/${encodeURIComponent(number)}` } : {})}
        menu={moreItems}
        menuOpen={moreOpen}
        onMenuOpenChange={(open) => {
          setMoreOpen(open);
          if (!open) returnFocus.current = null;
        }}
        menuReturnFocus={menuReturn}
        inspector={{ open: inspectorOpen, onToggle: toggleInspector }}
        condensed={condensed}
        properties={
          <PropertyChips
            ticket={ticket}
            people={bundle.people}
            me={me}
            meName={viewer.name}
            can={can}
            teams={teams}
            categories={categories}
            timers={bundle.timers}
            {...(gate ? { gate } : {})}
            openMenu={menu}
            onOpenMenuChange={(which) => {
              setMenu(which);
              if (which === null) returnFocus.current = null;
            }}
            returnFocusTo={menuReturn}
            onChange={change}
            onResolve={openResolve}
            flash={flash}
          >
            {nextStep}
          </PropertyChips>
        }
      />
      <div className="app-Ws__body" data-inspector={inspectorColumn ? 'column' : undefined}>
        <div className="app-Ws__main">
          <Conversation
            ref={scrollerRef}
            bundle={bundle}
            model={model}
            me={me}
            newSince={newSince}
            queued={queued}
            onRetryQueued={(id) => void outbox.retry(id)}
            onDiscardQueued={(id) => void outbox.dismiss(id)}
            onScroll={onConversationScroll}
            headingLevel={mode === 'page' ? 2 : 3}
          />
          {arrived ? (
            <div className="app-Ws__arrived">
              <Button variant="secondary" size="sm" shape="capsule" iconStart="arrow-down" onClick={showLatest}>
                {`${arrived.name} ${arrived.internal ? 'added a note' : 'replied'} just now · Show`}
              </Button>
            </div>
          ) : null}
          <Composer
            handle={composer}
            ticket={ticket}
            requesterName={requesterName}
            canReply={can.reply}
            canNote={can.note}
            canMove={can.transition}
            online={outbox.online}
            {...(lostAccess ? { disabledReason: 'You no longer have access to this ticket' } : {})}
            onSent={() => {
              void client.invalidateQueries({ queryKey: deskKeys.ticket(number) });
              void client.invalidateQueries({ queryKey: deskKeys.views() });
              requestAnimationFrame(showLatest);
            }}
            onQueued={() => void outbox.refresh()}
            onMove={async (to, options) => (await writer.run({ kind: 'status', to, ...(options.reason ? { reason: options.reason } : {}) }, { afterComment: true })) === 'done'}
            onSessionEnded={endSession}
            onTextChange={(which, text) => {
              composerText.current = { ...composerText.current, [which]: text };
            }}
          />
        </div>
        {inspectorColumn ? (
          <Region as="aside" id="ticket-details" label="Details" className="app-Ws__inspector">
            <Inspector ticket={ticket} people={bundle.people} me={me} mode="column" />
          </Region>
        ) : null}
      </div>

      {!wide ? (
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen} side="end" size="sm" modal={false} title="Details" description={`${number} · ${ticket.title}`}>
          <Inspector ticket={ticket} people={bundle.people} me={me} mode="sheet" />
        </Sheet>
      ) : null}

      {writer.conflict ? (
        <ConflictDialog
          open
          onOpenChange={(open) => {
            if (!open) void writer.resolveConflict('theirs');
          }}
          entityLabel={number}
          changes={writer.conflict.changes}
          onApplyMine={() => writer.resolveConflict('mine')}
          onKeepTheirs={() => void writer.resolveConflict('theirs')}
          {...(writer.conflict.retryOnly ? { retryOnly: { label: 'Retry status change' } } : {})}
        />
      ) : null}

      {resolving === 'dialog' ? (
        <ResolveDialog
          number={number}
          open
          onOpenChange={(open) => setResolving(open ? 'dialog' : null)}
          initialText={composer.current?.text('reply') ?? ''}
          canReply={can.reply}
          canNote={can.note}
          onResolve={resolve}
        />
      ) : null}

      {sessionEnded ? <SessionEnded onClose={() => setSessionEnded(false)} /> : null}

      {/* `?open=article:<key>`: an article from Assist's evidence or suggestions, read over the ticket (WP25). */}
      <ArticleSheet />
    </>
  );

  return (
    <WorkspaceContext value={api}>
      {mode === 'page' ? (
        <Region as="article" id="ticket-workspace" label={number} className="app-Ws" data-mode={mode}>
          <div ref={rootRef} className="app-Ws__frame">
            {content}
          </div>
        </Region>
      ) : (
        <div className="app-Ws" data-mode={mode}>
          <div ref={rootRef} className="app-Ws__frame">
            {content}
          </div>
        </div>
      )}
    </WorkspaceContext>
  );
}

/* ------------------------------------------------------ Session ended */

/**
 * A write came back 401 (SPEC §4.10, D15): an `alertdialog` with focus on
 * "Sign in again". Whatever the person was writing is already kept on this
 * device, and comes back after signing in.
 */
function SessionEnded({ onClose }: { readonly onClose: () => void }): ReactNode {
  const signIn = useRef<HTMLAnchorElement | null>(null);
  return (
    <Dialog
      open
      role="alertdialog"
      onClose={onClose}
      title="Your session ended"
      description="Sign in again to carry on. What you were writing is kept on this device."
      size="sm"
      initialFocusRef={signIn}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Not now
          </Button>
          <Button ref={signIn as RefObject<HTMLButtonElement | null>} variant="primary" href={signInHref()}>
            Sign in again
          </Button>
        </>
      }
    >
      {null}
    </Dialog>
  );
}
