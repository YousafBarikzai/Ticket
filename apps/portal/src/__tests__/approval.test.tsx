// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, cloneElement, forwardRef, isValidElement, Suspense, type AnchorHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutboxItem } from '@itsm/pwa';
import type { ApprovalDetail, ApprovalRequest, Me } from '@itsm/sdk';
import { ApiError } from '@itsm/sdk';
import { ItsmProvider } from '@itsm/ui';
import { structuralVariables, themeVariables } from '@itsm/ui/tokens';
import { cleanupDocument, click, clickAsync, render, type } from './support/render.js';

/**
 * Approvals (SPEC §6.3 `/approvals`, §3.8).
 *
 * Two rules on the decision, and both cost somebody something when they are
 * wrong.
 *
 * **A rejection has to say why.** An approval with no note costs nobody
 * anything. A rejection with no note is a request that stops dead with no way
 * forward — the requester cannot tell whether to change it, escalate it or
 * give up.
 *
 * **An offline decision is kept, not lost, and not pretended to have
 * happened.** It goes into the outbox and the screen says so, because a
 * decision that silently vanished is one an approver believes they made.
 *
 * Then the inbox around it: what waits (and not what this person already
 * answered), the sheet with what is being asked and the answers given,
 * focus moving to the next row after a decision, bulk approve with a
 * confirmation and one toast, ↑↓ between rows and no letter keys.
 */

interface Submitted {
  action: string;
  path: string;
  body: Record<string, unknown>;
  summary: string;
  idempotencyKey?: string;
}

type Result = { ok: boolean; queued: boolean; response?: Response; idempotencyKey?: string };

vi.mock('server-only', () => ({}));

/** Typed loosely on purpose: the component's contract with `@itsm/pwa` is what is under test. */
const submitOrQueue = vi.fn<(input: Submitted) => Promise<Result>>(async () => ({ ok: true, queued: false, response: new Response('{}', { status: 200 }) }));
let keys = 0;
const outbox = { items: [] as OutboxItem[], pending: 0, attention: [] as OutboxItem[], online: true, refresh: vi.fn(async () => undefined), retry: vi.fn(), dismiss: vi.fn() };
vi.mock('@itsm/pwa', () => ({
  submitOrQueue: (input: Submitted) => submitOrQueue(input),
  newIdempotencyKey: () => `key-${++keys}`,
  useOutbox: () => outbox,
}));

const refresh = vi.fn();
const router = { refresh, push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() };
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/approvals',
  useSearchParams: () => new URLSearchParams(window.location.search),
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
  notFound: () => {
    throw new Error('not found');
  },
}));

vi.mock('../app/AppLink.js', () => ({
  AppLink: forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: unknown }>(function AppLink({ prefetch, ...props }, ref) {
    void prefetch;
    return <a ref={ref} {...props} />;
  }),
}));

const browserApi = { approval: vi.fn(async (_id: string): Promise<ApprovalDetail> => detailOf(approval(A))) };
vi.mock('../client/api.js', () => ({ api: browserApi }));

const notify = vi.fn();
const announce = vi.fn();
vi.mock('@itsm/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itsm/ui')>();
  return {
    ...actual,
    announce: (...args: unknown[]) => announce(...args),
    notify: Object.assign((...args: unknown[]) => notify(...args), { dismiss: vi.fn(), promise: vi.fn(), progress: vi.fn() }),
  };
});

/* ---- The server, as the page sees it ------------------------------------- */

const ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';

let permissions: string[] = [];
let waiting: ApprovalRequest[] | null = [];
const serverApi = {
  approvals: vi.fn(async (_options?: unknown) => ({ data: [] as ApprovalRequest[] })),
  approval: vi.fn(async (id: string): Promise<ApprovalDetail> => detailOf(approval(id))),
};

vi.mock('../server/session.js', () => ({
  requireSession: async () => ({ id: 's1' }),
  currentMe: async (): Promise<Me> => ({
    actor: { type: 'user', id: ME, displayName: 'Grace Hopper' },
    tenant: { id: 't', name: 'Acme', slug: 'acme', region: 'eu' },
    permissions: permissions.map((key) => ({ key, scope: 'own' })),
    organisations: [],
    teamIds: [],
    locale: 'en-GB',
    timeZone: 'Europe/London',
  }),
  heldPermissions: (person: Me) => new Set(person.permissions.map((permission) => permission.key)),
  apiFor: () => serverApi,
  currentApprovals: async () => waiting,
}));

const { ApprovalDecision } = await import('../components/ApprovalDecision.js');
const page = await import('../app/(portal)/approvals/page.js');
const model = await import('../approvals/model.js');
const { readApprovals, withoutAnswered } = await import('../approvals/server.js');
// The lazy chunks, loaded once here so that opening them in a test is a matter of promises, not of transforming modules.
await import('../approvals/ApprovalSheet.js');
await import('../approvals/BulkApprove.js');
await import('@itsm/ui/overlays');

beforeAll(() => {
  const scope = globalThis as Record<string, unknown>;
  class Observer {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): [] {
      return [];
    }
  }
  scope.ResizeObserver ??= Observer;
  scope.IntersectionObserver ??= Observer;
  Element.prototype.scrollIntoView ??= () => undefined;
  scope.matchMedia ??= (query: string) => ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false });
});

/* ---- Fixtures -------------------------------------------------------------- */

const titles: Record<string, string> = { [A]: 'New laptop for Ada', [B]: 'VPN access for Linus', [C]: 'Adobe licence for Joan', [D]: 'Parking permit' };

function approval(id: string, extra: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id,
    policyId: 'p1',
    policyVersion: 1,
    subjectType: 'request',
    subjectId: `s-${id}`,
    ticketId: `t-${id}`,
    status: 'pending',
    outcome: null,
    requestedBy: 'u-ada',
    requestedAt: '2026-09-28T09:00:00Z',
    decidedAt: null,
    dueAt: null,
    version: 1,
    stepCount: 1,
    currentStep: { sequence: 1, name: 'Manager approval', status: 'open', dueAt: '2026-10-09T13:00:00Z', quorum: 1, decidedCount: 0 },
    subject: { kind: 'request', ticketNumber: `REQ-0000${id.charAt(0)}1`, title: titles[id] ?? 'Something', itemName: 'New laptop', requesterName: 'Ada Lovelace' },
    ...extra,
  };
}

function detailOf(request: ApprovalRequest, extra: Partial<ApprovalDetail> = {}): ApprovalDetail {
  return {
    ...request,
    steps: [
      {
        id: `step-${request.id}`,
        requestId: request.id,
        sequence: 1,
        name: 'Manager approval',
        quorum: request.currentStep?.quorum ?? 1,
        approverIds: [ME, 'someone-else'],
        status: request.status === 'pending' ? 'open' : request.status,
        openedAt: '2026-09-28T09:00:00Z',
        decidedAt: null,
        dueAt: request.currentStep?.dueAt ?? null,
        onTimeout: 'escalate',
        decisions: [],
      },
    ],
    answers: [
      { field: 'model', label: 'Which model?', value: 'mbp', display: 'MacBook Pro 14″' },
      { field: 'reason', label: 'Why do you need it?', value: '', display: '' },
    ],
    ...extra,
  };
}

/* ---- Rendering --------------------------------------------------------------- */

/** Awaits every async component, opens every `<Suspense>` onto what it resolved to, and leaves the rest to React. */
async function resolveServer(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map((child) => resolveServer(child as ReactNode)));
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (element.type === Suspense) return resolveServer(element.props.children);
  if (typeof element.type === 'function' && element.type.constructor.name === 'AsyncFunction') {
    return resolveServer(await (element.type as (props: unknown) => Promise<ReactNode>)(element.props));
  }
  const { children } = element.props;
  if (children === undefined) return element;
  if (Array.isArray(children)) return cloneElement(element, undefined, ...((await resolveServer(children)) as ReactNode[]));
  return cloneElement(element, undefined, await resolveServer(children));
}

function Link({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }): ReactNode {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}

function Provider({ children }: { children: ReactNode }): ReactNode {
  return (
    <ItsmProvider
      app="portal"
      Link={Link}
      router={router}
      usePathname={() => '/approvals'}
      useSearchParams={() => new URLSearchParams(window.location.search)}
      locale="en-GB"
      timeZone="Europe/London"
      storageScope={ME}
    >
      {children}
    </ItsmProvider>
  );
}

/** Lets lazy chunks, effects and promises land. */
async function settle(rounds = 6): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await act(async () => {
      await new Promise((resolveLater) => setTimeout(resolveLater, 0));
    });
  }
}

async function openPage(search: Record<string, string> = {}): Promise<void> {
  const query = new URLSearchParams(search).toString();
  window.history.replaceState(null, '', `/approvals${query ? `?${query}` : ''}`);
  const tree = await resolveServer(await page.default({ searchParams: Promise.resolve(search) }));
  render(<Provider>{tree}</Provider>);
  await settle();
}

function text(): string {
  return document.body.textContent?.replace(/\s+/g, ' ') ?? '';
}

function rowTitles(): string[] {
  return [...document.querySelectorAll('.app-ApprovalRow__title')].map((node) => node.textContent ?? '');
}

function rowButton(title: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>('.app-ApprovalRow__open')].find((node) => node.textContent?.includes(title));
  if (!found) throw new Error(`no row “${title}” in: ${text()}`);
  return found;
}

function button(name: string, within: ParentNode = document): HTMLButtonElement {
  const found = [...within.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent?.replace(/\s+/g, ' ').trim() === name);
  if (!found) throw new Error(`no button “${name}” in: ${text()}`);
  return found;
}

function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]');
}

function key(target: Element, name: string): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  keys = 0;
  permissions = ['approval.read', 'approval.decide'];
  waiting = [approval(A), approval(B)];
  submitOrQueue.mockReset();
  submitOrQueue.mockImplementation(async (input) => ({ ok: true, queued: false, response: new Response('{}', { status: 200 }), idempotencyKey: input.idempotencyKey ?? 'k' }));
  for (const mock of [...Object.values(serverApi), browserApi.approval]) mock.mockReset();
  serverApi.approvals.mockResolvedValue({ data: [] });
  serverApi.approval.mockImplementation(async (id: string) => detailOf(approval(id)));
  browserApi.approval.mockImplementation(async (id: string) => detailOf(approval(id)));
  for (const mock of [refresh, router.push, router.replace, notify, announce, outbox.refresh]) mock.mockClear();
  outbox.items = [];
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
});

afterEach(() => cleanupDocument());

/* ---- The decision ----------------------------------------------------------- */

function buttons(): HTMLButtonElement[] {
  return [...document.querySelectorAll('.app-Decision__actions button')] as HTMLButtonElement[];
}

function approve(): HTMLButtonElement {
  const found = buttons().find((node) => node.textContent?.includes('Approve'));
  if (!found) throw new Error('no approve button');
  return found;
}

function reject(): HTMLButtonElement {
  const found = buttons().find((node) => node.textContent?.includes('Reject'));
  if (!found) throw new Error('no reject button');
  return found;
}

/** What was actually posted, so the assertions are about the request the API sees. */
function lastRequest(): Submitted {
  const call = submitOrQueue.mock.calls.at(-1);
  if (!call) throw new Error('nothing was submitted');
  return call[0];
}

describe('deciding an approval', () => {
  it('approves without a note, in the API’s own vocabulary', async () => {
    render(<ApprovalDecision id="a-1" />);
    await clickAsync(approve());

    await vi.waitFor(() => expect(submitOrQueue).toHaveBeenCalled());
    expect(lastRequest()).toMatchObject({
      action: 'decide-approval',
      path: '/api/proxy/api/v1/approvals/a-1/decide',
      body: { decision: 'approved' },
    });
    expect(lastRequest().body).not.toHaveProperty('comment');
  });

  it('refuses to reject without a reason, and says why', () => {
    render(<ApprovalDecision id="a-1" />);
    click(reject());

    expect(submitOrQueue).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('cannot act on');
    // The reason goes where the missing words go.
    expect(document.activeElement).toBe(document.querySelector('textarea'));
    expect(document.querySelector('textarea')?.getAttribute('aria-describedby')).toContain(document.querySelector('[role="alert"]')!.id);
  });

  it('rejects once there is a reason', async () => {
    render(<ApprovalDecision id="a-1" />);
    const box = document.querySelector('textarea');
    if (!box) throw new Error('no comment box');

    type(box, 'The budget for this is not approved until April.');
    await clickAsync(reject());

    await vi.waitFor(() => expect(submitOrQueue).toHaveBeenCalled());
    expect(lastRequest().body).toEqual({
      decision: 'rejected',
      comment: 'The budget for this is not approved until April.',
    });
  });

  it('carries a note on an approval too, when there is one', async () => {
    render(<ApprovalDecision id="a-1" />);
    type(document.querySelector('textarea')!, 'Approved, but use the smaller model.');
    await clickAsync(approve());

    await vi.waitFor(() => expect(submitOrQueue).toHaveBeenCalled());
    expect(lastRequest().body).toMatchObject({ comment: 'Approved, but use the smaller model.' });
  });

  it('says plainly when somebody else got there first', async () => {
    submitOrQueue.mockResolvedValueOnce({ ok: false, queued: false, response: new Response('{}', { status: 409 }) });

    render(<ApprovalDecision id="a-1" />);
    await clickAsync(approve());

    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')).not.toBeNull());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('already decided');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('tells the person their offline decision is kept, not sent', async () => {
    submitOrQueue.mockResolvedValueOnce({ ok: false, queued: true });

    render(<ApprovalDecision id="a-1" />);
    await clickAsync(approve());

    await vi.waitFor(() => expect(document.querySelector('[role="status"]')).not.toBeNull());
    const note = document.querySelector('[role="status"]')?.textContent ?? '';
    expect(note).toContain('offline');
    // And it is honest about the one thing that could still go wrong.
    expect(note).toContain('unless somebody');
    // Not treated as done: the page does not re-read a list that has not changed.
    expect(refresh).not.toHaveBeenCalled();
    // The buttons leave with the queueing, and the sentence takes focus rather than losing it.
    expect(buttons()).toHaveLength(0);
    expect(document.activeElement).toBe(document.querySelector('[role="status"]'));
  });

  it('offers neither answer as the safe one', () => {
    // An approval is not the default. A screen that makes it the obvious click
    // produces approvals nobody read.
    render(<ApprovalDecision id="a-1" />);
    expect(approve().className).not.toBe(reject().className);
    expect(buttons()).toHaveLength(2);
  });

  it('sends the same key when the same answer is tried again, and a new one when the note changes', async () => {
    submitOrQueue.mockResolvedValueOnce({ ok: false, queued: false, response: new Response('{}', { status: 503 }) });
    render(<ApprovalDecision id="a-1" />);
    await clickAsync(approve());
    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toContain('didn’t send'));
    await clickAsync(approve());
    expect(submitOrQueue.mock.calls.map((call) => call[0].idempotencyKey)).toEqual(['key-1', 'key-1']);

    submitOrQueue.mockResolvedValueOnce({ ok: false, queued: false, response: new Response('{}', { status: 503 }) });
    type(document.querySelector('textarea')!, 'With a note now.');
    await clickAsync(approve());
    expect(lastRequest().idempotencyKey).toBe('key-2');
  });

  it('is one call however quickly it is pressed', async () => {
    let finish: (value: Result) => void = () => undefined;
    submitOrQueue.mockImplementationOnce(() => new Promise<Result>((done) => (finish = done)));
    render(<ApprovalDecision id="a-1" />);
    click(approve());
    click(approve());
    click(reject());
    expect(submitOrQueue).toHaveBeenCalledTimes(1);
    await act(async () => finish({ ok: true, queued: false, response: new Response('{}', { status: 200 }) }));
  });

  it('tells whoever holds it how it ended, and leaves the redraw to them', async () => {
    const settled = vi.fn();
    render(<ApprovalDecision id="a-1" onSettled={settled} />);
    await clickAsync(approve());
    expect(settled).toHaveBeenLastCalledWith({ kind: 'sent', decision: 'approved' });
    expect(refresh).not.toHaveBeenCalled();

    cleanupDocument();
    submitOrQueue.mockResolvedValueOnce({ ok: false, queued: false, response: new Response('{}', { status: 409 }) });
    render(<ApprovalDecision id="a-2" onSettled={settled} />);
    await clickAsync(approve());
    expect(settled).toHaveBeenLastCalledWith({ kind: 'conflict' });
  });

  it('can be taken apart: the note in one place, exactly two buttons in another', () => {
    render(
      <ApprovalDecision id="a-1" title="New laptop">
        {(parts) => (
          <>
            <section data-part="body">{parts.note}</section>
            <footer data-part="footer">{parts.actions}</footer>
          </>
        )}
      </ApprovalDecision>,
    );
    expect(document.querySelector('[data-part="body"] textarea')).not.toBeNull();
    expect(document.querySelectorAll('[data-part="footer"] .app-Decision__actions button')).toHaveLength(2);
    // Each button names what it decides, for a screen reader reading a list of them.
    expect(approve().textContent).toContain('New laptop');
  });
});

/* ---- The rules -------------------------------------------------------------- */

describe('the rules', () => {
  it('reads the scope and the drawer from the URL, and nothing else', () => {
    expect(model.scopeOf(undefined)).toBe('waiting');
    expect(model.scopeOf('decided')).toBe('decided');
    expect(model.scopeOf('nonsense')).toBe('waiting');
    expect(model.openIdOf(`approval:${A}`)).toBe(A);
    expect(model.openIdOf(`approval:${A.toUpperCase()}`)).toBe(A);
    expect(model.openIdOf('approval:not-an-id')).toBeNull();
    expect(model.openIdOf(`rule:${A}`)).toBeNull();
    expect(model.scopeHref('decided')).toBe('/approvals?show=decided');
  });

  it('says who asked, for what, how far it has got and when it is due — in words', () => {
    const now = new Date('2026-09-30T12:00:00Z');
    const item = model.itemOf(approval(A, { stepCount: 2, currentStep: { sequence: 2, name: 'Finance', status: 'open', dueAt: '2026-09-29T12:00:00Z', quorum: 2, decidedCount: 1 } }), now);
    expect(item.title).toBe('New laptop for Ada');
    expect(model.whatLine(item)).toBe('Ada Lovelace · New laptop · REQ-000011');
    expect(model.progressLine(item)).toBe('Step 2 of 2 · Finance · 1 of 2 approvers decided');
    expect(item.overdue).toBe(true);
    expect(model.waitingPill(item)).toMatchObject({ label: 'Overdue', icon: 'clock' });
    // A catalogue request is titled after its item: the item is not said twice.
    expect(model.whatLine({ ...item, title: 'New laptop' })).toBe('Ada Lovelace · REQ-000011');
    // A simple approval reads simply.
    expect(model.progressLine(model.itemOf(approval(B), now))).toBeNull();
    // Without the subject, the step's name stands in, never "undefined".
    expect(model.itemOf(approval(B, { subject: null }), now)).toMatchObject({ title: 'Manager approval', requester: null, known: false });
  });

  it('puts the overdue first, then what is due soonest', () => {
    const now = new Date('2026-09-30T12:00:00Z');
    const later = model.itemOf(approval(A, { currentStep: { sequence: 1, name: 'x', status: 'open', dueAt: '2026-10-05T12:00:00Z', quorum: 1, decidedCount: 0 } }), now);
    const sooner = model.itemOf(approval(B, { currentStep: { sequence: 1, name: 'x', status: 'open', dueAt: '2026-10-01T12:00:00Z', quorum: 1, decidedCount: 0 } }), now);
    const late = model.itemOf(approval(C, { currentStep: { sequence: 1, name: 'x', status: 'open', dueAt: '2026-09-01T12:00:00Z', quorum: 1, decidedCount: 0 } }), now);
    expect(model.inListOrder([later, sooner, late], 'waiting').map((item) => item.id)).toEqual([C, B, A]);
  });

  it('knows whose the decisions were, and when Approve and Reject may be offered', () => {
    const base = detailOf(approval(A, { currentStep: { sequence: 1, name: 'Managers', status: 'open', dueAt: null, quorum: 2, decidedCount: 1 } }));
    const mine = { ...base, steps: [{ ...base.steps[0]!, decisions: [{ id: 'd1', stepId: 'x', approverId: ME, actedById: null, decision: 'approved' as const, comment: ' Fine by me ', via: 'portal', decidedAt: '2026-09-29T10:00:00Z' }] }] };
    expect(model.answeredCurrentStep(base, ME)).toBe(false);
    expect(model.decidableBy(base, ME)).toBe(true);
    expect(model.answeredCurrentStep(mine, ME)).toBe(true);
    expect(model.decidableBy(mine, ME)).toBe(false);
    expect(model.myDecisions(mine, ME)).toEqual([{ decision: 'approved', comment: 'Fine by me', decidedAt: '2026-09-29T10:00:00Z', step: null }]);
    // Not named on the step: nothing to offer.
    expect(model.decidableBy({ ...base, steps: [{ ...base.steps[0]!, approverIds: ['someone-else'] }] }, ME)).toBe(false);
    // Settled: nothing to offer either.
    expect(model.decidableBy({ ...base, status: 'approved' }, ME)).toBe(false);
  });

  it('draws every step with what it needs or what happened to it', () => {
    const request = approval(A, { stepCount: 3, currentStep: { sequence: 2, name: 'Finance', status: 'open', dueAt: '2026-10-02T12:00:00Z', quorum: 2, decidedCount: 1 } });
    const detail = detailOf(request, {
      steps: [
        { ...detailOf(request).steps[0]!, id: 's1', sequence: 1, name: 'Manager', status: 'approved', decidedAt: '2026-09-29T09:00:00Z' },
        { ...detailOf(request).steps[0]!, id: 's2', sequence: 2, name: 'Finance', status: 'open', quorum: 2, decisions: [{ id: 'd', stepId: 's2', approverId: 'x', actedById: null, decision: 'approved', comment: null, via: 'api', decidedAt: '2026-09-29T11:00:00Z' }] },
        { ...detailOf(request).steps[0]!, id: 's3', sequence: 3, name: 'IT security', status: 'waiting' },
      ],
    });
    const steps = model.stepsOf(detail, (iso) => iso.slice(0, 10));
    expect(steps.map((step) => [step.label, step.status, step.description])).toEqual([
      ['Manager', 'complete', 'Approved 2026-09-29'],
      ['Finance', 'current', '1 of 2 approvers decided · due 2026-10-02'],
      ['IT security', 'upcoming', 'Next'],
    ]);
  });

  it('writes an answer in words: a date the reader’s way, an empty one as not answered', () => {
    expect(model.answerText({ display: '2026-10-12' }, (day) => `the ${day}`)).toBe('the 2026-10-12');
    expect(model.answerText({ display: 'Floor 3\nLondon' }, (day) => `the ${day}`)).toBe('Floor 3\nLondon');
    expect(model.answerText({ display: '  ' })).toBe('Not answered');
  });

  it('sums a bulk approval up in one toast, naming what somebody else had already decided', () => {
    expect(model.bulkSummary([{ id: A, title: 'A', outcome: 'sent' }, { id: B, title: 'B', outcome: 'sent' }])).toEqual({ title: 'Approved 2 requests', tone: 'success' });
    const mixed = model.bulkSummary([
      { id: A, title: 'Laptop', outcome: 'sent' },
      { id: B, title: 'VPN', outcome: 'conflict' },
      { id: C, title: 'Adobe', outcome: 'failed' },
    ]);
    expect(mixed.title).toBe('Approved 1 request · 1 already decided · 1 didn’t send');
    expect(mixed.description).toContain('Somebody else decided ‘VPN’ first.');
    expect(mixed.description).toContain('‘Adobe’ is still selected');
    expect(mixed.tone).toBe('warning');
    expect(model.bulkSummary([{ id: A, title: 'A', outcome: 'queued' }])).toMatchObject({ title: '1 request saved on this device', tone: 'info' });
  });
});

/* ---- The reads ---------------------------------------------------------------- */

describe('what the page reads', () => {
  it('leaves out what this person has already answered on a step that needs two', async () => {
    const shared = approval(B, { currentStep: { sequence: 1, name: 'Managers', status: 'open', dueAt: null, quorum: 2, decidedCount: 1 } });
    serverApi.approval.mockImplementation(async (id: string) => {
      const base = detailOf(id === B ? shared : approval(id));
      return id === B ? { ...base, steps: [{ ...base.steps[0]!, decisions: [{ id: 'd', stepId: 'x', approverId: ME, actedById: null, decision: 'approved', comment: null, via: 'portal', decidedAt: '2026-09-29T10:00:00Z' }] }] } : base;
    });
    const waitingOnMe = await withoutAnswered(serverApi as never, ME, [approval(A), shared]);
    expect(waitingOnMe.map((row) => row.id)).toEqual([A]);
    // Only the one that could be answered already was opened.
    expect(serverApi.approval.mock.calls.map((call) => call[0])).toEqual([B]);
  });

  it('lists as decided what is settled or answered, and not a later step that has not reached them', async () => {
    serverApi.approvals.mockResolvedValue({
      data: [approval(A), approval(B, { status: 'approved', decidedAt: '2026-09-29T10:00:00Z', currentStep: null }), approval(C), approval(D, { status: 'rejected', currentStep: null })],
    });
    serverApi.approval.mockImplementation(async (id: string) => {
      const base = detailOf(approval(id));
      // C waits on an earlier step; D was rejected before reaching them — it is settled, so it is listed.
      return id === C ? { ...base, steps: [{ ...base.steps[0]!, decisions: [] }] } : base;
    });
    const read = await readApprovals(serverApi as never, ME, [approval(A)], 'decided');
    expect(serverApi.approvals).toHaveBeenCalledWith({ includeDecided: true });
    expect(read.decided?.map((row) => row.id)).toEqual([B, D]);
  });
});

/* ---- The page ------------------------------------------------------------------- */

describe('the Approvals page', () => {
  it('lists what waits on you, with who asked, for what and when it is due, counted in its segment', async () => {
    await openPage();
    expect(document.querySelector('h1')?.textContent).toBe('Approvals');
    expect(rowTitles()).toEqual(['New laptop for Ada', 'VPN access for Linus']);
    expect(text()).toContain('Ada Lovelace · New laptop · REQ-000011');
    expect(text()).toContain('due');
    const segments = [...document.querySelectorAll<HTMLAnchorElement>('.app-Approvals__scopes a')];
    expect(segments.map((link) => link.getAttribute('href'))).toEqual(['/approvals', '/approvals?show=decided']);
    expect(segments[0]?.getAttribute('aria-current')).toBe('page');
    expect(segments[0]?.textContent).toContain('2');
  });

  it('puts each row’s checkbox beside its button, never inside it', async () => {
    await openPage();
    const row = document.querySelector('.app-ApprovalRow')!;
    const open = row.querySelector('button.app-ApprovalRow__open')!;
    expect(row.querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(open.querySelector('input, a, button')).toBeNull();
    expect(open.getAttribute('aria-haspopup')).toBe('dialog');
  });

  it('says there is nothing waiting — with the heading kept — and never that over a failed read', async () => {
    waiting = [];
    await openPage();
    expect(document.querySelector('h1')?.textContent).toBe('Approvals');
    expect(text()).toContain('Nothing waiting on you');

    cleanupDocument();
    waiting = null;
    await openPage();
    expect(text()).toContain('Couldn’t load what’s waiting on you');
    expect(text()).not.toContain('Nothing waiting on you');
  });

  it('tells somebody who is not an approver so, under the heading, and reads nothing', async () => {
    permissions = [];
    await openPage();
    expect(document.querySelector('h1')?.textContent).toBe('Approvals');
    expect(text()).toContain('Approvals aren’t part of your account');
    expect(serverApi.approvals).not.toHaveBeenCalled();
  });

  it('lists what you decided under Decided, with how each ended', async () => {
    serverApi.approvals.mockResolvedValue({ data: [approval(C, { status: 'approved', decidedAt: '2026-09-29T10:00:00Z', currentStep: null })] });
    await openPage({ show: 'decided' });
    expect(rowTitles()).toEqual(['Adobe licence for Joan']);
    expect(document.querySelector('.app-ApprovalRow__pill')?.textContent).toContain('Approved');
    // Nothing to tick: there is no deciding from here.
    expect(document.querySelector('.app-ApprovalRow input[type="checkbox"]')).toBeNull();
  });

  it('opens ?open=approval:<id> on a full load with what is being asked and the answers given', async () => {
    await openPage({ open: `approval:${B}` });
    expect(serverApi.approval).toHaveBeenCalledWith(B);
    const sheet = dialog();
    expect(sheet?.textContent).toContain('VPN access for Linus');
    expect(sheet?.textContent).toContain('Their answers');
    expect(sheet?.textContent).toContain('MacBook Pro 14″');
    expect(sheet?.textContent).toContain('Not answered');
    expect(sheet?.querySelectorAll('.app-Decision__actions button')).toHaveLength(2);
    // The server's copy: not read a second time from the browser.
    expect(browserApi.approval).not.toHaveBeenCalled();
  });

  it('says so when the approval behind a link is not available', async () => {
    serverApi.approval.mockRejectedValue(new ApiError(404, null, 'Not found'));
    await openPage({ open: `approval:${D}` });
    expect(dialog()?.textContent).toContain('That approval isn’t available any more');
    expect(dialog()?.querySelectorAll('.app-Decision__actions button')).toHaveLength(0);
  });

  it('opens a row in the sheet, pushing ?open= so Back closes it', async () => {
    await openPage();
    await clickAsync(rowButton('VPN access for Linus'));
    await settle();
    expect(window.location.search).toBe(`?open=approval%3A${B}`);
    expect(browserApi.approval).toHaveBeenCalledWith(B);
    expect(dialog()?.textContent).toContain('VPN access for Linus');

    await act(async () => {
      window.history.back();
      await new Promise((later) => setTimeout(later, 20));
    });
    await settle();
    expect(window.location.search).toBe('');
    expect(dialog()).toBeNull();
  });

  it('gives focus back to the row when the sheet is closed without a decision', async () => {
    await openPage();
    const row = rowButton('VPN access for Linus');
    row.focus();
    await clickAsync(row);
    await settle();
    expect(dialog()).not.toBeNull();
    await clickAsync(dialog()!.querySelector('.itsm-Sheet__close')!);
    await settle(10);
    expect(window.location.search).toBe('');
    expect(document.activeElement).toBe(rowButton('VPN access for Linus'));
    // Nothing was decided, so nothing left and nothing was read again.
    expect(rowTitles()).toEqual(['New laptop for Ada', 'VPN access for Linus']);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('after a decision: says so, the row leaves, focus moves to the next row and the list is read again', async () => {
    waiting = [approval(A), approval(B), approval(C)];
    await openPage();
    await clickAsync(rowButton('VPN access for Linus'));
    await settle();
    await clickAsync(approve());
    await settle(10);

    expect(lastRequest()).toMatchObject({ path: `/api/proxy/api/v1/approvals/${B}/decide`, body: { decision: 'approved' } });
    expect(notify).toHaveBeenCalledWith('Approved', expect.objectContaining({ tone: 'success', description: 'VPN access for Linus' }));
    expect(dialog()).toBeNull();
    expect(rowTitles()).not.toContain('VPN access for Linus');
    expect(document.activeElement).toBe(rowButton('Adobe licence for Joan'));
    expect(refresh).toHaveBeenCalled();
    // The count follows.
    expect(document.querySelector('.app-Approvals__scopes a')?.textContent).toContain('2');
  });

  it('puts focus on the heading when the last one has been decided', async () => {
    waiting = [approval(A)];
    await openPage();
    await clickAsync(rowButton('New laptop for Ada'));
    await settle();
    await clickAsync(approve());
    await settle(10);
    expect(text()).toContain('Nothing waiting on you');
    expect(document.activeElement).toBe(document.querySelector('h1'));
  });

  it('keeps the sheet open to say somebody else decided it, and drops the row once it is closed', async () => {
    await openPage();
    await clickAsync(rowButton('New laptop for Ada'));
    await settle();
    submitOrQueue.mockResolvedValueOnce({ ok: false, queued: false, response: new Response('{}', { status: 409 }) });
    await clickAsync(approve());
    await settle();
    expect(dialog()?.textContent).toContain('already decided');

    await clickAsync(dialog()!.querySelector('.itsm-Sheet__close')!);
    await settle(10);
    expect(dialog()).toBeNull();
    expect(rowTitles()).toEqual(['VPN access for Linus']);
    expect(document.activeElement).toBe(rowButton('VPN access for Linus'));
    expect(refresh).toHaveBeenCalled();
  });

  it('keeps an offline decision on the device, and the row says so', async () => {
    await openPage();
    await clickAsync(rowButton('New laptop for Ada'));
    await settle();
    submitOrQueue.mockResolvedValueOnce({ ok: false, queued: true });
    await clickAsync(approve());
    await settle();
    expect(dialog()?.textContent).toContain('saved on this device');
    expect(outbox.refresh).toHaveBeenCalled();

    await clickAsync(dialog()!.querySelector('.itsm-Sheet__close')!);
    await settle(10);
    const row = rowButton('New laptop for Ada');
    expect(row.textContent).toContain('Saved on this device');
    expect((row.closest('li')!.querySelector('input[type="checkbox"]') as HTMLInputElement).disabled).toBe(true);
    expect(document.activeElement).toBe(rowButton('VPN access for Linus'));
    // Decided, as far as they are concerned: no longer counted as to decide.
    expect(document.querySelector('.app-Approvals__scopes a')?.textContent).toContain('1');
  });

  it('reads a decision waiting in the outbox as saved on this device', async () => {
    outbox.items = [
      { id: 'o1', action: 'decide-approval', path: `/api/proxy/api/v1/approvals/${B}/decide`, method: 'POST', body: { decision: 'approved' }, idempotencyKey: 'k', status: 'pending', attempts: 0, queuedAt: 0, nextAttemptAt: 0, problem: null, summary: 'x' },
    ];
    await openPage();
    expect(rowButton('VPN access for Linus').textContent).toContain('Saved on this device');
    expect(rowButton('New laptop for Ada').textContent).not.toContain('Saved on this device');
  });

  it('approves the ticked ones after a confirmation that lists them, one at a time, with one toast', async () => {
    waiting = [approval(A), approval(B), approval(C)];
    await openPage();
    for (const title of ['New laptop for Ada', 'VPN access for Linus', 'Adobe licence for Joan']) {
      await clickAsync(rowButton(title).closest('li')!.querySelector('input[type="checkbox"]')!);
    }
    const bar = document.querySelector('.app-Approvals__bulk')!;
    expect(bar.textContent).toContain('3 selected');
    // Approve only: a rejection needs its own reason.
    expect([...bar.querySelectorAll('button')].map((node) => node.textContent?.trim())).toEqual(['Clear', 'Approve 3']);

    await clickAsync(button('Approve 3', bar));
    await settle();
    const confirm = dialog()!;
    expect(confirm.textContent).toContain('Approve 3 requests?');
    expect([...confirm.querySelectorAll('.app-BulkApprove__title')].map((node) => node.textContent)).toEqual(['New laptop for Ada', 'VPN access for Linus', 'Adobe licence for Joan']);
    expect(submitOrQueue).not.toHaveBeenCalled();

    const order: string[] = [];
    submitOrQueue.mockImplementation(async (input) => {
      order.push(input.path);
      const conflict = input.path.includes(B);
      return { ok: !conflict, queued: false, response: new Response('{}', { status: conflict ? 409 : 200 }), idempotencyKey: input.idempotencyKey ?? 'k' };
    });
    await clickAsync(button('Approve 3', confirm));
    await settle(10);

    expect(order).toEqual([A, B, C].map((id) => `/api/proxy/api/v1/approvals/${id}/decide`));
    expect(new Set(submitOrQueue.mock.calls.map((call) => call[0].idempotencyKey)).size).toBe(3);
    expect(notify).toHaveBeenCalledWith(
      'Approved 2 requests · 1 already decided',
      expect.objectContaining({ tone: 'warning', description: expect.stringContaining('‘VPN access for Linus’') }),
    );
    expect(dialog()).toBeNull();
    expect(rowTitles()).toEqual([]);
    expect(document.querySelector('.app-Approvals__bulk')).toBeNull();
    expect(refresh).toHaveBeenCalled();
  });

  it('moves between rows with ↑ and ↓, keeping to the buttons or the checkboxes, and has no letter keys', async () => {
    waiting = [approval(A), approval(B), approval(C)];
    await openPage();
    const first = rowButton('New laptop for Ada');
    first.focus();
    key(first, 'ArrowDown');
    expect(document.activeElement).toBe(rowButton('VPN access for Linus'));
    key(document.activeElement!, 'End');
    expect(document.activeElement).toBe(rowButton('Adobe licence for Joan'));
    key(document.activeElement!, 'ArrowUp');
    expect(document.activeElement).toBe(rowButton('VPN access for Linus'));
    key(document.activeElement!, 'j');
    key(document.activeElement!, 'k');
    expect(document.activeElement).toBe(rowButton('VPN access for Linus'));

    const box = rowButton('New laptop for Ada').closest('li')!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    box.focus();
    key(box, 'ArrowDown');
    expect(document.activeElement).toBe(rowButton('VPN access for Linus').closest('li')!.querySelector('input[type="checkbox"]'));
  });

  it('clears the selection with Escape', async () => {
    await openPage();
    const box = rowButton('New laptop for Ada').closest('li')!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await clickAsync(box);
    expect(document.querySelector('.app-Approvals__bulk')).not.toBeNull();
    key(box, 'Escape');
    expect(document.querySelector('.app-Approvals__bulk')).toBeNull();
    expect(announce).toHaveBeenCalledWith('Selection cleared');
  });
});

/* ---- Styles -------------------------------------------------------------------- */

describe('the styles for approvals', () => {
  it('reference no variable the design system does not emit, and never restyle a design-system part on its own', () => {
    const defined = new Set([...Object.keys(structuralVariables()), ...Object.keys(themeVariables('apple'))]);
    // Resolved from this file's path: a literal `new URL(…, import.meta.url)` is rewritten by the bundler into a served asset URL.
    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../approvals/approvals.css'), 'utf8');
    const used = [...new Set([...css.matchAll(/var\((--itsm-[a-zA-Z0-9-]+)/g)].map((match) => match[1]!))];
    expect(used.length).toBeGreaterThan(10);
    expect(used.filter((variable) => !defined.has(variable))).toEqual([]);
    expect(css).not.toMatch(/^\s*\.itsm-/m);
  });
});
