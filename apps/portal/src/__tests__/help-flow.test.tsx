// @vitest-environment jsdom
import { act, forwardRef, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ItsmProvider } from '@itsm/ui';
import { cleanupDocument, click, clickAsync, render, submit, type } from './support/render.js';

/**
 * "How can we help?" (SPEC D17, §6.3, WP26 acceptance): one flow, two steps;
 * suggestions 300 ms after typing pauses; the same idempotency key online,
 * queued and on retry; the draft kept and restored; a clear ending with or
 * without the reply time; never a priority, an impact or a category.
 */

/* ---- The world around the flow ------------------------------------------ */

let pathname = '/';
const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() };

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('../app/AppLink.js', () => ({
  AppLink: forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: unknown; replace?: unknown; scroll?: unknown }>(
    function AppLink({ prefetch, replace, scroll, ...props }, ref) {
      void [prefetch, replace, scroll];
      return <a ref={ref} {...props} />;
    },
  ),
}));

const api = {
  search: vi.fn(async (_query: string, _options?: unknown) => ({ data: [] as unknown[], meta: { facets: {}, engine: 'meilisearch' } })),
  catalogue: vi.fn(async () => ({ data: [] as unknown[] })),
  myTickets: vi.fn(async (_filter?: unknown) => ({ data: [] as unknown[], nextCursor: null })),
  article: vi.fn(async (_key: string) => ({})),
  rateArticle: vi.fn(async (_key: string, _helpful: boolean) => ({ ok: true })),
  slaTimers: vi.fn(async (_number: string) => ({ ticketId: 't1', timers: [] as unknown[] })),
};
vi.mock('../client/api.js', () => ({ api }));

const notify = vi.fn();
vi.mock('@itsm/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itsm/ui')>();
  return { ...actual, notify: Object.assign((...args: unknown[]) => notify(...args), { dismiss: vi.fn(), promise: vi.fn(), progress: vi.fn() }) };
});

const { HelpFlow } = await import('../help/HelpFlow.js');
const { SUGGEST_DELAY_MS, forgetCatalogue } = await import('../help/suggestions.js');
const { onSessionEnded } = await import('../client/useAction.js');
const { outboxStore } = await import('@itsm/pwa');
const HelpSheet = (await import('../help/HelpSheet.js')).default;
type HelpFlowProps = Parameters<typeof HelpFlow>[0];

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

/* ---- The network, as the flow sees it ----------------------------------- */

interface Sent {
  readonly url: string;
  readonly key: string | null;
  readonly body: Record<string, unknown>;
}

const sent: Sent[] = [];
let answers: (() => Response)[] = [];

function respondWith(...responses: (() => Response)[]): void {
  answers = responses;
}

const offline = (): Response => {
  throw new TypeError('Failed to fetch');
};
const created = (number = 'INC-000124') => () => new Response(JSON.stringify({ id: 't1', number }), { status: 201, headers: { 'content-type': 'application/json' } });
const problem = (status: number, body: Record<string, unknown> = {}) => () =>
  new Response(JSON.stringify({ type: 'about:blank', title: 'Problem', status, ...body }), { status, headers: { 'content-type': 'application/problem+json' } });

beforeEach(() => {
  pathname = '/';
  sent.length = 0;
  answers = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    sent.push({ url, key: headers.get('idempotency-key'), body: JSON.parse(String(init.body)) as Record<string, unknown> });
    const next = answers.shift() ?? offline;
    return next();
  });
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  for (const mock of Object.values(api)) mock.mockClear();
  api.search.mockResolvedValue({ data: [], meta: { facets: {}, engine: 'meilisearch' } });
  api.catalogue.mockResolvedValue({ data: [] });
  api.myTickets.mockResolvedValue({ data: [], nextCursor: null });
  api.slaTimers.mockResolvedValue({ ticketId: 't1', timers: [] });
  notify.mockClear();
  router.push.mockClear();
  forgetCatalogue();
});

afterEach(async () => {
  cleanupDocument();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  const store = await outboxStore();
  for (const item of await store.all()) await store.delete(item.id);
});

/* ---- Mounting -------------------------------------------------------------- */

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
      usePathname={() => pathname}
      useSearchParams={() => new URLSearchParams()}
      locale="en-GB"
      timeZone="Europe/London"
      storageScope="u1"
    >
      {children}
    </ItsmProvider>
  );
}

const onClose = vi.fn();

function mount(props: Partial<Omit<HelpFlowProps, 'children'>> = {}): ReturnType<typeof render> {
  onClose.mockClear();
  return render(
    <Provider>
      <HelpFlow variant="page" userId="u1" onClose={onClose} {...props}>
        {(parts) => (
          <section aria-label="flow" data-phase={parts.phase}>
            <h1>{parts.title}</h1>
            {parts.stepLabel ? <p data-step="">{parts.stepLabel}</p> : null}
            {parts.body}
            <div data-footer="">{parts.footer}</div>
          </section>
        )}
      </HelpFlow>
    </Provider>,
  );
}

/* ---- Finding things ------------------------------------------------------ */

function phase(): string | null {
  return document.querySelector('[data-phase]')?.getAttribute('data-phase') ?? null;
}

function field(label: string): HTMLInputElement | HTMLTextAreaElement {
  const found = [...document.querySelectorAll('label')].find((node) => node.textContent?.replace(/\s+/g, ' ').includes(label));
  const id = found?.getAttribute('for');
  const control = id ? document.getElementById(id) : null;
  if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement)) throw new Error(`no field “${label}”`);
  return control;
}

function button(name: string): HTMLButtonElement | HTMLAnchorElement {
  const found = [...document.querySelectorAll<HTMLButtonElement | HTMLAnchorElement>('button, a')].find((node) => node.textContent?.replace(/\s+/g, ' ').trim().startsWith(name));
  if (!found) throw new Error(`no button “${name}” in: ${document.body.textContent}`);
  return found;
}

function bodyText(): string {
  return document.body.textContent?.replace(/\s+/g, ' ') ?? '';
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 4; turn += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function flush(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await settle();
}

async function toDetails(text = 'Printer on floor 3 is jammed'): Promise<void> {
  type(field('What do you need help with?') as HTMLInputElement, text);
  await clickAsync(button('Continue — report this as an issue'));
}

async function send(): Promise<void> {
  const form = document.querySelector('form#' + CSS_ID(button('Send report').getAttribute('form') ?? ''));
  if (!(form instanceof HTMLFormElement)) throw new Error('no report form');
  await submit(form);
  await settle();
}

/** `useId` ids contain colons; an id selector needs them escaped. */
function CSS_ID(id: string): string {
  return id.replace(/[:]/g, '\\:');
}

/* ---- Step 1: describe ------------------------------------------------------ */

const hit = { entityType: 'knowledge', entityId: 'a1', title: 'Set up the VPN', snippet: 'Connect to the <b>VPN</b> with <script>x</script>', rank: 1, facets: { key: 'set-up-vpn' } };

describe('step 1 · describe', () => {
  it('asks for suggestions 300 ms after typing pauses, and not before', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    api.search.mockResolvedValue({ data: [hit], meta: { facets: {}, engine: 'meilisearch' } });
    api.catalogue.mockResolvedValue({ data: [{ key: 'vpn-access', name: 'VPN access', description: null, shortSummary: 'Remote access', formKey: null, service: 'Network', serviceKey: 'network' }] });
    api.myTickets.mockResolvedValue({ data: [{ id: 't9', number: 'INC-000009', type: 'incident', title: 'VPN keeps dropping', status: 'pending_requester', updatedAt: '2026-09-29T10:00:00Z' }], nextCursor: null });
    mount();

    expect(phase()).toBe('describe');
    expect(document.querySelector('[data-step]')?.textContent).toBe('Step 1 of 2 · Describe it');
    type(field('What do you need help with?') as HTMLInputElement, 'vpn');
    await flush(SUGGEST_DELAY_MS - 1);
    expect(api.search).not.toHaveBeenCalled();

    await flush(1);
    expect(api.search).toHaveBeenCalledWith('vpn', { types: 'knowledge', limit: 4 });
    expect(api.myTickets).toHaveBeenCalledWith({ q: 'vpn', limit: 3 });
    const groups = [...document.querySelectorAll('.app-HelpFlow__groupTitle')].map((node) => node.textContent);
    expect(groups).toEqual(['Answers', 'Services', 'Your requests']);
    expect(bodyText()).toContain('VPN access');
    expect(bodyText()).toContain('INC-000009');
    // The snippet's markers become <mark>; anything else in it stays text.
    const mark = document.querySelector('.app-HelpFlow__optionDetail mark');
    expect(mark?.textContent).toBe('VPN');
    expect(document.querySelector('.app-HelpFlow__optionDetail script')).toBeNull();
    expect(bodyText()).toContain('<script>x</script>');
  });

  it('drops an answer that arrives after the person typed on', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let release: (value: unknown) => void = () => undefined;
    api.search.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)) as never);
    mount();
    type(field('What do you need help with?') as HTMLInputElement, 'vp');
    await flush(SUGGEST_DELAY_MS);
    type(field('What do you need help with?') as HTMLInputElement, 'printer');
    release({ data: [hit], meta: { facets: {}, engine: 'meilisearch' } });
    await settle();
    expect(bodyText()).not.toContain('Set up the VPN');
  });

  it('asks only for what the person may see', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    mount({ can: { search: false, readKnowledge: true, readCatalogue: false } });
    type(field('What do you need help with?') as HTMLInputElement, 'laptop');
    await flush(SUGGEST_DELAY_MS);
    expect(api.search).not.toHaveBeenCalled();
    expect(api.catalogue).not.toHaveBeenCalled();
    expect(api.myTickets).toHaveBeenCalled();
    expect(bodyText()).toContain('Nothing we know of matches “laptop”');
  });

  it('asks "Is it this?" when an open incident sounds like the description, until it is something else', async () => {
    mount({
      knownIssues: {
        issues: [{ id: 'i1', title: 'VPN degraded', impact: 'major', components: ['Remote access'], updatedAt: '2026-09-30T09:00:00Z' }],
        followUrl: 'https://api.example.test/status/acme',
      },
    });
    type(field('What do you need help with?') as HTMLInputElement, 'my vpn keeps dropping');
    expect(bodyText()).toContain('Is it this?');
    expect(bodyText()).toContain('VPN degraded.');
    const follow = button('Follow updates') as HTMLAnchorElement;
    expect(follow.getAttribute('href')).toBe('https://api.example.test/status/acme');
    expect(follow.getAttribute('target')).toBe('_blank');

    click(button('It’s something else'));
    expect(bodyText()).not.toContain('Is it this?');
  });

  it('opens an answer inside the flow, and "This solved it" records it and closes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    api.search.mockResolvedValue({ data: [hit], meta: { facets: {}, engine: 'meilisearch' } });
    api.article.mockResolvedValue({ key: 'set-up-vpn', title: 'Set up the VPN', status: 'published', audience: 'all', version: 1, summary: 'Five minutes.', body: [], keywords: [], helpfulCount: 0, unhelpfulCount: 0, reviewDueAt: null, publishedAt: null });
    mount();
    type(field('What do you need help with?') as HTMLInputElement, 'vpn');
    await flush(SUGGEST_DELAY_MS);

    await clickAsync(document.querySelector('[data-answer="a1"]')!);
    await settle();
    expect(api.article).toHaveBeenCalledWith('set-up-vpn');
    expect(document.querySelector('.app-HelpAnswer__title')?.textContent).toBe('Set up the VPN');
    expect(document.activeElement).toBe(document.querySelector('.app-HelpAnswer__title'));

    await clickAsync(button('This solved it'));
    expect(api.rateArticle).toHaveBeenCalledWith('set-up-vpn', true);
    expect(notify).toHaveBeenCalledWith('Glad that helped', { tone: 'success' });
    expect(onClose).toHaveBeenCalled();
  });

  it('will not continue without words, and carries them to the title when it does', async () => {
    mount();
    await clickAsync(button('Continue — report this as an issue'));
    expect(phase()).toBe('describe');
    expect(bodyText()).toContain('Tell us what you need help with first.');

    await toDetails('Printer on floor 3 is jammed');
    expect(phase()).toBe('details');
    expect(document.querySelector('[data-step]')?.textContent).toBe('Step 2 of 2 · Add the details');
    expect((field('Title') as HTMLInputElement).value).toBe('Printer on floor 3 is jammed');
    expect(document.activeElement).toBe(field('Title'));
  });

  it('keeps a long description whole: its first sentence is the title, all of it the details', async () => {
    mount();
    const long = 'The printer on floor 3 is jammed again. It shows error E-04 and the paper tray will not open, even after turning it off and on twice this morning.';
    await toDetails(long);
    expect((field('Title') as HTMLInputElement).value).toBe('The printer on floor 3 is jammed again.');
    expect((field('Details') as HTMLTextAreaElement).value).toBe(long);
  });
});

/* ---- Step 2: details and sending ------------------------------------------- */

describe('step 2 · details', () => {
  it('asks how much it holds them up, in their words, and never for a priority, impact or category', async () => {
    mount();
    await toDetails();
    const text = bodyText();
    for (const choice of ['I can work around it', 'It is slowing me down', 'I cannot work']) expect(text).toContain(choice);
    expect(text).not.toMatch(/priority|impact|category/i);
    const checked = document.querySelector('[role="radio"][aria-checked="true"]');
    expect(checked?.textContent).toContain('It is slowing me down');
  });

  it('sends the report, then says what happens next and when we aim to reply', async () => {
    const due = new Date(Date.now() + 2 * 3_600_000).toISOString();
    api.slaTimers.mockResolvedValue({ ticketId: 't1', timers: [{ id: 's1', targetType: 'response', state: 'running', startedAt: new Date().toISOString(), dueAt: due, remainingMs: 1, elapsedMs: 0, warningsFired: 0, metAt: null, breachedAt: null }] });
    respondWith(created('INC-000124'));
    mount();
    await toDetails();
    click([...document.querySelectorAll('[role="radio"]')].find((radio) => radio.textContent?.includes('I cannot work'))!);
    await send();

    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe('/api/proxy/api/v1/tickets');
    expect(sent[0]!.body).toEqual({ type: 'incident', title: 'Printer on floor 3 is jammed', urgency: 'high', sourceChannel: 'portal' });
    expect(sent[0]!.key).toMatch(/^pwa-/);
    await vi.waitFor(() => expect(bodyText()).toContain('We aim to reply by'));
    expect(phase()).toBe('sent');
    expect(bodyText()).toContain('We’ve got it · INC-000124');
    expect(bodyText()).toContain('What happens next');
    expect((button('Track it') as HTMLAnchorElement).getAttribute('href')).toBe('/tickets/INC-000124');
    expect(document.activeElement).toBe(document.querySelector('.app-HelpDone'));
    // Sent: nothing is left to restore.
    expect(localStorage.getItem('itsm-draft:report:u1')).toBeNull();
  });

  it('ends clearly without a reply time when the clock has not started, after asking twice', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    respondWith(created('INC-000125'));
    mount();
    await toDetails();
    await send();
    await settle();
    expect(api.slaTimers).toHaveBeenCalledTimes(1);
    await flush(1500);
    expect(api.slaTimers).toHaveBeenCalledTimes(2);
    expect(bodyText()).toContain('We’ve got it · INC-000125');
    expect(bodyText()).not.toContain('We aim to reply by');
  });

  it('sends one key for one report: online, after a failure, and in the offline queue', async () => {
    respondWith(problem(503), offline);
    mount();
    await toDetails();
    await send();
    expect(phase()).toBe('details');
    expect(bodyText()).toContain('The service desk couldn’t take it just now. Your report is still here — try again.');
    expect(document.activeElement?.closest('[role="alert"], .itsm-FormErrorSummary')).not.toBeNull();

    await send();
    await vi.waitFor(() => expect(phase()).toBe('queued'));
    expect(bodyText()).toContain('Saved on this device');
    expect(bodyText()).toContain('We’ll send it when you’re back online.');
    expect((button('Back to Home') as HTMLAnchorElement).getAttribute('href')).toBe('/');
    button('See what’s waiting');

    const keys = new Set(sent.map((request) => request.key));
    expect(keys.size).toBe(1);
    const [queued] = await (await outboxStore()).all();
    expect(queued?.action).toBe('report-issue');
    expect(queued?.idempotencyKey).toBe(sent[0]!.key);
  });

  it('gives an edited report a new key: it is a new intent', async () => {
    respondWith(problem(503), created());
    mount();
    await toDetails();
    await send();
    type(field('Title') as HTMLInputElement, 'Printer on floor 3 is jammed (E-04)');
    await send();
    expect(sent).toHaveLength(2);
    expect(sent[0]!.key).not.toBe(sent[1]!.key);
  });

  it('checks the title before sending, and puts the API’s field problems beside their fields', async () => {
    respondWith(problem(422, { errors: [{ field: 'title', message: 'Title is too vague' }] }));
    mount();
    await toDetails();
    type(field('Title') as HTMLInputElement, '   ');
    await send();
    expect(sent).toHaveLength(0);
    expect(bodyText()).toContain('Give it a short title');

    type(field('Title') as HTMLInputElement, 'It');
    await send();
    expect(bodyText()).toContain('Title is too vague');
    expect(bodyText()).toContain('Check the highlighted fields and send it again.');
  });

  it('says so plainly when the organisation is out of tickets', async () => {
    respondWith(problem(402));
    mount();
    await toDetails();
    await send();
    expect(bodyText()).toContain('Your organisation has reached its ticket limit.');
  });

  it('hands a lapsed session to the frame and keeps what was written', async () => {
    respondWith(problem(401));
    const heard: string[] = [];
    const stop = onSessionEnded((how) => heard.push(how));
    mount();
    await toDetails();
    await send();
    stop();
    expect(heard).toEqual(['action']);
    expect(phase()).toBe('details');
    expect(JSON.parse(localStorage.getItem('itsm-draft:report:u1') ?? '{}').value).toMatchObject({ title: 'Printer on floor 3 is jammed' });
  });

  it('sends with mod+Enter from the details', async () => {
    respondWith(created());
    mount();
    await toDetails();
    const details = field('Details') as HTMLTextAreaElement;
    await act(async () => {
      details.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }));
    });
    await settle();
    expect(sent).toHaveLength(1);
  });
});

/* ---- Drafts ------------------------------------------------------------------ */

describe('the draft', () => {
  it('is kept every five seconds and restored with "Draft restored · Discard"', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const first = mount();
    await toDetails('Monitor flickers');
    type(field('Details') as HTMLTextAreaElement, 'Since the update');
    await flush(4_000);
    expect(localStorage.getItem('itsm-draft:report:u1')).toBeNull();
    await flush(1_000);
    expect(JSON.parse(localStorage.getItem('itsm-draft:report:u1') ?? '{}').value).toMatchObject({ step: 'details', title: 'Monitor flickers', details: 'Since the update' });
    first.unmount();

    mount();
    await settle();
    expect(phase()).toBe('details');
    expect(bodyText()).toContain('Draft restored');
    expect((field('Details') as HTMLTextAreaElement).value).toBe('Since the update');

    await clickAsync(button('Discard'));
    expect(phase()).toBe('describe');
    expect(localStorage.getItem('itsm-draft:report:u1')).toBeNull();
  });

  it('gives way to words the flow was opened with, without throwing the old draft away', async () => {
    localStorage.setItem('itsm-draft:report:u1', JSON.stringify({ version: null, savedAt: new Date().toISOString(), value: { step: 'details', text: 'old', title: 'Old draft', details: '', urgency: 'low' } }));
    mount({ start: { step: 'details', text: 'Printer offline', details: 'Related to INC-000123' } });
    await settle();
    expect((field('Title') as HTMLInputElement).value).toBe('Printer offline');
    expect((field('Details') as HTMLTextAreaElement).value).toBe('Related to INC-000123');
    expect(bodyText()).not.toContain('Draft restored');
    expect(localStorage.getItem('itsm-draft:report:u1')).toContain('Old draft');
  });

  it('is nobody’s without a person', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    mount({ userId: null });
    type(field('What do you need help with?') as HTMLInputElement, 'Keyboard');
    await flush(6_000);
    expect(localStorage.length).toBe(0);
  });
});

/* ---- The sheet ------------------------------------------------------------- */

describe('the sheet', () => {
  function Sheet({ open, request, onOpenChange = () => undefined }: { open: boolean; request?: { step?: 'describe' | 'details'; text?: string }; onOpenChange?: (open: boolean) => void }): ReactNode {
    return (
      <Provider>
        <HelpSheet open={open} onOpenChange={onOpenChange} {...(request ? { request } : {})} />
      </Provider>
    );
  }

  it('opens as a titled dialog, starts where it was asked to, and closes when the page changes', async () => {
    const onOpenChange = vi.fn();
    const view = render(<Sheet open request={{ step: 'details', text: 'vpn' }} onOpenChange={onOpenChange} />);
    await settle();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('Report an issue');
    expect((field('Title') as HTMLInputElement).value).toBe('vpn');

    pathname = '/tickets/INC-000124';
    act(() => view.root.render(<Sheet open request={{ step: 'details', text: 'vpn' }} onOpenChange={onOpenChange} />));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('starts a fresh flow each time it opens', async () => {
    const view = render(<Sheet open request={{ step: 'details', text: 'first' }} />);
    await settle();
    expect((field('Title') as HTMLInputElement).value).toBe('first');
    act(() => view.root.render(<Sheet open={false} request={{ step: 'details', text: 'first' }} />));
    act(() => view.root.render(<Sheet open request={{ step: 'details', text: 'second' }} />));
    await settle();
    expect((field('Title') as HTMLInputElement).value).toBe('second');
  });
});

/* ---- The rules, as data -------------------------------------------------------- */

const model = await import('../help/model.js');
const { replyByPhrase } = await import('../help/timing.js');

describe('the rules of the flow', () => {
  it('turns a short description into a title, and a long one into a title and details', () => {
    expect(model.splitDescription('  VPN   drops  ')).toEqual({ title: 'VPN drops', details: '' });
    const run = 'word '.repeat(40).trim();
    const split = model.splitDescription(run);
    expect(split.title.endsWith('…')).toBe(true);
    expect(split.title.length).toBeLessThanOrEqual(model.TITLE_COMFORT);
    expect(split.details).toBe(run);
  });

  it('keys drafts to the person, and keeps none without one', () => {
    expect(model.draftKey('u1')).toBe('itsm-draft:report:u1');
    expect(model.draftKey(null)).toBeNull();
  });

  it('reads back only a draft worth restoring, whatever was stored', () => {
    expect(model.readReportDraft({ step: 'details', text: '', title: 'T', details: '', urgency: 'urgent!' })).toEqual({
      step: 'details',
      text: '',
      title: 'T',
      details: '',
      urgency: 'medium',
    });
    expect(model.readReportDraft({ step: 'describe', text: ' ', title: '', details: '', urgency: 'high' })).toBeNull();
    expect(model.readReportDraft('nonsense')).toBeNull();
  });

  it('lists open incidents worst first, and matches a description to them by its words', () => {
    const status = {
      page: { slug: 'acme', name: 'Acme', description: null, supportUrl: null, path: '/status/acme' },
      overall: 'degraded',
      components: [{ key: 'mail', name: 'Email', description: null, group: null, status: 'degraded' }],
      incidents: [
        { id: 'a', title: 'Printers slow', impact: 'minor', status: 'investigating', startedAt: '2026-09-30T08:00:00Z', resolvedAt: null, components: [], updates: [] },
        { id: 'b', title: 'Mail delays', impact: 'major', status: 'identified', startedAt: '2026-09-30T07:00:00Z', resolvedAt: null, components: ['mail'], updates: [{ status: 'identified', body: 'x', postedAt: '2026-09-30T09:10:00Z' }] },
        { id: 'c', title: 'Old', impact: 'critical', status: 'resolved', startedAt: '2026-09-01T07:00:00Z', resolvedAt: '2026-09-01T09:00:00Z', components: [], updates: [] },
      ],
      maintenance: [],
      generatedAt: '2026-09-30T09:30:00Z',
    } as const;
    const issues = model.knownIssuesFrom(status as never);
    expect(issues.map((issue) => issue.id)).toEqual(['b', 'a']);
    expect(issues[0]).toMatchObject({ components: ['Email'], updatedAt: '2026-09-30T09:10:00Z' });
    expect(model.matchingIssues(issues, 'My email is not arriving').map((issue) => issue.id)).toEqual(['b']);
    expect(model.matchingIssues(issues, 'the printer is jammed').map((issue) => issue.id)).toEqual(['a']);
    expect(model.matchingIssues(issues, 'it is not working')).toEqual([]);
    expect(model.knownIssuesFrom(null)).toEqual([]);
  });

  it('finds the first-response promise, and says it the way a person reads a time', () => {
    const timer = (targetType: string, state: string, dueAt: string | null) => ({ targetType, state, dueAt });
    expect(model.responseDueAt([timer('resolution', 'running', 'x'), timer('response', 'running', '2026-09-30T13:30:00Z')])).toBe('2026-09-30T13:30:00Z');
    expect(model.responseDueAt([timer('response', 'met', '2026-09-30T13:30:00Z')])).toBeNull();

    const now = new Date('2026-09-30T09:00:00Z'); // Wednesday, 10:00 in London
    expect(replyByPhrase('2026-09-30T13:30:00Z', now, 'en-GB', 'Europe/London')).toBe('14:30 today');
    expect(replyByPhrase('2026-10-01T08:00:00Z', now, 'en-GB', 'Europe/London')).toBe('09:00 tomorrow');
    expect(replyByPhrase('2026-10-02T13:00:00Z', now, 'en-GB', 'Europe/London')).toBe('Fri 14:00');
    expect(replyByPhrase('2026-10-20T13:00:00Z', now, 'en-GB', 'Europe/London')).toContain('20 Oct 2026');
    expect(replyByPhrase('not a date', now, 'en-GB', 'Europe/London')).toBeNull();
  });

  it('always says the report is still there when it did not send', () => {
    for (const status of [0, 402, 422, 429, 500, 503]) {
      const message = model.sendFailureMessage({ status, fields: {} });
      expect(message.length).toBeGreaterThan(10);
      if (status !== 422) expect(message).toMatch(/still here|IT team/);
    }
    expect(model.sendFailureMessage({ status: 429, fields: {}, retryAfterSeconds: 20 })).toContain('Try again in 20 s');
  });
});
