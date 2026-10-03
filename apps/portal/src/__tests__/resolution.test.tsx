// @vitest-environment jsdom
import { act, forwardRef, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutboxItem, QueueInput, SubmitResult } from '@itsm/pwa';
import { ApiError } from '@itsm/sdk';
import { ItsmProvider } from '@itsm/ui';
import { cleanupDocument, clickAsync, render, submit, type } from './support/render.js';

/**
 * "Is it fixed?" on a request (SPEC §6.3, §6.4, F37): Yes closes it (PA1)
 * and falls back to an honest message where the API will not let a
 * requester close; No reopens **first** and then sends their words with one
 * key per intent, so a retry never reopens twice and never posts twice;
 * past the reopen window it says so and offers Report it again; every move
 * reads the request again when the answer is not a plain yes. Also the
 * quieter moves (withdraw, "It's sorted now") and Report it again.
 */

vi.mock('server-only', () => ({}));

const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({
  usePathname: () => '/tickets/INC-000123',
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('../app/AppLink.js', () => ({
  AppLink: forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: unknown }>(function AppLink({ prefetch, ...props }, ref) {
    void prefetch;
    return <a ref={ref} {...props} />;
  }),
}));

const helpFlow = { open: vi.fn(), available: true };
vi.mock('../components/PortalShell.js', () => ({ useHelpFlow: () => helpFlow }));

const browserApi = {
  transition: vi.fn(async (_n: string, _to: string, _v: number, _reason?: string) => ({}) as unknown),
  ticket: vi.fn(async (_n: string) => ({ status: 'resolved', version: 3 })),
};
vi.mock('../client/api.js', () => ({ api: browserApi }));

let keys = 0;
const submitOrQueue = vi.fn(async (input: QueueInput): Promise<SubmitResult> => ({ ok: true, queued: false, idempotencyKey: input.idempotencyKey ?? 'k' }));
const outbox = { items: [] as OutboxItem[], pending: 0, attention: [] as OutboxItem[], online: true, refresh: vi.fn(async () => undefined), retry: vi.fn(), dismiss: vi.fn() };
vi.mock('@itsm/pwa', () => ({
  submitOrQueue: (input: QueueInput) => submitOrQueue(input),
  newIdempotencyKey: () => `key-${++keys}`,
  useOutbox: () => outbox,
}));

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

const { moveRequest, confirmFixed, reopenWithMessage, sendMessage, CONFIRMED_MESSAGE } = await import('../requests/resolution.js');
const { RequestHero } = await import('../requests/RequestHero.js');
const { heroFor, stepsFor } = await import('../requests/model.js');
const { onSessionEnded } = await import('../client/useAction.js');

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => undefined;
});

/* ---- Fixtures ---------------------------------------------------------------- */

function problem(status: number, code: string, detail = 'refused', errors?: { field: string; code: string; message: string }[]): ApiError {
  return new ApiError(
    status,
    { type: `https://docs.itsm.example/problems/${code}`, title: code, status, detail, correlationId: 'c', ...(errors ? { errors } : {}) },
    detail,
  );
}

function response(status: number, body: unknown = null): Response {
  return new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/problem+json' } });
}

function fakeDeps() {
  return {
    transition: vi.fn(async (_n: string, _to: string, _v: number, _r?: string): Promise<unknown> => ({})),
    ticket: vi.fn(async (_n: string) => ({ status: 'resolved', version: 3 })),
    send: vi.fn(async (input: QueueInput): Promise<SubmitResult> => ({ ok: true, queued: false, idempotencyKey: input.idempotencyKey ?? 'k' })),
  };
}

beforeEach(() => {
  keys = 0;
  for (const mock of [router.refresh, router.replace, helpFlow.open, notify, announce, submitOrQueue, browserApi.transition, browserApi.ticket]) mock.mockReset();
  browserApi.transition.mockResolvedValue({});
  browserApi.ticket.mockResolvedValue({ status: 'resolved', version: 3 });
  submitOrQueue.mockImplementation(async (input) => ({ ok: true, queued: false, idempotencyKey: input.idempotencyKey ?? 'k' }));
  helpFlow.available = true;
  outbox.items = [];
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
});

afterEach(() => {
  cleanupDocument();
  vi.unstubAllGlobals();
});

/* ---- The moves, as rules --------------------------------------------------- */

describe('moveRequest', () => {
  it('writes against the version the page read', async () => {
    const deps = fakeDeps();
    await expect(moveRequest(deps, 'INC-000123', 3, 'closed')).resolves.toEqual({ kind: 'done' });
    expect(deps.transition).toHaveBeenCalledWith('INC-000123', 'closed', 3, undefined);
    expect(deps.ticket).not.toHaveBeenCalled();
  });

  it('on a conflict, reads it again and moves it once more on the fresh version while it still waits', async () => {
    const deps = fakeDeps();
    deps.transition.mockRejectedValueOnce(problem(409, 'conflict'));
    deps.ticket.mockResolvedValue({ status: 'resolved', version: 5 });
    await expect(moveRequest(deps, 'INC-000123', 3, 'closed')).resolves.toEqual({ kind: 'done' });
    expect(deps.transition.mock.calls.map((call) => call[2])).toEqual([3, 5]);
  });

  it('says it moved on when the request is somewhere the move no longer starts from', async () => {
    const deps = fakeDeps();
    deps.transition.mockRejectedValueOnce(problem(428, 'precondition_required'));
    deps.ticket.mockResolvedValue({ status: 'in_progress', version: 6 });
    await expect(moveRequest(deps, 'INC-000123', 3, 'closed')).resolves.toEqual({ kind: 'moved', status: 'in_progress' });
    expect(deps.transition).toHaveBeenCalledTimes(1);
  });

  it('treats a lost answer as done when the request is already where they wanted it', async () => {
    const deps = fakeDeps();
    deps.transition.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    deps.ticket.mockResolvedValue({ status: 'closed', version: 4 });
    await expect(moveRequest(deps, 'INC-000123', 3, 'closed')).resolves.toEqual({ kind: 'done' });
  });

  it('throws a lost answer when nothing changed, so the person can try again', async () => {
    const deps = fakeDeps();
    const lost = new TypeError('Failed to fetch');
    deps.transition.mockRejectedValueOnce(lost);
    await expect(moveRequest(deps, 'INC-000123', 3, 'closed')).rejects.toBe(lost);
    expect(deps.transition).toHaveBeenCalledTimes(1);
  });

  it('reads a refusal while the request still waits as "the API will not let a requester do this"', async () => {
    const deps = fakeDeps();
    deps.transition.mockRejectedValueOnce(problem(403, 'forbidden'));
    await expect(moveRequest(deps, 'INC-000123', 3, 'closed')).resolves.toEqual({ kind: 'refused' });
  });

  it('throws what needs no second look (422, 401, 5xx) without reading again', async () => {
    for (const failure of [problem(422, 'validation_failed'), problem(401, 'unauthorised'), problem(503, 'dependency_unavailable')]) {
      const deps = fakeDeps();
      deps.transition.mockRejectedValueOnce(failure);
      await expect(moveRequest(deps, 'INC-000123', 3, 'reopened', 'still broken')).rejects.toBe(failure);
      expect(deps.ticket).not.toHaveBeenCalled();
    }
  });

  it('counts a reopen as done once an agent has picked it back up; a withdrawal only from where one starts', async () => {
    const deps = fakeDeps();
    deps.transition.mockRejectedValueOnce(problem(409, 'conflict'));
    deps.ticket.mockResolvedValue({ status: 'in_progress', version: 7 });
    await expect(moveRequest(deps, 'INC-000123', 3, 'reopened', 'x')).resolves.toEqual({ kind: 'done' });

    const withdraw = fakeDeps();
    withdraw.transition.mockRejectedValueOnce(problem(409, 'conflict'));
    withdraw.ticket.mockResolvedValue({ status: 'in_progress', version: 7 });
    await expect(moveRequest(withdraw, 'INC-000123', 3, 'cancelled')).resolves.toEqual({ kind: 'moved', status: 'in_progress' });
  });

  it('sends a reason of at most 2,000 characters, and none when it is blank', async () => {
    const deps = fakeDeps();
    await moveRequest(deps, 'INC-000123', 3, 'reopened', `  ${'x'.repeat(2500)}  `);
    await moveRequest(deps, 'INC-000123', 3, 'resolved', '   ');
    expect((deps.transition.mock.calls[0]![3] as string).length).toBe(2000);
    expect(deps.transition.mock.calls[1]![3]).toBeUndefined();
  });
});

describe('Yes, it’s fixed', () => {
  it('closes it (PA1) and posts nothing', async () => {
    const deps = fakeDeps();
    await expect(confirmFixed(deps, 'INC-000123', 3, 'k1')).resolves.toEqual({ kind: 'closed' });
    expect(deps.transition).toHaveBeenCalledWith('INC-000123', 'closed', 3, undefined);
    expect(deps.send).not.toHaveBeenCalled();
  });

  it('falls back, where the API refuses a requester the close, to one public message with the caller’s key', async () => {
    const deps = fakeDeps();
    deps.transition.mockRejectedValue(problem(403, 'forbidden'));
    await expect(confirmFixed(deps, 'INC-000123', 3, 'k1')).resolves.toEqual({ kind: 'acknowledged', queued: false });
    await confirmFixed(deps, 'INC-000123', 3, 'k1');
    expect(deps.send).toHaveBeenCalledTimes(2);
    for (const [input] of deps.send.mock.calls) {
      expect(input).toMatchObject({
        action: 'add-comment',
        path: '/api/proxy/api/v1/tickets/INC-000123/comments',
        body: { body: CONFIRMED_MESSAGE, visibility: 'public' },
        idempotencyKey: 'k1',
      });
    }
  });

  it('says it moved on rather than closing a request that is no longer resolved', async () => {
    const deps = fakeDeps();
    deps.transition.mockRejectedValueOnce(problem(409, 'conflict'));
    deps.ticket.mockResolvedValue({ status: 'reopened', version: 9 });
    await expect(confirmFixed(deps, 'INC-000123', 3, 'k1')).resolves.toEqual({ kind: 'moved', status: 'reopened' });
    expect(deps.transition).toHaveBeenCalledTimes(1);
  });
});

describe('No, still broken', () => {
  it('reopens first, with their words as the reason, then sends the message with the intent’s key', async () => {
    const deps = fakeDeps();
    const order: string[] = [];
    deps.transition.mockImplementation(async () => {
      order.push('reopen');
      return {};
    });
    deps.send.mockImplementation(async (input) => {
      order.push('message');
      return { ok: true, queued: false, idempotencyKey: input.idempotencyKey ?? '' };
    });
    await expect(reopenWithMessage(deps, { number: 'INC-000123', version: 3, text: ' The VPN still drops ', key: 'k1', reopened: false })).resolves.toEqual({
      kind: 'done',
      queued: false,
    });
    expect(order).toEqual(['reopen', 'message']);
    expect(deps.transition).toHaveBeenCalledWith('INC-000123', 'reopened', 3, 'The VPN still drops');
    expect(deps.send.mock.calls[0]![0]).toMatchObject({ body: { body: 'The VPN still drops', visibility: 'public' }, idempotencyKey: 'k1' });
  });

  it('posts nothing when the reopen is refused by a conflict it cannot resolve', async () => {
    const deps = fakeDeps();
    deps.transition.mockRejectedValue(problem(409, 'conflict'));
    deps.ticket.mockResolvedValue({ status: 'resolved', version: 4 });
    const outcome = await reopenWithMessage(deps, { number: 'INC-000123', version: 3, text: 'still broken', key: 'k1', reopened: false });
    expect(outcome.kind).toBe('failed');
    expect(deps.send).not.toHaveBeenCalled();
  });

  it('keeps the reopen when the message fails, and a retry sends only the message, with the same key', async () => {
    const deps = fakeDeps();
    deps.send.mockResolvedValueOnce({ ok: false, queued: false, response: response(503, { status: 503, title: 'unavailable', type: 'x/dependency_unavailable', correlationId: 'c' }), idempotencyKey: 'k1' });
    const first = await reopenWithMessage(deps, { number: 'INC-000123', version: 3, text: 'still broken', key: 'k1', reopened: false });
    expect(first).toMatchObject({ kind: 'message-failed', problem: { status: 503 } });

    const second = await reopenWithMessage(deps, { number: 'INC-000123', version: 3, text: 'still broken', key: 'k1', reopened: true });
    expect(second).toEqual({ kind: 'done', queued: false });
    expect(deps.transition).toHaveBeenCalledTimes(1);
    expect(deps.send.mock.calls.map(([input]) => input.idempotencyKey)).toEqual(['k1', 'k1']);
  });

  it('says it is too late past the reopen window, and posts nothing', async () => {
    const deps = fakeDeps();
    deps.transition.mockRejectedValue(problem(422, 'validation_failed', 'this ticket was resolved more than 14 days ago; raise a linked ticket instead'));
    await expect(reopenWithMessage(deps, { number: 'INC-000123', version: 3, text: 'x', key: 'k', reopened: false })).resolves.toEqual({ kind: 'too-late' });
    expect(deps.send).not.toHaveBeenCalled();
  });

  it('does not mistake a field error for the window', async () => {
    const deps = fakeDeps();
    deps.transition.mockRejectedValue(problem(422, 'validation_failed', 'bad', [{ field: 'reason', code: 'too_big', message: 'too long' }]));
    const outcome = await reopenWithMessage(deps, { number: 'INC-000123', version: 3, text: 'x', key: 'k', reopened: false });
    expect(outcome.kind).toBe('failed');
  });

  it('says so when it was closed in the meantime', async () => {
    const deps = fakeDeps();
    deps.transition.mockRejectedValue(problem(409, 'conflict'));
    deps.ticket.mockResolvedValue({ status: 'closed', version: 4 });
    await expect(reopenWithMessage(deps, { number: 'INC-000123', version: 3, text: 'x', key: 'k', reopened: false })).resolves.toEqual({ kind: 'moved', status: 'closed' });
    expect(deps.send).not.toHaveBeenCalled();
  });

  it('queues the message offline after the reopen', async () => {
    const deps = fakeDeps();
    deps.send.mockResolvedValue({ ok: false, queued: true, idempotencyKey: 'k' });
    await expect(reopenWithMessage(deps, { number: 'INC-000123', version: 3, text: 'x', key: 'k', reopened: false })).resolves.toEqual({ kind: 'done', queued: true });
  });

  it('reads a 409 on the message as already taken (an idempotent create)', async () => {
    const send = vi.fn(async (): Promise<SubmitResult> => ({ ok: false, queued: false, response: response(409), idempotencyKey: 'k' }));
    await expect(sendMessage(send, 'INC-000123', 'x', 'k')).resolves.toEqual({ ok: true, queued: false });
  });
});

/* ---- The hero card ------------------------------------------------------------- */

function Link({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }): ReactNode {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}

function show(status: string, extra: Partial<Parameters<typeof RequestHero>[0]> = {}): void {
  render(
    <ItsmProvider
      app="portal"
      Link={Link}
      router={router}
      usePathname={() => '/tickets/INC-000123'}
      useSearchParams={() => new URLSearchParams()}
      locale="en-GB"
      timeZone="Europe/London"
      storageScope="u1"
    >
      <RequestHero
        number="INC-000123"
        title="VPN keeps dropping"
        status={status}
        version={3}
        hero={heroFor(status)}
        steps={stepsFor(status, { raised: '29 Sep', resolved: status === 'resolved' ? '30 Sep' : null, closed: null })}
        sla={null}
        tasks={null}
        approval={null}
        canMove
        canReply
        readerId="u1"
        {...extra}
      />
    </ItsmProvider>,
  );
}

function text(): string {
  return document.body.textContent?.replace(/\s+/g, ' ') ?? '';
}

function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>('button, a')].find((node) => node.textContent?.replace(/\s+/g, ' ').trim() === name);
  if (!found) throw new Error(`no “${name}” in: ${text()}`);
  return found;
}

function field(): HTMLTextAreaElement {
  const found = document.querySelector<HTMLTextAreaElement>('.app-RequestHero__panel textarea');
  if (!found) throw new Error('no field');
  return found;
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('the hero card: Is it fixed?', () => {
  it('is one card, with one heading that says the state, and Yes / No', () => {
    show('resolved');
    expect(document.querySelectorAll('.app-RequestHero')).toHaveLength(1);
    expect(document.querySelector('.app-RequestHero h2')?.textContent).toBe('Is it fixed?');
    expect(button('Yes, it’s fixed').className).toContain('primary');
    button('No, still broken');
    expect(document.querySelector('[aria-current="step"]')?.textContent).toContain('Resolved');
  });

  it('Yes closes it on the version read, thanks them and redraws', async () => {
    show('resolved');
    await clickAsync(button('Yes, it’s fixed'));
    expect(browserApi.transition).toHaveBeenCalledWith('INC-000123', 'closed', 3, undefined);
    expect(notify).toHaveBeenCalledWith('Thanks, we’ve closed it', { tone: 'success' });
    expect(router.refresh).toHaveBeenCalled();
    expect(submitOrQueue).not.toHaveBeenCalled();
  });

  it('Yes, where the API refuses the close, says it will close by itself — and posts once', async () => {
    browserApi.transition.mockRejectedValue(problem(403, 'forbidden'));
    show('resolved');
    await clickAsync(button('Yes, it’s fixed'));
    expect(submitOrQueue).toHaveBeenCalledTimes(1);
    expect(submitOrQueue.mock.calls[0]![0]).toMatchObject({ body: { body: 'Confirmed fixed. Thanks!' } });
    expect(text()).toContain('Thanks for confirming. It will close automatically.');
    expect(document.querySelector('.app-RequestHero')?.textContent).not.toContain('Yes, it’s fixed');
  });

  it('No opens the words in the card; nothing is sent without them', async () => {
    show('resolved');
    await clickAsync(button('No, still broken'));
    expect(document.activeElement).toBe(field());
    expect(document.querySelector('.app-RequestHero')?.textContent).not.toContain('Yes, it’s fixed');
    await submit(document.querySelector('.app-RequestHero__panel') as HTMLFormElement);
    expect(text()).toContain('Tell us what’s still happening');
    expect(browserApi.transition).not.toHaveBeenCalled();
  });

  it('Reopen request reopens, then sends the words, and says so', async () => {
    show('resolved');
    await clickAsync(button('No, still broken'));
    type(field(), 'It dropped again at 9');
    await submit(document.querySelector('.app-RequestHero__panel') as HTMLFormElement);
    expect(browserApi.transition).toHaveBeenCalledWith('INC-000123', 'reopened', 3, 'It dropped again at 9');
    expect(submitOrQueue).toHaveBeenCalledTimes(1);
    expect(submitOrQueue.mock.calls[0]![0]).toMatchObject({ action: 'add-comment', body: { body: 'It dropped again at 9', visibility: 'public' } });
    expect(browserApi.transition.mock.invocationCallOrder[0]).toBeLessThan(submitOrQueue.mock.invocationCallOrder[0]!);
    expect(notify).toHaveBeenCalledWith('Reopened. We’ll pick it back up.', { tone: 'success' });
    expect(router.refresh).toHaveBeenCalled();
  });

  it('a message that fails after the reopen is retried alone, with the same key — never a second reopen', async () => {
    submitOrQueue.mockResolvedValueOnce({ ok: false, queued: false, response: response(503), idempotencyKey: 'x' });
    show('resolved');
    await clickAsync(button('No, still broken'));
    type(field(), 'Still broken');
    await submit(document.querySelector('.app-RequestHero__panel') as HTMLFormElement);
    expect(text()).toContain('Reopened. Your message didn’t send.');
    expect(field().value).toBe('Still broken');

    await clickAsync(button('Try again'));
    expect(browserApi.transition).toHaveBeenCalledTimes(1);
    expect(submitOrQueue).toHaveBeenCalledTimes(2);
    const [first, second] = submitOrQueue.mock.calls.map(([input]) => input.idempotencyKey);
    expect(second).toBe(first);
    expect(notify).toHaveBeenCalledWith('Reopened. We’ll pick it back up.', { tone: 'success' });
  });

  it('a double press reopens once', async () => {
    let finish: () => void = () => undefined;
    browserApi.transition.mockImplementation(() => new Promise((resolve) => (finish = () => resolve({}))));
    show('resolved');
    await clickAsync(button('No, still broken'));
    type(field(), 'Still broken');
    const form = document.querySelector('.app-RequestHero__panel') as HTMLFormElement;
    await submit(form);
    await submit(form);
    await act(async () => finish());
    await flush();
    expect(browserApi.transition).toHaveBeenCalledTimes(1);
    expect(submitOrQueue).toHaveBeenCalledTimes(1);
  });

  it('past the window: “too long to reopen”, and Report it again carries their words', async () => {
    browserApi.transition.mockRejectedValue(problem(422, 'validation_failed', 'resolved more than 14 days ago'));
    show('resolved');
    await clickAsync(button('No, still broken'));
    type(field(), 'Broken again');
    await submit(document.querySelector('.app-RequestHero__panel') as HTMLFormElement);
    expect(text()).toContain('It’s been too long to reopen this.');
    expect(submitOrQueue).not.toHaveBeenCalled();
    await clickAsync(button('Report it again'));
    expect(helpFlow.open).toHaveBeenCalledWith({ step: 'details', text: 'VPN keeps dropping', details: 'Related to INC-000123.\n\nBroken again' });
  });

  it('offline, Reopen request and Yes say they need a connection (a transition never queues)', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    show('resolved');
    expect(button('Yes, it’s fixed').getAttribute('aria-disabled')).toBe('true');
    await clickAsync(button('No, still broken'));
    type(field(), 'x');
    const reopen = button('Reopen request');
    expect(reopen.getAttribute('aria-disabled')).toBe('true');
    expect(text()).toContain('Needs a connection');
    await clickAsync(reopen);
    expect(browserApi.transition).not.toHaveBeenCalled();
  });

  it('arriving with ?fixed=no opens the words, focused, and redraws at the plain address once reopened', async () => {
    window.history.replaceState(null, '', '/tickets/INC-000123?fixed=no');
    show('resolved', { startWithNo: true });
    expect(document.activeElement).toBe(field());
    type(field(), 'Still broken');
    await submit(document.querySelector('.app-RequestHero__panel') as HTMLFormElement);
    expect(router.replace).toHaveBeenCalledWith('/tickets/INC-000123', { scroll: false });
    expect(router.refresh).not.toHaveBeenCalled();
    window.history.replaceState(null, '', '/');
  });

  it('Escape closes the words and returns to No', async () => {
    show('resolved');
    await clickAsync(button('No, still broken'));
    await act(async () => {
      field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    expect(document.activeElement?.textContent).toBe('No, still broken');
  });

  it('a lost session goes to the frame, and the words stay', async () => {
    const heard = vi.fn();
    const stop = onSessionEnded(heard);
    browserApi.transition.mockRejectedValue(problem(401, 'unauthorised'));
    show('resolved');
    await clickAsync(button('No, still broken'));
    type(field(), 'Keep me');
    await submit(document.querySelector('.app-RequestHero__panel') as HTMLFormElement);
    stop();
    expect(heard).toHaveBeenCalledWith('action');
    expect(field().value).toBe('Keep me');
  });
});

describe('the hero card, other states', () => {
  it('Waiting for you: Reply opens the composer', () => {
    const opened = vi.fn();
    window.addEventListener('app:open-composer', opened);
    show('pending_requester');
    expect(document.querySelector('.app-RequestHero')?.getAttribute('data-tone')).toBe('hold');
    button('Reply').click();
    window.removeEventListener('app:open-composer', opened);
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it('More offers withdraw and “It’s sorted now” where the state machine allows them', async () => {
    show('pending_requester');
    const more = button('More');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    await clickAsync(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    button('Withdraw request');
    button('It’s sorted now');
    cleanupDocument();

    show('new');
    await clickAsync(button('More'));
    expect(text()).not.toContain('It’s sorted now');
    cleanupDocument();

    show('in_progress');
    await clickAsync(button('More'));
    expect(text()).not.toContain('Withdraw request');
  });

  it('withdrawing asks first, focuses Keep it, and cancels on the version read', async () => {
    show('new');
    await clickAsync(button('More'));
    await clickAsync(button('Withdraw request'));
    expect(text()).toContain('Withdraw this request?');
    expect(document.activeElement?.textContent).toBe('Keep it');
    const confirm = [...document.querySelectorAll<HTMLButtonElement>('.app-RequestHero__panel button')].find((node) => node.textContent === 'Withdraw request')!;
    await clickAsync(confirm);
    expect(browserApi.transition).toHaveBeenCalledWith('INC-000123', 'cancelled', 3, undefined);
    expect(notify).toHaveBeenCalledWith('Request withdrawn', { tone: 'success' });
  });

  it('“It’s sorted now” sends what fixed it as the reason (optional)', async () => {
    show('in_progress');
    await clickAsync(button('More'));
    await clickAsync(button('It’s sorted now'));
    type(field(), 'Restarted the router');
    await submit(document.querySelector('.app-RequestHero__panel') as HTMLFormElement);
    expect(browserApi.transition).toHaveBeenCalledWith('INC-000123', 'resolved', 3, 'Restarted the router');
  });

  it('closed: Report it again opens the flow at the details with the title and the link', async () => {
    show('closed');
    expect(document.querySelector('.app-RequestHero h2')?.textContent).toBe('Closed');
    expect(text()).not.toContain('More');
    await clickAsync(button('Report it again'));
    expect(helpFlow.open).toHaveBeenCalledWith({ step: 'details', text: 'VPN keeps dropping', details: 'Related to INC-000123.' });
  });

  it('without permission to move it, offers no moves at all', () => {
    show('resolved', { canMove: false });
    expect(text()).not.toContain('Yes, it’s fixed');
    expect(text()).not.toContain('More');
  });

  it('announces a change somebody else made, once', () => {
    show('in_progress');
    cleanupDocument();
    announce.mockClear();
    const tree = (status: string) => (
      <ItsmProvider app="portal" Link={Link} router={router} usePathname={() => '/'} useSearchParams={() => new URLSearchParams()} locale="en-GB" timeZone="Europe/London">
        <RequestHero
          number="INC-000123"
          title="t"
          status={status}
          version={3}
          hero={heroFor(status)}
          steps={[]}
          sla={null}
          tasks={null}
          approval={null}
          canMove
          canReply
          readerId="u1"
        />
      </ItsmProvider>
    );
    const view = render(tree('in_progress'));
    act(() => view.root.render(tree('resolved')));
    expect(announce).toHaveBeenCalledWith('This request is now: Is it fixed?');
    expect(announce).toHaveBeenCalledTimes(1);
  });
});
