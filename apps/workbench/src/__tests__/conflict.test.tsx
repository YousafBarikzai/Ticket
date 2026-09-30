// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { outboxStore } from '@itsm/pwa';
import type { TimelineEntry } from '@itsm/sdk';
import { conflictChanges, stillApplies, type Directory } from '../client/mutations.js';
import { FakeEventSource, fakeFetch, noIdle, pointerDown, type Call } from './support/inbox.js';
import { cleanupDocument, click, type } from './support/render.js';
import { HISTORY, JO, ME, bundle, buttonNamed, cached, flush, menuItem, mountWorkspace, ticket, until } from './support/workspace.js';

const notify = vi.fn();
vi.mock('@itsm/ui', async (original) => ({
  ...(await original<typeof import('@itsm/ui')>()),
  notify: (...args: unknown[]) => notify(...args),
}));

/**
 * Two agents on one ticket is the normal case, not the race nobody hits
 * (SPEC §4.10, D15, F24). Every write carries the version the person was
 * looking at; when someone else got there first the service says 409, and
 * the workspace explains it — who changed what, when — and offers "Apply my
 * change on top" or "Keep theirs". After a comment has already gone, only
 * the status change is offered again: nothing is ever sent twice.
 */

/** Jo's change, recorded as the service records it: an event in the fresh history. */
function joChanged(type: string, payload: Record<string, unknown>): TimelineEntry {
  return { kind: 'event', id: `e-jo-${type}`, at: '2026-09-30T09:20:00.000Z', type, actorType: 'user', actorId: JO, payload };
}

let wire: ReturnType<typeof fakeFetch>;
/** What `GET /api/desk/tickets/…` answers: the ticket as it is after Jo's change. */
let fresh = bundle();
/** How each write answers, in turn: a status, or the ticket. */
let answers: { status?: number; body?: unknown }[] = [];

function respond(call: Call): { status?: number; body?: unknown } | undefined {
  if (call.url.startsWith('/api/desk/tickets/')) return { body: fresh };
  if (call.method === 'POST' && call.url.endsWith('/comments')) return { body: { id: 'c-new', visibility: 'public', createdAt: new Date().toISOString() } };
  if (call.method !== 'GET') {
    const next = answers.shift();
    if (next) return next;
    return { body: ticket({ version: 6 }) };
  }
  return undefined;
}

function writes(kind: 'transitions' | 'comments' | 'PATCH'): Call[] {
  return wire.calls.filter((call) => (kind === 'PATCH' ? call.method === 'PATCH' : call.method === 'POST' && call.url.endsWith(`/${kind}`)));
}

const conflict = { status: 409, body: { type: 'about:blank', title: 'Conflict', status: 409, detail: 'this ticket is at version 5; you sent 4' } };

function dialog(): HTMLElement | null {
  return document.querySelector('[role="alertdialog"]');
}

beforeEach(async () => {
  FakeEventSource.opened = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  noIdle();
  notify.mockClear();
  const store = await outboxStore();
  for (const item of await store.all()) await store.delete(item.id);
  fresh = bundle();
  answers = [];
  wire = fakeFetch(respond);
  vi.stubGlobal('fetch', wire.fetch);
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  cleanupDocument();
  vi.unstubAllGlobals();
});

async function choosePriority(label: string): Promise<void> {
  pointerDown(buttonNamed(/^Priority: /)!);
  await flush();
  click(menuItem(label)!);
  await flush(4);
}

describe('someone else changed it first', () => {
  it('explains what they changed and applies mine on top with the newer version', async () => {
    fresh = bundle({ ticket: ticket({ priority: 'P1', version: 5 }), entries: [...HISTORY, joChanged('updated', { changed: { priority: { before: 'P3', after: 'P1' } } })] });
    answers = [conflict];
    const view = await mountWorkspace();
    await choosePriority('P2 · High');

    await until(() => expect(dialog()).not.toBeNull());
    expect(dialog()!.textContent).toContain('INC-000123 changed while you were editing');
    expect(dialog()!.textContent).toContain('Jo Bloggs changed Priority to P1 · Critical');
    expect(dialog()!.textContent).toContain('Yours: P2 · High');
    // While the question is open, the ticket shows theirs — never a value nobody saved.
    expect(cached(view.client)?.ticket.priority).toBe('P1');

    click(buttonNamed('Apply my change on top', dialog()!)!);
    await until(() => expect(writes('PATCH')).toHaveLength(2));
    const [first, second] = writes('PATCH');
    expect(first?.headers['if-match']).toBe('"4"');
    expect(second?.headers['if-match']).toBe('"5"');
    expect(second?.body).toEqual({ priority: 'P2' });
    await until(() => expect(dialog()).toBeNull());
  });

  it('keeps theirs without writing again', async () => {
    fresh = bundle({ ticket: ticket({ priority: 'P1', version: 5 }), entries: [...HISTORY, joChanged('updated', { changed: { priority: { before: 'P3', after: 'P1' } } })] });
    answers = [conflict];
    const view = await mountWorkspace();
    await choosePriority('P2 · High');
    await until(() => expect(dialog()).not.toBeNull());

    click(buttonNamed('Keep theirs', dialog()!)!);
    await until(() => expect(dialog()).toBeNull());
    expect(writes('PATCH')).toHaveLength(1);
    expect(cached(view.client)?.ticket.priority).toBe('P1');
    expect(cached(view.client)?.ticket.version).toBe(5);
  });

  it('offers only "Retry status change" once the comment has gone — and never sends the comment twice', async () => {
    fresh = bundle({ ticket: ticket({ priority: 'P1', version: 5 }), entries: [...HISTORY, joChanged('updated', { changed: { priority: { before: 'P3', after: 'P1' } } })] });
    answers = [conflict];
    await mountWorkspace();
    click(document.querySelector<HTMLButtonElement>('.app-NextStep')!);
    await flush();
    type(document.querySelector<HTMLTextAreaElement>('.itsm-Popover textarea')!, 'Rolled back the firewall rule.');
    click(buttonNamed('Resolve', document.querySelector('.itsm-Popover')!)!);

    await until(() => expect(dialog()).not.toBeNull());
    expect(buttonNamed('Retry status change', dialog()!)).not.toBeNull();
    expect(buttonNamed('Don’t retry', dialog()!)).not.toBeNull();
    expect(buttonNamed('Apply my change on top', dialog()!)).toBeNull();
    expect(dialog()!.textContent).toContain('The rest of what you did was saved');

    click(buttonNamed('Retry status change', dialog()!)!);
    await until(() => expect(writes('transitions')).toHaveLength(2));
    expect(writes('transitions')[1]?.headers['if-match']).toBe('"5"');
    expect(writes('transitions')[1]?.body).toEqual({ to: 'resolved', reason: 'Rolled back the firewall rule.' });
    expect(writes('comments')).toHaveLength(1);
  });

  it('says so, without asking, when they already made the same change', async () => {
    fresh = bundle({ ticket: ticket({ status: 'pending_requester', statusCategory: 'paused', version: 5 }) });
    answers = [conflict];
    await mountWorkspace();
    pointerDown(buttonNamed(/^Status: /)!);
    await flush();
    click(menuItem('Wait on requester')!);
    await until(() => expect(notify).toHaveBeenCalledWith('Someone else already made this change', expect.anything()));
    expect(dialog()).toBeNull();
    expect(writes('transitions')).toHaveLength(1);
  });

  it('reloads once and tries again when the version was missing (428), without troubling the person', async () => {
    fresh = bundle({ ticket: ticket({ version: 5 }) });
    answers = [{ status: 428, body: { type: 'about:blank', title: 'Precondition required', status: 428 } }];
    await mountWorkspace();
    await choosePriority('P2 · High');
    await until(() => expect(writes('PATCH')).toHaveLength(2));
    expect(writes('PATCH')[1]?.headers['if-match']).toBe('"5"');
    expect(dialog()).toBeNull();
    await until(() => expect(notify).toHaveBeenCalledWith('Priority set to P2 · High', expect.objectContaining({ tone: 'success' })));
  });

  it('confirms a cancellation before sending it: there is no way back from cancelled', async () => {
    await mountWorkspace();
    pointerDown(buttonNamed(/^Status: /)!);
    await flush();
    click(menuItem('Cancel ticket')!);
    await flush();
    expect(dialog()?.textContent).toContain('Cancel INC-000123?');
    expect(writes('transitions')).toHaveLength(0);
    click(buttonNamed('Cancel ticket', dialog()!)!);
    await until(() => expect(writes('transitions')).toHaveLength(1));
    expect(writes('transitions')[0]?.body).toEqual({ to: 'cancelled' });
  });
});

describe('the explanation, as a rule', () => {
  const directory: Directory = {
    people: { [JO]: { name: 'Jo Bloggs', initials: 'JB' } },
    me: ME,
    teams: [{ id: '00000000-0000-4000-8000-0000000000f1', name: 'Network' }],
  };

  it('names who changed the field and when, from the fresh history', () => {
    const before = ticket();
    const theirs = ticket({ status: 'pending_third_party', version: 5 });
    const changes = conflictChanges({ kind: 'status', to: 'resolved' }, before, theirs, [...HISTORY, joChanged('status.changed', { from: 'in_progress', to: 'pending_third_party' })], directory);
    expect(changes).toEqual([{ field: 'Status', theirs: 'Waiting on supplier', mine: 'Resolved', by: 'Jo Bloggs', at: '2026-09-30T09:20:00.000Z' }]);
  });

  it('lists nothing when the field the person changed is as they left it', () => {
    const before = ticket();
    const theirs = ticket({ title: 'Renamed by Jo', version: 5 });
    expect(conflictChanges({ kind: 'priority', priority: 'P2' }, before, theirs, HISTORY, directory)).toEqual([]);
  });

  it('knows when mine can still go on top', () => {
    expect(stillApplies({ kind: 'status', to: 'resolved' }, ticket({ status: 'pending_third_party' }))).toBe(true);
    expect(stillApplies({ kind: 'status', to: 'resolved' }, ticket({ status: 'resolved' }))).toBe(false);
    expect(stillApplies({ kind: 'status', to: 'in_progress' }, ticket({ status: 'closed' }))).toBe(false);
    expect(stillApplies({ kind: 'priority', priority: 'P1' }, ticket({ priority: 'P1' }))).toBe(false);
    expect(stillApplies({ kind: 'assign', assigneeId: ME }, ticket({ assigneeId: JO }))).toBe(true);
  });
});
