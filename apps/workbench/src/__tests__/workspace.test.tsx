// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { outboxStore } from '@itsm/pwa';
import { deskKeys } from '../client/query-client.js';
import { nextStepFor } from '../workspace/NextStep.js';
import { conversationModel, hiddenCount, newSinceId, COLLAPSE_OVER, KEEP_LAST } from '../workspace/Conversation.js';
import { headlineTimer, statusChoices } from '../workspace/PropertyChips.js';
import { neighboursFrom } from '../workspace/TicketWorkspace.js';
import { FakeEventSource, fakeFetch, key, noIdle, pointerDown, stream, type Call } from './support/inbox.js';
import { cleanupDocument, click, type } from './support/render.js';
import { ADA, HISTORY, JO, ME, bundle, buttonNamed, cached, flush, menuItem, mountWorkspace, ticket, until } from './support/workspace.js';

const notify = vi.fn();
vi.mock('@itsm/ui', async (original) => ({
  ...(await original<typeof import('@itsm/ui')>()),
  notify: (...args: unknown[]) => notify(...args),
}));

/** The outbox's store: jsdom has no IndexedDB, so this is the in-memory one, emptied before each test. */
async function emptyOutbox(): Promise<void> {
  const store = await outboxStore();
  for (const item of await store.all()) await store.delete(item.id);
}

/**
 * The ticket workspace (SPEC §6.2): what it shows, what it lets the person
 * do, and the states around it — rendered as the inbox pane and the ticket
 * page render it, against a recording `fetch`.
 */

let wire: ReturnType<typeof fakeFetch>;
let deskAnswer: () => { status?: number; body?: unknown } = () => ({ body: bundle() });

function answerWrites(call: Call): { status?: number; body?: unknown } | undefined {
  if (call.url.startsWith('/api/desk/tickets/')) return deskAnswer();
  if (call.method === 'POST' && call.url.endsWith('/transitions')) {
    const body = call.body as { to: string };
    return { body: ticket({ status: body.to, version: 5 }) };
  }
  if (call.method === 'POST' && call.url.endsWith('/assign')) {
    const body = call.body as { assigneeId: string | null };
    return { body: ticket({ assigneeId: body.assigneeId, version: 5 }) };
  }
  if (call.method === 'PATCH') return { body: ticket({ ...(call.body as object), version: 5 }) };
  if (call.method === 'POST' && call.url.endsWith('/comments')) return { body: { id: 'c-new', visibility: 'public', createdAt: new Date().toISOString() } };
  return undefined;
}

beforeEach(async () => {
  FakeEventSource.opened = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  noIdle();
  notify.mockClear();
  await emptyOutbox();
  deskAnswer = () => ({ body: bundle() });
  wire = fakeFetch(answerWrites);
  vi.stubGlobal('fetch', wire.fetch);
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  cleanupDocument();
  vi.unstubAllGlobals();
});

function writes(): Call[] {
  return wire.calls.filter((call) => call.method !== 'GET');
}

describe('what the ticket shows', () => {
  it('names the ticket in its header: number, type and channel, then the title as the pane’s h2', async () => {
    await mountWorkspace();
    expect(document.querySelector('.app-WsHeader__meta')?.textContent).toBe('INC-000123 · Incident · Email');
    const title = document.querySelector('h2.app-WsHeader__title');
    expect(title?.textContent).toBe('VPN keeps dropping');
    expect(document.querySelector('h1')).toBeNull();
    // The inbox's detail pane is the ticket's `article`; the workspace adds no second one around itself.
    expect(document.querySelector('.app-Ws')?.tagName).toBe('DIV');
  });

  it('is the page’s article, with the title as its h1, on the full page', async () => {
    await mountWorkspace({ mode: 'page' });
    const region = document.querySelector<HTMLElement>('article.app-Ws');
    expect(region?.getAttribute('aria-label')).toBe('INC-000123');
    const h1 = document.querySelector('h1');
    expect(h1?.textContent).toBe('VPN keeps dropping');
    expect(h1?.getAttribute('tabindex')).toBe('-1');
  });

  it('gives the skip links their targets: the conversation and the reply', async () => {
    await mountWorkspace();
    expect(document.getElementById('ticket-conversation')?.getAttribute('tabindex')).toBe('-1');
    expect(document.getElementById('ticket-reply')?.getAttribute('tabindex')).toBe('-1');
    expect(document.getElementById('ticket-reply')?.querySelector('textarea')).not.toBeNull();
  });

  it('starts the conversation with the original request, then tells public replies and internal notes apart', async () => {
    await mountWorkspace();
    const original = document.querySelector('.app-Original');
    expect(original?.textContent).toContain('Ada Lovelace');
    expect(original?.textContent).toContain('Original request');
    expect(original?.textContent).toContain('Since this morning the VPN drops every ten minutes.');

    const message = (id: string): HTMLElement => {
      const found = [...document.querySelectorAll<HTMLElement>('.itsm-Timeline__item')].find((item) => item.textContent?.includes(id));
      if (!found) throw new Error(`no message "${id}"`);
      return found;
    };
    const fromAda = message('Yes, twice.');
    expect(fromAda.dataset.side).toBe('start');
    expect(fromAda.querySelector('.itsm-Timeline__bubble')?.getAttribute('data-surface')).toBe('raised');

    const mine = message('Have you tried restarting it?');
    expect(mine.dataset.side).toBe('end');
    expect(mine.querySelector('.itsm-Timeline__actor')?.textContent).toBe('You');

    const note = message('Probably the new firewall rule.');
    expect(note.hasAttribute('data-internal')).toBe(true);
    expect(note.textContent).toContain('Internal note');
    expect(note.querySelector('.itsm-Timeline__bubble')?.getAttribute('data-surface')).toBe('internal');
  });

  it('writes changes as sentences and puts days under headings', async () => {
    await mountWorkspace();
    const notices = [...document.querySelectorAll('.itsm-Timeline__notice')].map((notice) => notice.textContent ?? '');
    expect(notices.some((text) => text.includes('You') && text.includes('moved it from New to In progress'))).toBe(true);
    expect(notices.some((text) => text.includes('Ada Lovelace') && text.includes('raised it'))).toBe(true);
    expect(document.querySelectorAll('.itsm-Timeline__dayHeading').length).toBe(2);
  });

  it('says so when internal notes are hidden from the reader, and offers no Notes filter', async () => {
    await mountWorkspace({ bundle: bundle({ includesInternal: false, entries: HISTORY.filter((entry) => entry.id !== 'c-3'), can: { note: false } }) });
    expect(document.querySelector('.app-Conversation__hiddenNotes')?.textContent).toContain('Internal notes are hidden from you');
    const filters = [...document.querySelectorAll('.app-Conversation__filter [role="radio"]')].map((element) => element.textContent);
    expect(filters).toEqual(['All', 'Messages', 'Activity']);
  });

  it('shows the SLA in words, with the one next step at the end of the row', async () => {
    await mountWorkspace();
    expect(document.querySelector('.app-Sla')?.textContent).toContain('Resolution');
    expect(document.querySelector('.app-NextStep')?.textContent).toContain('Resolve…');
  });

  it('has at most one filled button in view: Send, once the composer is open', async () => {
    await mountWorkspace();
    // Send's chevron is part of the one split button, not a second action.
    const filled = (): Element[] => [...document.querySelectorAll('.itsm-Button--primary')].filter((button) => !button.classList.contains('itsm-SplitButton__more'));
    expect(filled()).toHaveLength(0);
    key(document.body, 'r');
    await flush();
    expect(filled()).toHaveLength(1);
    expect(filled()[0]?.textContent).toContain('Reply to requester');
    expect(document.querySelector('.app-NextStep')?.className).toContain('itsm-Button--tinted');
  });
});

describe('changing the ticket', () => {
  it('offers only the moves the state allows, the waiting states first', async () => {
    await mountWorkspace();
    pointerDown(buttonNamed(/^Status: /)!);
    await flush();
    const items = [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent?.trim());
    expect(items).toEqual(['Wait on requester', 'Wait on supplier', 'Needs approval', 'Resolve…', 'Cancel ticket']);
  });

  it('shows the status without a menu to someone who may not move it, and a tenant’s own state as a workflow’s', async () => {
    await mountWorkspace({ bundle: bundle({ can: { transition: false } }) });
    expect(buttonNamed(/^Status: /)).toBeNull();
    expect(document.querySelector('.app-Chip--static[data-field="status"]')?.textContent).toContain('In progress');
    cleanupDocument();

    await mountWorkspace({ bundle: bundle({ ticket: ticket({ status: 'awaiting_change_board' }) }) });
    expect(document.querySelector('.app-Chip--static[data-field="status"]')?.textContent).toContain('Managed by a workflow');
    expect(document.querySelector('.app-NextStep')).toBeNull();
  });

  it('moves the ticket with the next step, sending the version it was read at', async () => {
    const view = await mountWorkspace({ bundle: bundle({ ticket: ticket({ status: 'new', statusCategory: 'open' }) }) });
    // What the service says afterwards, when the workspace re-reads it for the new history line.
    deskAnswer = () => ({ body: bundle({ ticket: ticket({ status: 'in_progress', version: 5 }) }) });
    const step = document.querySelector<HTMLButtonElement>('.app-NextStep')!;
    expect(step.textContent).toContain('Start work');
    click(step);
    await flush();
    const [write] = writes();
    expect(write?.url).toBe('/api/proxy/api/v1/tickets/INC-000123/transitions');
    expect(write?.headers['if-match']).toBe('"4"');
    expect(write?.body).toEqual({ to: 'in_progress' });
    await until(() => expect(cached(view.client)?.ticket.version).toBe(5));
    expect(notify).toHaveBeenCalledWith('Moved to In progress', expect.objectContaining({ tone: 'success' }));
  });

  it('resolves with what fixed it: the reply first, then the move with it as the reason', async () => {
    await mountWorkspace();
    click(document.querySelector<HTMLButtonElement>('.app-NextStep')!);
    await flush();
    const popover = document.querySelector('.itsm-Popover')!;
    expect(popover.textContent).toContain('What fixed it? (sent to the requester)');
    type(popover.querySelector('textarea')!, 'Rolled back the firewall rule.');
    click(buttonNamed('Resolve', popover)!);
    await flush(6);
    const sent = writes();
    expect(sent.map((call) => call.url.split('/').at(-1))).toEqual(['comments', 'transitions']);
    expect(sent[0]?.body).toEqual({ body: 'Rolled back the firewall rule.', visibility: 'public' });
    expect(sent[0]?.headers['idempotency-key']).toBeTruthy();
    expect(sent[1]?.body).toEqual({ to: 'resolved', reason: 'Rolled back the firewall rule.' });
  });

  it('resolves from the status menu too, in a small dialog when the next step is something else', async () => {
    await mountWorkspace({ bundle: bundle({ ticket: ticket({ status: 'new' }) }) });
    pointerDown(buttonNamed(/^Status: /)!);
    await flush();
    click(menuItem('Resolve…')!);
    await flush();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.textContent).toContain('Resolve INC-000123');
    type(dialog!.querySelector('textarea')!, 'Duplicate of INC-000120; fixed there.');
    click(buttonNamed('Resolve', dialog!)!);
    await flush(6);
    expect(writes().map((call) => call.url.split('/').at(-1))).toEqual(['comments', 'transitions']);
  });

  it('opens the status menu with s, and assigns with i', async () => {
    await mountWorkspace({ bundle: bundle({ ticket: ticket({ assigneeId: null }) }) });
    key(document.body, 's');
    await flush();
    expect(menuItem('Wait on requester')).not.toBeNull();
    key(document.activeElement ?? document.body, 'Escape');
    await flush();

    key(document.body, 'i');
    await flush(4);
    const assign = writes().find((call) => call.url.endsWith('/assign'));
    expect(assign?.body).toEqual({ assigneeId: ME, method: 'manual' });
    expect(assign?.headers['if-match']).toBe('"4"');
  });

  it('keeps its keys to itself while the one-column inbox hides it', async () => {
    // jsdom has no layout: say the pane is hidden, as `display: none` does in a browser.
    const proto = HTMLElement.prototype as unknown as { checkVisibility?: () => boolean };
    proto.checkVisibility = () => false;
    try {
      await mountWorkspace({ bundle: bundle({ ticket: ticket({ assigneeId: null }) }) });
      key(document.body, 's');
      await flush();
      expect(menuItem('Wait on requester')).toBeNull();
      key(document.body, 'i');
      key(document.body, 'r');
      await flush(4);
      expect(writes()).toEqual([]);
      expect(document.activeElement?.tagName).not.toBe('TEXTAREA');
    } finally {
      delete proto.checkVisibility;
    }
  });

  it('sets the priority with p, then a number', async () => {
    await mountWorkspace();
    key(document.body, 'p');
    await flush();
    key(document.activeElement ?? document.body, '2');
    await flush(4);
    const patch = writes().find((call) => call.method === 'PATCH');
    expect(patch?.body).toEqual({ priority: 'P2' });
  });

  it('opens the composer in the mode asked for with r and n', async () => {
    await mountWorkspace();
    key(document.body, 'n');
    await flush();
    expect(document.activeElement?.tagName).toBe('TEXTAREA');
    expect(document.querySelector('.app-Composer__form')?.getAttribute('data-internal')).toBe('true');
    act(() => (document.activeElement as HTMLElement).blur());
    key(document.body, 'r');
    await flush();
    expect(document.querySelector('.app-Composer__form')?.getAttribute('data-internal')).toBe('false');
  });
});

describe('offline', () => {
  it('queues a reply in the outbox and shows it in the conversation until it is sent', async () => {
    wire = fakeFetch((call) => {
      if (call.method === 'POST' && call.url.endsWith('/comments')) throw new TypeError('Failed to fetch');
      return answerWrites(call);
    });
    vi.stubGlobal('fetch', wire.fetch);
    await mountWorkspace();
    const box = document.querySelector<HTMLTextAreaElement>('#ticket-reply textarea')!;
    type(box, 'Sent from the train.');
    await act(async () => {
      box.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush(6);
    await until(() => expect(document.querySelector('.app-Queued')?.textContent).toContain('Sent from the train.'));
    expect(document.querySelector('.app-Queued')?.textContent).toContain('Queued · sends when you’re back online');
    expect(box.value).toBe('');
    const [item] = await (await outboxStore()).all();
    expect(item?.action).toBe('add-comment');
    expect(item?.body).toEqual({ body: 'Sent from the train.', visibility: 'public' });
  });
});

describe('states', () => {
  it('says a ticket is not available — deleted or outside the reader’s teams — with a way to close it', async () => {
    deskAnswer = () => ({ status: 404, body: { status: 404, title: 'Not found' } });
    await mountWorkspace({ bundle: null });
    await flush(4);
    expect(document.body.textContent).toContain('INC-000123 isn’t available');
    expect(document.body.textContent).toContain('It may have been deleted, or it’s outside your teams.');
    expect(buttonNamed('Close')).not.toBeNull();
  });

  it('keeps the ticket on screen, and says so, when access is lost while it is open', async () => {
    const view = await mountWorkspace();
    deskAnswer = () => ({ status: 403, body: { status: 403, title: 'Forbidden' } });
    await act(async () => {
      await view.client.refetchQueries({ queryKey: deskKeys.ticket('INC-000123') });
    });
    await flush();
    expect(document.body.textContent).toContain('You no longer have access to this ticket');
    expect(document.querySelector('h2.app-WsHeader__title')?.textContent).toBe('VPN keeps dropping');
    expect(document.querySelector<HTMLTextAreaElement>('#ticket-reply textarea')?.disabled).toBe(true);
  });
});

describe('live', () => {
  it('re-reads the ticket on a notice, and offers a reply that arrives while someone is writing', async () => {
    const view = await mountWorkspace();
    const box = document.querySelector<HTMLTextAreaElement>('#ticket-reply textarea')!;
    type(box, 'Half a thought');
    deskAnswer = () => ({
      body: bundle({
        entries: [...HISTORY, { kind: 'comment', id: 'c-4', at: '2026-09-30T09:30:00.000Z', visibility: 'public', authorId: ADA, body: 'It works now!', channel: 'email' }],
      }),
    });
    act(() => stream().emit('change', { entity: 'ticket', id: bundle().ticket.id, action: 'comment.added', at: new Date().toISOString(), version: 4 }));
    await until(() => expect(wire.calls.some((call) => call.url === '/api/desk/tickets/INC-000123')).toBe(true));
    await until(() => expect(document.body.textContent).toContain('It works now!'));
    await until(() => expect(buttonNamed(/Ada Lovelace replied just now · Show/)).not.toBeNull());
    expect(buttonNamed(/Ada Lovelace replied just now · Show/)).not.toBeNull();
    // What was being written is untouched.
    expect(box.value).toBe('Half a thought');
    expect(cached(view.client)?.entries).toHaveLength(HISTORY.length + 1);
  });
});

describe('the rules behind it', () => {
  it('knows the one next step from each state', async () => {
    expect(nextStepFor('new')?.label).toBe('Start work');
    expect(nextStepFor('reopened')?.to).toBe('in_progress');
    expect(nextStepFor('in_progress')?.label).toBe('Resolve…');
    expect(nextStepFor('pending_third_party')?.label).toBe('Resume');
    expect(nextStepFor('resolved')?.to).toBe('closed');
    expect(nextStepFor('cancelled')?.label).toBe('Raise follow-up');
    expect(nextStepFor('awaiting_change_board')).toBeNull();
  });

  it('offers the waiting states first in the status menu', async () => {
    expect(statusChoices('new').map((choice) => choice.to)).toEqual([
      'pending_requester',
      'pending_third_party',
      'pending_approval',
      'in_progress',
      'resolved',
      'cancelled',
    ]);
    expect(statusChoices('closed')).toEqual([]);
  });

  it('speaks for the running timer due soonest', async () => {
    const base = { startedAt: '', remainingMs: 0, elapsedMs: 0, warningsFired: 0, metAt: null, breachedAt: null };
    const timers = [
      { ...base, id: 'a', targetType: 'response', state: 'met', dueAt: '2026-09-30T09:00:00.000Z' },
      { ...base, id: 'b', targetType: 'resolution', state: 'running', dueAt: '2026-09-30T15:00:00.000Z' },
      { ...base, id: 'c', targetType: 'update', state: 'running', dueAt: '2026-09-30T11:00:00.000Z' },
    ];
    expect(headlineTimer(timers)?.id).toBe('c');
    expect(headlineTimer([timers[0]!])?.id).toBe('a');
    expect(headlineTimer(null)).toBeNull();
  });

  it('marks what is new since the last visit: the first message someone else wrote after it', async () => {
    const model = conversationModel(bundle(), ME);
    expect(newSinceId(model, null)).toBeNull();
    expect(newSinceId(model, '2026-09-30T08:00:00.000Z')).toBe('c-2');
    expect(newSinceId(model, '2026-09-30T09:00:00.000Z')).toBeNull();
    // My own reply is never "new" to me.
    expect(model.othersMessages.map((message) => message.id)).toEqual(['c-2', 'c-3']);
  });

  it('folds a long history to its latest part, never past what is new', async () => {
    const events = Array.from({ length: COLLAPSE_OVER + 6 }, (_, index) => ({ id: `e-${index}`, title: 'x', timestamp: '2026-09-30T09:00:00.000Z' }));
    expect(hiddenCount(events.slice(0, COLLAPSE_OVER), null, false)).toBe(0);
    expect(hiddenCount(events, null, false)).toBe(events.length - KEEP_LAST);
    expect(hiddenCount(events, 'e-3', false)).toBe(3);
    expect(hiddenCount(events, null, true)).toBe(0);
  });

  it('files attachments with the message they came with, unopenable until downloads exist', async () => {
    const model = conversationModel(
      bundle({ attachments: [{ id: 'a-1', filename: 'trace.log', mime: 'text/plain', size: 2048, createdAt: '2026-09-30T08:30:20.000Z' }] }),
      ME,
    );
    const message = model.events.find((event) => event.id === 'c-2');
    expect(message?.attachments).toEqual([{ name: 'trace.log', size: 2048, mime: 'text/plain', state: 'unavailable' }]);
  });

  it('finds the neighbours and the way back in the list the ticket was opened from', async () => {
    const context = { href: '/inbox/mine', title: 'My work', numbers: ['INC-1', 'INC-000123', 'INC-9'] };
    expect(neighboursFrom(context, 'INC-000123')).toEqual({ previous: 'INC-1', next: 'INC-9', back: { href: '/inbox/mine', label: 'My work' } });
    expect(neighboursFrom(context, 'INC-1').previous).toBeNull();
    expect(neighboursFrom(null, 'INC-000123')).toEqual({ previous: null, next: null, back: { href: '/inbox', label: 'inbox' } });
  });

  it('names people the reader may not resolve honestly, never as a raw id', async () => {
    const model = conversationModel(bundle({ people: {} }), ME);
    const fromAda = model.events.find((event) => event.id === 'c-2');
    expect(typeof fromAda?.actor === 'object' && fromAda.actor.name).toMatch(/^Unknown person · /);
    expect(JSON.stringify(model.events.map((event) => event.actor))).not.toContain(JO);
  });
});
