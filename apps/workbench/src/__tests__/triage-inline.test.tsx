// @vitest-environment jsdom
import { act, forwardRef, useMemo, useSyncExternalStore, type AnchorHTMLAttributes } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LiveProvider } from '@itsm/pwa/live';
import type { Suggestion, TriageSuggestion, TriageSuggestionItem } from '@itsm/sdk';
import { ItsmProvider } from '@itsm/ui';
import { directoryKeys, type TicketBundle } from '../client/desk-ticket.js';
import { deskKeys } from '../client/query-client.js';
import { SECTION_KEYS } from '../workspace/inspector/Inspector.js';
import { FakeEventSource, fakeFetch, noIdle, stream, type Call } from './support/inbox.js';
import { cleanupDocument, click, render, submit, type } from './support/render.js';
import { ME, TEAM, bundle, buttonNamed, flush, router, ticket, until } from './support/workspace.js';

/**
 * The inspector's AI triage, inline (SPEC §6.2, WP25), rendered inside the
 * real workspace against a recording `fetch`: each suggestion on the row it
 * would change, the strip while any wait, Accept all one at a time with the
 * version read again between each, "Set by AI" with Undo, and — with Assist
 * — a reply draft whose outcome is recorded when the reply is sent.
 */

const notify = vi.fn();
vi.mock('@itsm/ui', async (original) => ({
  ...(await original<typeof import('@itsm/ui')>()),
  notify: (...args: unknown[]) => notify(...args),
}));

const sendComment = vi.fn(async (input: { ticket: string; body: string; internal: boolean; idempotencyKey: string }) => ({
  status: 'sent' as const,
  idempotencyKey: input.idempotencyKey,
}));
vi.mock('../client/outbox.js', async (original) => ({
  ...(await original<typeof import('../client/outbox.js')>()),
  sendComment: (...args: unknown[]) => sendComment(...(args as [never])),
}));

const CATEGORY = '00000000-0000-4000-8000-0000000000c1';
const NUMBER = 'INC-000123';
const TICKET_ID = '00000000-0000-4000-8000-000000000123';

function suggestion(overrides: Partial<TriageSuggestionItem> = {}): TriageSuggestionItem {
  return { question: 'category', field: 'categoryId', kind: 'apply', value: CATEGORY, display: 'Access / VPN', confidence: 0.86, ...overrides };
}

function triage(overrides: Partial<TriageSuggestion> = {}): TriageSuggestion {
  return {
    decisionId: 'd-1',
    provider: 'rules',
    model: null,
    createdAt: '2026-09-30T08:00:00.000Z',
    suggestions: [
      suggestion(),
      suggestion({ question: 'group', field: 'groupId', value: TEAM, display: 'Network', confidence: 0.6 }),
      suggestion({ question: 'priority', field: 'priority', value: 'P2', display: 'P2', confidence: 0.9 }),
    ],
    applied: [],
    ...overrides,
  };
}

/* ------------------------------------------------------------ The world */

interface World {
  version: number;
  /** What PATCHes have changed on the ticket, so a re-read shows it. */
  changed: Record<string, unknown>;
  triage: TriageSuggestion | null;
  /** Answers to accepts, by question: a status to fail with. */
  refuse: Record<string, number>;
  suggestions: Suggestion[];
}

let world: World;
let wire: ReturnType<typeof fakeFetch>;

function answer(call: Call): { status?: number; body?: unknown } | undefined {
  const url = call.url;
  if (url.startsWith('/api/desk/tickets/')) return { body: bundle({ ticket: ticket({ ...world.changed, version: world.version }), can: { aiRead: true, ai: true } }) };
  if (url.includes('/ai/triage/')) return { body: { data: world.triage } };
  const accept = /\/ai\/decisions\/d-1\/suggestions\/([a-zA-Z]+)\/(accept|dismiss)$/.exec(url);
  if (accept && call.method === 'POST') {
    const question = accept[1]!;
    const refused = world.refuse[question];
    if (refused) return { status: refused, body: { status: refused, title: 'Refused', detail: 'Not now' } };
    if (accept[2] === 'accept') world.version += 1;
    return { body: { decisionId: 'd-1', question, response: accept[2] === 'accept' ? 'accepted' : 'dismissed' } };
  }
  const undo = /\/ai\/decisions\/d-1\/applied\/([a-zA-Z]+)\/undo$/.exec(url);
  if (undo && call.method === 'POST') {
    world.version += 1;
    return { body: { decisionId: 'd-1', question: undo[1], restored: null } };
  }
  if (url.endsWith(`/api/v1/tickets/${NUMBER}`) && call.method === 'GET') return { body: ticket({ version: world.version }) };
  if (url.endsWith(`/api/v1/tickets/${NUMBER}`) && call.method === 'PATCH') {
    world.version += 1;
    // High impact at medium urgency: the desk's matrix makes it a P2.
    world.changed = { ...world.changed, ...(call.body as object), priority: 'P2' };
    return { body: ticket({ ...world.changed, version: world.version }) };
  }
  if (url.includes('/field-definitions')) return { body: { data: [] } };
  if (url.includes(`/tickets/${NUMBER}/tags`)) return { body: { data: ['vpn'] } };
  if (url.endsWith(`/tickets/${NUMBER}/links`) && call.method === 'POST') return { status: 201, body: { sourceId: TICKET_ID, targetId: 'x', linkType: 'related_to' } };
  if (url.endsWith('/tasks/task-1/complete')) return { body: { id: 'task-1', status: 'done', completedAt: null } };
  if (url.includes('/ai/capabilities')) {
    return {
      body: {
        provider: 'test',
        capabilities: [
          { key: 'reply-draft', name: 'Reply draft', description: '', callsAModel: true, available: true, unavailableBecause: null },
          { key: 'article-draft', name: 'Article draft', description: '', callsAModel: true, available: false, unavailableBecause: 'this capability is switched off for this tenant' },
        ],
      },
    };
  }
  if (url.includes('/ai/suggestions?')) return { body: { data: world.suggestions } };
  if (url.endsWith('/ai/suggest') && call.method === 'POST') return { status: 202, body: { jobId: 'job-1', status: 'queued', suggestionId: null } };
  if (url.endsWith('/ai/jobs/job-1')) {
    return {
      body: {
        id: 'job-1',
        capability: 'reply-draft',
        status: 'completed',
        subjectType: 'ticket',
        subjectId: TICKET_ID,
        model: 'm',
        provider: 'p',
        inputTokens: 1,
        outputTokens: 1,
        cost: '1p',
        error: null,
        createdAt: '2026-09-30T09:00:00.000Z',
        finishedAt: '2026-09-30T09:00:05.000Z',
        suggestion: { id: 's-2', content: { text: 'Try the new client.' }, reason: 'A newer client fixes it.', confidence: 'medium', evidence: [], outcome: 'pending' },
      },
    };
  }
  if (/\/ai\/suggestions\/[^/]+\/outcome$/.test(url)) return { body: { id: 's-1', outcome: (call.body as { outcome: string }).outcome, outcomeAt: null } };
  if (url.includes('/knowledge/KB-12/link')) return { body: { articleKey: 'KB-12', ticketId: TICKET_ID, relation: 'referenced' } };
  if (url.endsWith('/knowledge/KB-12')) {
    return {
      body: {
        key: 'KB-12',
        title: 'Resetting the VPN certificate',
        status: 'published',
        audience: 'public',
        version: 3,
        summary: 'What to do when the client refuses to connect.',
        body: [{ type: 'paragraph', content: [{ text: 'Open the client and choose Reset.' }] }],
        keywords: [],
        helpfulCount: 4,
        unhelpfulCount: 0,
        reviewDueAt: null,
        publishedAt: '2026-09-01T09:00:00.000Z',
      },
    };
  }
  return undefined;
}

/* ------------------------------------------------------------ Mounting */

const Link = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean | null }>(function Link(
  { prefetch: _prefetch, ...props },
  ref,
) {
  return <a ref={ref} {...props} />;
});

/** `useSearchParams` as Next's behaves: it follows `history.pushState` and Back. */
const listeners = new Set<() => void>();
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
  };
}
function useLiveSearchParams(): URLSearchParams {
  const search = useSyncExternalStore(subscribe, () => window.location.search);
  return useMemo(() => new URLSearchParams(search), [search]);
}
const nativePush = window.history.pushState.bind(window.history);
const nativeReplace = window.history.replaceState.bind(window.history);

/** The workspace is wide enough for the inspector column. */
class WideObserver {
  constructor(private readonly callback: (entries: { contentRect: { width: number } }[]) => void) {}
  observe(): void {
    this.callback([{ contentRect: { width: 1280 } }]);
  }
  unobserve(): void {}
  disconnect(): void {}
}

async function mount(seeded: TicketBundle = bundle({ ticket: ticket({ version: world.version }), can: { aiRead: true, ai: true } })) {
  nativeReplace(null, '', `/inbox/mine?t=${NUMBER}`);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } } });
  client.setQueryData(deskKeys.ticket(NUMBER), seeded);
  client.setQueryData(directoryKeys.teams(), [{ id: TEAM, name: 'Network' }]);
  client.setQueryData(directoryKeys.categories(), [{ id: CATEGORY, name: 'VPN', path: 'Access / VPN' }]);
  const { TicketWorkspace } = await import('../workspace/TicketWorkspace.js');
  render(
    <ItsmProvider
      app="workbench"
      Link={Link}
      router={router}
      usePathname={() => window.location.pathname}
      useSearchParams={useLiveSearchParams}
      locale="en-GB"
      timeZone="Europe/London"
    >
      <QueryClientProvider client={client}>
        <LiveProvider topics={[`group:${TEAM}`]}>
          <TicketWorkspace ticketId={NUMBER} mode="pane" />
        </LiveProvider>
      </QueryClientProvider>
    </ItsmProvider>,
  );
  await flush(3);
  return { client };
}

function inspector(): HTMLElement {
  const found = document.querySelector<HTMLElement>('.app-Insp');
  if (!found) throw new Error('no inspector');
  return found;
}

function row(field: string): HTMLElement {
  const found = inspector().querySelector<HTMLElement>(`.app-InspRow[data-field="${field}"]`);
  if (!found) throw new Error(`no ${field} row`);
  return found;
}

function posts(): Call[] {
  return wire.calls.filter((call) => call.method !== 'GET');
}

beforeEach(() => {
  FakeEventSource.opened = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('ResizeObserver', WideObserver);
  noIdle();
  notify.mockClear();
  sendComment.mockClear();
  localStorage.clear();
  sessionStorage.clear();
  world = { version: 4, changed: {}, triage: triage(), refuse: {}, suggestions: [] };
  wire = fakeFetch(answer);
  vi.stubGlobal('fetch', wire.fetch);
  window.history.pushState = (...args: Parameters<History['pushState']>) => {
    nativePush(...args);
    for (const listener of listeners) listener();
  };
  window.history.replaceState = (...args: Parameters<History['replaceState']>) => {
    nativeReplace(...args);
    for (const listener of listeners) listener();
  };
});

afterEach(() => {
  cleanupDocument();
  vi.unstubAllGlobals();
  window.history.pushState = nativePush;
  window.history.replaceState = nativeReplace;
});

/* --------------------------------------------------------------- Tests */

describe('the inspector', () => {
  it('opens Details and SLA and keeps the rest closed until wanted', async () => {
    await mount();
    const sections = [...inspector().querySelectorAll<HTMLDetailsElement>('details.app-Insp__section')];
    const summary = (details: HTMLDetailsElement): string => details.querySelector('summary')?.textContent?.trim() ?? '';
    expect(sections.map(summary)).toEqual(['Details', 'SLA', 'Connections', 'TasksNone', 'Assist']);
    expect(sections.map((details) => details.open)).toEqual([true, true, false, false, false]);
    // The inspector is the `aside "Details"` region beside the conversation.
    expect(inspector().closest('aside')?.getAttribute('aria-label')).toBe('Details');
    expect(row('type').textContent).toContain('Fixed when the ticket was raised');
  });

  it('remembers a section someone opened', async () => {
    localStorage.setItem(`itsm-disclosure:${SECTION_KEYS.connections}`, 'open');
    await mount();
    await until(() => expect(inspector().querySelectorAll<HTMLDetailsElement>('details.app-Insp__section')[2]?.open).toBe(true));
  });

  it('changes impact in place with the version on screen, and takes the priority the service worked out', async () => {
    const { client } = await mount();
    const trigger = row('impact').querySelector<HTMLButtonElement>('button')!;
    expect(trigger.textContent).toContain('Medium');
    click(trigger);
    await flush();
    const select = row('impact').querySelector('select')!;
    act(() => {
      select.value = 'high';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush(4);
    const patch = posts().find((call) => call.method === 'PATCH');
    expect(patch?.body).toEqual({ impact: 'high' });
    expect(patch?.headers['if-match']).toBe('"4"');
    await until(() => expect(client.getQueryData<TicketBundle>(deskKeys.ticket(NUMBER))?.ticket.priority).toBe('P2'));
    expect(notify).toHaveBeenCalledWith('Impact set to High', expect.objectContaining({ tone: 'success' }));
  });

  it('reads the connections when they are first opened, with related tickets from the history', async () => {
    const entries = [
      ...bundle().entries,
      { kind: 'event' as const, id: 'e-link', at: '2026-09-30T08:50:00.000Z', type: 'linked', actorType: 'user', actorId: ME, payload: { targetId: 'x', targetNumber: 'INC-000118', linkType: 'caused_by' } },
    ];
    await mount(bundle({ ticket: ticket({ version: 4 }), entries, can: { aiRead: true, ai: true, link: true } }));
    expect(wire.calls.some((call) => call.url.includes('/tags'))).toBe(false);
    const details = inspector().querySelectorAll<HTMLDetailsElement>('details.app-Insp__section')[2]!;
    act(() => {
      details.open = true;
      details.dispatchEvent(new Event('toggle'));
    });
    await until(() => expect(details.textContent).toContain('vpn'));
    expect(details.querySelector('.app-Connections__link')?.textContent).toContain('Caused byINC-000118');
    click(buttonNamed('Link…', details)!);
    await flush(2);
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    type(dialog.querySelector('input')!, 'inc 42');
    click(buttonNamed('Link tickets', dialog)!);
    await until(() => expect(posts().find((call) => call.url.endsWith(`/tickets/${NUMBER}/links`))?.body).toEqual({ target: 'INC-000042', linkType: 'related_to' }));
  });

  it('ticks a task off with ticket.task.manage', async () => {
    const entries = [...bundle().entries, { kind: 'task' as const, id: 'task-1', at: '2026-09-30T08:40:00.000Z', title: 'Check the firewall rule', status: 'open', assigneeId: null }];
    await mount(bundle({ ticket: ticket({ version: 4 }), entries, can: { aiRead: true, ai: true, tasks: true } }));
    const details = inspector().querySelectorAll<HTMLDetailsElement>('details.app-Insp__section')[3]!;
    expect(details.querySelector('summary')?.textContent).toContain('1 open');
    const box = details.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    click(box);
    await until(() => expect(posts().some((call) => call.url.endsWith('/tasks/task-1/complete'))).toBe(true));
  });
});

describe('AI triage, where it acts', () => {
  it('puts each suggestion on its row and says how many wait at the top', async () => {
    await mount();
    await until(() => expect(document.querySelector('.app-Triage__line')?.textContent).toBe('AI triage: 3 suggestions'));
    const category = row('category');
    expect(category.querySelector('.app-TriageRow')?.textContent).toContain('Suggested: Access / VPN');
    expect(category.textContent).toContain('High confidence');
    const accept = buttonNamed('Accept category: Access / VPN', category)!;
    const description = document.getElementById(accept.getAttribute('aria-describedby') ?? '')?.textContent;
    expect(description).toBe('Set category to Access / VPN.');
    expect(row('team').textContent).toContain('Suggested: Network');
    expect(row('team').textContent).toContain('Medium confidence');
    expect(row('priority').textContent).toContain('Suggested: P2 · High');
  });

  it('accepts all one at a time, reading the version again between each, then re-reads the ticket', async () => {
    await mount();
    await until(() => expect(buttonNamed('Accept all')).not.toBeNull());
    click(buttonNamed('Accept all')!);
    await until(() => expect(notify).toHaveBeenCalledWith('3 suggestions accepted', expect.objectContaining({ tone: 'success' })));
    const relevant = wire.calls
      .filter((call) => /\/suggestions\/[a-z]+\/accept$/i.test(call.url) || call.url.endsWith(`/api/v1/tickets/${NUMBER}`))
      .map((call) => (call.method === 'POST' ? `accept ${call.url.split('/').at(-2)} @${(call.body as { version: number }).version}` : 'read version'));
    expect(relevant).toEqual(['accept category @4', 'read version', 'accept group @5', 'read version', 'accept priority @6']);
    // Afterwards the ticket (and with it the triage) is read again.
    const last = wire.calls.findLastIndex((call) => call.url.startsWith('/api/desk/tickets/'));
    const lastAccept = wire.calls.findLastIndex((call) => call.url.endsWith('/accept'));
    expect(last).toBeGreaterThan(lastAccept);
  });

  it('stops Accept all at a refusal and says how far it got', async () => {
    world.refuse.group = 422;
    await mount();
    await until(() => expect(buttonNamed('Accept all')).not.toBeNull());
    click(buttonNamed('Accept all')!);
    await until(() => expect(notify).toHaveBeenCalledWith('Accepted 1 of 3', expect.objectContaining({ tone: 'warning' })));
    const accepted = posts().filter((call) => call.url.endsWith('/accept')).map((call) => call.url.split('/').at(-2));
    expect(accepted).toEqual(['category', 'group']);
  });

  it('accepts one with the version on screen; a conflict re-reads the ticket and says so', async () => {
    await mount();
    await until(() => expect(buttonNamed('Accept team: Network')).not.toBeNull());
    click(buttonNamed('Accept team: Network')!);
    await until(() => expect(notify).toHaveBeenCalledWith('Team set to Network', expect.objectContaining({ tone: 'success' })));
    expect(posts().find((call) => call.url.endsWith('/group/accept'))?.body).toEqual({ version: 4 });

    notify.mockClear();
    world.refuse.priority = 409;
    await until(() => expect(buttonNamed('Accept priority: P2 · High')).not.toBeNull());
    click(buttonNamed('Accept priority: P2 · High')!);
    await until(() => expect(notify).toHaveBeenCalledWith('Someone else changed this ticket first', expect.objectContaining({ tone: 'warning' })));
  });

  it('dismisses without an Undo, and the suggestion leaves its row', async () => {
    await mount();
    await until(() => expect(buttonNamed('Dismiss the category suggestion')).not.toBeNull());
    click(buttonNamed('Dismiss the category suggestion')!);
    await until(() => expect(notify).toHaveBeenCalledWith('Category suggestion dismissed', expect.anything()));
    expect(notify.mock.calls.at(-1)?.[1]).not.toHaveProperty('action');
    expect(row('category').querySelector('.app-TriageRow')).toBeNull();
    expect(document.querySelector('.app-Triage__line')?.textContent).toBe('AI triage: 2 suggestions');
  });

  it('marks a value the AI set as "Set by AI" with Undo, and shows no strip for it', async () => {
    world.triage = triage({
      suggestions: [],
      applied: [{ question: 'group', field: 'groupId', value: TEAM, display: 'Network', confidence: 0.97, at: '2026-09-30T08:00:00.000Z' }],
    });
    await mount();
    await until(() => expect(row('team').textContent).toContain('Set by AI'));
    expect(row('team').querySelector('.itsm-Badge')?.textContent).toContain('Changed by');
    expect(document.querySelector('.app-Triage')).toBeNull();
    const undo = buttonNamed('Undo the team the AI set: Network', row('team'))!;
    expect(document.getElementById(undo.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'AI set team to Network. Undo puts back what it was before.',
    );
    click(undo);
    await until(() => expect(notify).toHaveBeenCalledWith('Put back what it was before', expect.objectContaining({ tone: 'success' })));
    expect(posts().find((call) => call.url.endsWith('/applied/group/undo'))?.body).toEqual({ version: 4 });
  });

  it('keeps the type note behind "1 more note" and offers the major-incident call as words and a summary to copy', async () => {
    world.triage = triage({
      suggestions: [
        suggestion({ question: 'type', field: null, kind: 'info', value: 'request', display: 'request' }),
        suggestion({ question: 'majorIncident', field: null, kind: 'warning', value: true, display: 'true' }),
      ],
    });
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await mount();
    await until(() => expect(document.querySelector('.app-Triage')).not.toBeNull());
    expect(buttonNamed('Accept all')).toBeNull();
    expect(document.querySelector('.app-Triage__notes summary')?.textContent).toContain('1 more note');
    const warning = document.querySelector('.app-Triage__warning')!;
    expect(warning.textContent).toContain('nothing is declared from here');
    click(buttonNamed('Copy summary', warning as HTMLElement)!);
    await until(() => expect(writeText).toHaveBeenCalled());
    expect(String((writeText.mock.calls[0] as unknown[])[0])).toContain(`${NUMBER} · VPN keeps dropping`);
  });

  it('shows suggestions without buttons to someone who may not act on them', async () => {
    await mount(bundle({ ticket: ticket({ version: 4 }), can: { aiRead: true, ai: false } }));
    await until(() => expect(row('category').textContent).toContain('Suggested: Access / VPN'));
    expect(buttonNamed(/^Accept/)).toBeNull();
    expect(buttonNamed(/^Dismiss/)).toBeNull();
  });

  it('shows no triage and no Assist without ai.read', async () => {
    await mount(bundle({ ticket: ticket({ version: 4 }) }));
    await flush(3);
    expect(document.querySelector('.app-TriageRow')).toBeNull();
    expect(wire.calls.some((call) => call.url.includes('/ai/'))).toBe(false);
    expect([...inspector().querySelectorAll('summary')].map((summary) => summary.textContent?.trim())).not.toContain('Assist');
  });
});

describe('Assist and the article sheet', () => {
  const draft: Suggestion = {
    id: 's-1',
    capability: 'reply-draft',
    subjectId: TICKET_ID,
    createdAt: '2026-09-30T08:30:00.000Z',
    content: { text: 'Please reset the VPN certificate.' },
    reason: 'The certificate expired on Monday.',
    confidence: 'high',
    evidence: [{ kind: 'article', id: 'a-1', title: 'Resetting the VPN certificate', ref: 'KB-12', extract: '…' }],
    outcome: 'pending',
  };

  async function openAssist(): Promise<HTMLElement> {
    const details = [...inspector().querySelectorAll<HTMLDetailsElement>('details.app-Insp__section')].at(-1)!;
    act(() => {
      details.open = true;
      details.dispatchEvent(new Event('toggle'));
    });
    await until(() => expect(details.querySelector('.itsm-AiSuggestion')).not.toBeNull());
    return details;
  }

  it('says why a capability is withheld, in words', async () => {
    world.suggestions = [draft];
    await mount();
    const assist = await openAssist();
    expect(assist.querySelector('.app-Assist__chips')?.textContent).toContain('Draft reply');
    expect(assist.querySelector('.app-Assist__withheld')?.textContent).toBe('Draft article · This capability is switched off for this tenant.');
  });

  it('asks for a draft, shows it working with Cancel, and settles when the service says the job ended', async () => {
    await mount();
    const details = [...inspector().querySelectorAll<HTMLDetailsElement>('details.app-Insp__section')].at(-1)!;
    act(() => {
      details.open = true;
      details.dispatchEvent(new Event('toggle'));
    });
    await until(() => expect(buttonNamed('Draft reply', details)).not.toBeNull());
    click(buttonNamed('Draft reply', details)!);
    await until(() => expect(details.querySelector('.app-Assist__running')?.textContent).toContain('Drafting a reply…'));
    expect(posts().find((call) => call.url.endsWith('/ai/suggest'))?.body).toEqual({ capability: 'reply-draft', ticketId: TICKET_ID });
    expect(buttonNamed('Cancel', details)).not.toBeNull();
    // The live notice is the fast path: no waiting for the five-second poll.
    act(() => stream().emit('change', { entity: 'ai_job', id: 'job-1', action: 'completed', at: new Date().toISOString() }));
    await until(() => expect(details.textContent).toContain('Try the new client.'));
    expect(details.querySelector('.app-Assist__running')).toBeNull();
  });

  it('inserts a reply draft and records what became of it when the reply is sent', async () => {
    world.suggestions = [draft];
    await mount();
    const assist = await openAssist();
    // Tinted: the composer's Send stays the view's one filled button.
    expect(buttonNamed('Insert into reply', assist)?.className).toContain('itsm-Button--tinted');
    click(buttonNamed('Insert into reply', assist)!);
    await flush(2);
    const box = document.querySelector<HTMLTextAreaElement>('#ticket-reply textarea, .app-Composer textarea')!;
    expect(box.value).toBe('Please reset the VPN certificate.');
    // Nothing is recorded at the click: the reply has not been sent yet.
    expect(posts().some((call) => call.url.endsWith('/outcome'))).toBe(false);
    expect(assist.textContent).toContain('In your reply.');

    await submit(box.form!);
    await until(() => expect(sendComment).toHaveBeenCalled());
    await until(() => expect(posts().find((call) => call.url.endsWith('/ai/suggestions/s-1/outcome'))?.body).toEqual({ outcome: 'accepted' }));
  });

  it('records an edited draft as edited', async () => {
    world.suggestions = [draft];
    await mount();
    const assist = await openAssist();
    click(buttonNamed('Insert into reply', assist)!);
    await flush(2);
    const box = document.querySelector<HTMLTextAreaElement>('.app-Composer textarea')!;
    type(box, 'Hi Ada, please restart the client instead.');
    await submit(box.form!);
    await until(() => expect(posts().find((call) => call.url.endsWith('/outcome'))?.body).toEqual({ outcome: 'edited' }));
  });

  it('opens article evidence in the article sheet over the ticket, and inserts it into the reply', async () => {
    world.suggestions = [draft];
    await mount();
    const assist = await openAssist();
    const evidence = assist.querySelector<HTMLAnchorElement>('.itsm-AiSuggestion__evidenceLink')!;
    expect(evidence.getAttribute('href')).toBe(`/inbox/mine?t=${NUMBER}&open=article:KB-12`);
    click(evidence);
    await until(() => expect(window.location.search).toBe(`?t=${NUMBER}&open=article:KB-12`));
    await until(() => expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Resetting the VPN certificate'));
    const sheet = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(sheet.textContent).toContain('Open the client and choose Reset.');
    click(buttonNamed('Insert into reply', sheet)!);
    await flush(3);
    expect(document.querySelector<HTMLTextAreaElement>('.app-Composer textarea')?.value).toBe(
      'This article in the help portal should help: “Resetting the VPN certificate”.',
    );
    await until(() => expect(posts().find((call) => call.url.endsWith('/knowledge/KB-12/link'))?.body).toEqual({ ticketId: TICKET_ID, relation: 'referenced' }));
  });
});
