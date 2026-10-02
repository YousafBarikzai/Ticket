// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  act,
  cloneElement,
  forwardRef,
  isValidElement,
  Suspense,
  useMemo,
  useSyncExternalStore,
  type AnchorHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type CatalogueItem, type CatalogueItemDetail, type Me, type SubmitResult } from '@itsm/sdk';
import { ItsmProvider } from '@itsm/ui';
import type { FormDefinition } from '@itsm/ui/forms';
import { structuralVariables, themeVariables } from '@itsm/ui/tokens';
import { cleanupDocument, click, clickAsync, render, type } from './support/render.js';

/**
 * Services and asking for one (SPEC §6.3 `/catalogue`, `/catalogue/[key]`,
 * §4.4 steps, F38): the catalogue grouped by service with a search in the
 * URL and chips that jump; an item's form in steps with a review, a device
 * draft per form version, one idempotency key per intent, only the visible
 * answers sent, the outcome on the page (with the approval sentence when
 * there is one), offline and failure states, and the person question that
 * can only be "You".
 */

vi.mock('server-only', () => ({}));

let pathname = '/catalogue';
const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => router,
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

const helpFlow = { open: vi.fn(), available: true };
vi.mock('../components/PortalShell.js', () => ({ useHelpFlow: () => helpFlow }));

const browserApi = {
  submitRequest: vi.fn(async (_key: string, _answers: unknown, _options?: { idempotencyKey?: string }) => result('REQ-000046')),
};
vi.mock('../client/api.js', () => ({ api: browserApi }));

const notify = vi.fn();
vi.mock('@itsm/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itsm/ui')>();
  return { ...actual, notify: Object.assign((...args: unknown[]) => notify(...args), { dismiss: vi.fn(), promise: vi.fn(), progress: vi.fn() }) };
});

let permissions: string[] = [];
const serverApi = {
  catalogue: vi.fn(async () => ({ data: [] as CatalogueItem[] })),
  catalogueItem: vi.fn(async (_key: string) => ({}) as CatalogueItemDetail),
};

const me = (): Me => ({
  actor: { type: 'user', id: 'u1', displayName: 'Ada Lovelace' },
  tenant: { id: 't', name: 'Acme', slug: 'acme', region: 'eu' },
  permissions: permissions.map((key) => ({ key, scope: null })),
  organisations: [],
  teamIds: [],
  locale: 'en-GB',
  timeZone: 'Europe/London',
});

vi.mock('../server/session.js', () => ({
  requireSession: async () => ({ id: 's1' }),
  currentMe: async () => me(),
  heldPermissions: (person: Me) => new Set(person.permissions.map((permission) => permission.key)),
  apiFor: () => serverApi,
  loginHref: async () => '/api/session/login',
}));

const cataloguePage = await import('../app/(portal)/catalogue/(list)/page.js');
const itemPage = await import('../app/(portal)/catalogue/[key]/page.js');
const flow = await import('../catalogue/RequestFlow.js');
const group = await import('../catalogue/group.js');
const { matchSummary } = await import('../catalogue/ServiceBrowser.js');
const { onSessionEnded } = await import('../client/useAction.js');

/* ---- Fixtures -------------------------------------------------------------- */

function result(ticketNumber: string, approvalId: string | null = null): SubmitResult {
  return { ticketId: `id-${ticketNumber}`, ticketNumber, submissionId: 'sub-1', approvalId };
}

const items: CatalogueItem[] = [
  { key: 'system-access', name: 'System access', description: null, shortSummary: 'Get into a business system', formKey: 'system-access', service: 'Access & accounts', serviceKey: 'access' },
  { key: 'laptop', name: 'New laptop', description: null, shortSummary: 'A standard laptop', formKey: null, service: 'Devices', serviceKey: 'devices' },
  { key: 'monitor', name: 'Second monitor', description: null, shortSummary: null, formKey: null, service: 'Devices', serviceKey: 'devices' },
  { key: 'orphan', name: 'Parking permit', description: null, shortSummary: null, formKey: null, service: null, serviceKey: null },
];

const form: FormDefinition = {
  key: 'system-access',
  version: 3,
  title: 'System access',
  schema: {
    type: 'object',
    properties: {
      system: { type: 'string', title: 'System', enum: ['finance', 'hr'] },
      reason: { type: 'string', title: 'Why do you need it?' },
      approver: { type: 'string', title: 'Who approves it?' },
      team: { type: 'string', title: 'Which HR team?' },
    },
    required: ['system'],
  },
  ui: {
    elements: [
      { kind: 'field', field: 'system', control: 'select', options: [{ value: 'finance', label: 'Finance ledger' }, { value: 'hr', label: 'HR records' }] },
      { kind: 'field', field: 'team', control: 'text', visibleWhen: { eq: [{ var: 'form.system' }, 'hr'] } },
      {
        kind: 'section',
        id: 'access',
        title: 'Access details',
        elements: [
          { kind: 'field', field: 'reason', control: 'longtext', requiredWhen: { always: true } },
          { kind: 'field', field: 'approver', control: 'user', help: 'Usually your line manager.', minQueryLength: 2 },
        ],
      },
    ],
  },
};

const detail = (overrides: Partial<CatalogueItemDetail> = {}): CatalogueItemDetail => ({
  key: 'system-access',
  name: 'System access',
  description: 'Access to a business system, for as long as you need it.',
  form,
  ...overrides,
});

/* ---- The browser, as the pages see it ------------------------------------------ */

const locationListeners = new Set<() => void>();
const nativeReplace = window.history.replaceState.bind(window.history);

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
  // Next syncs `useSearchParams` from a history write; so does this test's provider.
  window.history.replaceState = (...args: Parameters<History['replaceState']>) => {
    nativeReplace(...args);
    for (const listener of [...locationListeners]) listener();
  };
});

function useLocationSearch(): URLSearchParams {
  const search = useSyncExternalStore(
    (listener) => {
      locationListeners.add(listener);
      return () => locationListeners.delete(listener);
    },
    () => window.location.search,
    () => '',
  );
  return useMemo(() => new URLSearchParams(search), [search]);
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
    <ItsmProvider app="portal" Link={Link} router={router} usePathname={() => pathname} useSearchParams={useLocationSearch} locale="en-GB" timeZone="Europe/London" storageScope="u1">
      {children}
    </ItsmProvider>
  );
}

/** Stands in for the server-components renderer: awaits every async component and opens every `<Suspense>`. */
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

async function show(page: Promise<ReactNode>): Promise<void> {
  const tree = await resolveServer(await page);
  render(<Provider>{tree}</Provider>);
  await act(async () => {
    await Promise.resolve();
  });
}

async function showItem(item: CatalogueItemDetail = detail()): Promise<void> {
  serverApi.catalogueItem.mockResolvedValue(item);
  pathname = `/catalogue/${item.key}`;
  await show(itemPage.default({ params: Promise.resolve({ key: item.key }) }));
}

/** Real time passing inside `act`, for debounces and the draft interval. */
async function wait(ms: number): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

function text(): string {
  return document.body.textContent?.replace(/\s+/g, ' ') ?? '';
}

function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent?.replace(/\s+/g, ' ').trim() === name);
  if (!found) throw new Error(`no button “${name}” in: ${text()}`);
  return found;
}

function link(name: string): HTMLAnchorElement {
  const found = [...document.querySelectorAll<HTMLAnchorElement>('a')].find((node) => node.textContent?.replace(/\s+/g, ' ').trim() === name);
  if (!found) throw new Error(`no link “${name}” in: ${text()}`);
  return found;
}

function control(label: string): HTMLElement {
  const element = [...document.querySelectorAll('label')].find((candidate) => candidate.textContent?.replace(/[*]|\(optional\)/g, '').trim() === label);
  const target = element ? document.getElementById(element.htmlFor) : null;
  if (!target) throw new Error(`no control “${label}” in: ${text()}`);
  return target;
}

function choose(select: HTMLElement, value: string): void {
  act(() => {
    (select as HTMLSelectElement).value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

const stepHeading = (): string => document.querySelector('.itsm-FormRenderer__stepHeading')?.textContent ?? '';

/** Through the two steps to the review, answering what is required. */
async function answerEverything(): Promise<void> {
  choose(control('System'), 'finance');
  click(button('Continue'));
  type(control('Why do you need it?') as HTMLTextAreaElement, 'Month-end close');
  click(button('Continue'));
  expect(stepHeading()).toBe('Step 3 of 3: Review your answers');
}

beforeEach(() => {
  pathname = '/catalogue';
  permissions = ['catalogue.read', 'ticket.create'];
  serverApi.catalogue.mockReset();
  serverApi.catalogueItem.mockReset();
  serverApi.catalogue.mockResolvedValue({ data: items });
  browserApi.submitRequest.mockReset();
  browserApi.submitRequest.mockResolvedValue(result('REQ-000046'));
  helpFlow.open.mockClear();
  helpFlow.available = true;
  notify.mockClear();
  router.push.mockClear();
  router.replace.mockClear();
  nativeReplace(null, '', '/catalogue');
  window.localStorage.clear();
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
});

afterEach(() => {
  cleanupDocument();
  vi.useRealTimers();
});

/* ---- Rules ----------------------------------------------------------------------- */

describe('the catalogue’s rules', () => {
  it('groups by service with each section anchored at the service key, so Home’s tiles land on it', () => {
    const groups = group.groupByService(items);
    expect(groups.map((entry) => [entry.service, entry.anchor, entry.items.length])).toEqual([
      ['Access & accounts', 'access', 1],
      ['Devices', 'devices', 2],
      [group.UNGROUPED, group.UNGROUPED_ANCHOR, 1],
    ]);
    // A service whose key did not come through still gets a stable, safe id.
    expect(group.groupByService([{ ...items[0]!, service: 'Café & Wi‑Fi', serviceKey: null }])[0]!.anchor).toBe('service-cafe-wi-fi');
    expect(group.serviceHref('devices')).toBe('/catalogue#devices');
    expect(group.serviceHref(null)).toBe('/catalogue');
  });

  it('filters on every word across name, summary and service', () => {
    expect(group.filterCatalogue(items, 'standard laptop').map((item) => item.key)).toEqual(['laptop']);
    expect(group.filterCatalogue(items, 'devices').map((item) => item.key)).toEqual(['laptop', 'monitor']);
    expect(group.filterCatalogue(items, '  ')).toHaveLength(items.length);
    expect(matchSummary(0)).toBe('Nothing matches');
    expect(matchSummary(1)).toBe('1 service matches');
    expect(matchSummary(4)).toBe('4 services match');
  });

  it('keeps one draft per form and version, and knows the other versions’ drafts', () => {
    expect(flow.draftKeyFor(form)).toBe('itsm-draft:form:system-access@3');
    expect(
      flow.staleDraftKeys(form, [
        'itsm-draft:form:system-access@3',
        'itsm-draft:form:system-access@2',
        'itsm-draft:form:system-access-pro@1',
        'itsm-draft:report:u1',
      ]),
    ).toEqual(['itsm-draft:form:system-access@2']);
  });

  it('offers a person question to the requester only, and says so, wherever it sits', () => {
    const adapted = flow.forRequester(form);
    const section = adapted.ui.elements[2]!;
    if (section.kind !== 'section') throw new Error('expected the section');
    const approver = section.elements[1]!;
    expect(approver).toMatchObject({ control: 'user', minQueryLength: 0, help: `Usually your line manager. ${flow.SELF_ONLY_HINT}` });
    // Nothing else changes.
    expect(adapted.ui.elements[0]).toBe(form.ui.elements[0]);
    expect(section.elements[0]).toBe((form.ui.elements[2] as typeof section).elements[0]);
  });

  it('sends only the answers to questions the person can see, non-empty, in a fixed order', () => {
    expect(flow.answersToSend(form, { system: 'finance', team: 'Payroll', reason: 'Close', approver: '' })).toEqual({ reason: 'Close', system: 'finance' });
    expect(Object.keys(flow.answersToSend(form, { system: 'hr', team: 'Payroll', reason: 'Close' }))).toEqual(['reason', 'system', 'team']);
    expect(flow.answersToSend(null, { anything: 'x' })).toEqual({});
  });

  it('keeps one idempotency key per intent: the same answers keep it, different answers get a new one', () => {
    let count = 0;
    const keyFor = flow.intentKeys(() => `key-${(count += 1)}`);
    expect(keyFor({ a: '1' })).toBe('key-1');
    expect(keyFor({ a: '1' })).toBe('key-1');
    expect(keyFor({ a: '2' })).toBe('key-2');
    expect(keyFor({ a: '1' })).toBe('key-3');
  });

  it('words the outcome, with the approval sentence only when a decision comes first', () => {
    expect(flow.outcomeOf(result('REQ-000046'))).toEqual({ title: 'Requested · REQ-000046', body: 'We’ve got it. The team will pick it up from here.' });
    expect(flow.outcomeOf(result('REQ-000047', 'appr-1')).body).toBe('Sent for approval. Nothing starts until it’s approved.');
  });
});

/* ---- Services ---------------------------------------------------------------------- */

describe('Services', () => {
  it('has its heading and line, a search, chips that jump, and a card per item under its service', async () => {
    await show(cataloguePage.default());
    expect(document.querySelector('h1')?.textContent).toBe('Services');
    expect(text()).toContain('Ask for software, access, equipment and more.');
    expect(document.querySelector('[role="search"] input')).not.toBeNull();

    const sections = [...document.querySelectorAll<HTMLElement>('.app-Services__section')];
    expect(sections.map((section) => [section.id, section.querySelector('h2')?.textContent])).toEqual([
      ['access', 'Access & accounts'],
      ['devices', 'Devices'],
      ['services:other', 'Everything else'],
    ]);
    const card = link('New laptop');
    expect(card.getAttribute('href')).toBe('/catalogue/laptop');
    expect(card.closest('h3')).not.toBeNull();
    expect(card.closest('li')?.textContent).toContain('A standard laptop');

    const chips = [...document.querySelectorAll<HTMLAnchorElement>('.app-Services__chip')];
    expect(chips.map((chip) => chip.getAttribute('href'))).toEqual(['#access', '#devices', '#services%3Aother']);
    expect(chips[0]!.getAttribute('aria-current')).toBe('true');
    click(chips[1]!);
    expect(chips[1]!.getAttribute('aria-current')).toBe('true');
    expect(chips[0]!.hasAttribute('aria-current')).toBe(false);
  });

  it('arrives filtered from ?q=, and searching keeps the words in the address without a server round trip', async () => {
    nativeReplace(null, '', '/catalogue?q=devices');
    await show(cataloguePage.default());
    expect([...document.querySelectorAll('.app-Services__section h2')].map((heading) => heading.textContent)).toEqual(['Devices']);
    const field = document.querySelector<HTMLInputElement>('[role="search"] input')!;
    expect(field.value).toBe('devices');

    type(field, 'monitor');
    await wait(260);
    expect(window.location.search).toBe('?q=monitor');
    expect([...document.querySelectorAll('.app-Services__grid a')].map((anchor) => anchor.textContent)).toEqual(['Second monitor']);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('says so when nothing matches, and offers to report it with the words or to clear the search', async () => {
    nativeReplace(null, '', '/catalogue?q=spaceship');
    await show(cataloguePage.default());
    expect(text()).toContain('Nothing matches ‘spaceship’');
    click(button('Report an issue instead'));
    expect(helpFlow.open).toHaveBeenCalledWith({ step: 'details', text: 'spaceship' });
    click(button('Clear search'));
    expect(window.location.search).toBe('');
    expect(document.querySelectorAll('.app-Services__section')).toHaveLength(3);
  });

  it('has an honest empty catalogue, a failed read under the kept heading, and a forbidden page', async () => {
    serverApi.catalogue.mockResolvedValue({ data: [] });
    await show(cataloguePage.default());
    expect(text()).toContain('Nothing to request yet');
    click(button('Report an issue'));
    expect(helpFlow.open).toHaveBeenCalledWith();
    cleanupDocument();

    serverApi.catalogue.mockRejectedValue(new ApiError(503, null, 'down'));
    await show(cataloguePage.default());
    expect(document.querySelector('h1')?.textContent).toBe('Services');
    expect(text()).toContain('Couldn’t load the services');
    expect(button('Retry')).toBeDefined();
    cleanupDocument();

    permissions = ['ticket.create'];
    await show(cataloguePage.default());
    expect(document.querySelector('h1')?.textContent).toBe('Services');
    expect(text()).toContain('Services aren’t available to you');
    expect(serverApi.catalogue).toHaveBeenCalledTimes(2);
  });
});

/* ---- Asking for one ------------------------------------------------------------------- */

describe('an item’s page', () => {
  it('is titled with the item’s name, never its key, and goes back to its own service', async () => {
    serverApi.catalogueItem.mockResolvedValue(detail());
    await expect(itemPage.generateMetadata({ params: Promise.resolve({ key: 'system-access' }) })).resolves.toEqual({ title: 'System access' });

    await showItem();
    expect(document.querySelector('h1')?.textContent).toBe('System access');
    expect(document.querySelector('.app-ServiceRequest__eyebrow')?.textContent).toBe('Access & accounts');
    expect(link('Services').getAttribute('href')).toBe('/catalogue#access');
    expect(text()).toContain('Access to a business system, for as long as you need it.');
    expect(document.querySelector('.app-ServiceRequest__rail')?.textContent).toContain('What happens next');
  });

  it('is a 404 for an item that does not exist or is not theirs, and keeps a heading when the read fails', async () => {
    serverApi.catalogueItem.mockRejectedValue(new ApiError(404, null, 'no'));
    await expect(itemPage.default({ params: Promise.resolve({ key: 'secret' }) })).rejects.toThrow('not found');
    await expect(itemPage.generateMetadata({ params: Promise.resolve({ key: 'secret' }) })).resolves.toEqual({ title: 'Not found', robots: { index: false } });
    cleanupDocument();

    serverApi.catalogueItem.mockRejectedValue(new ApiError(500, null, 'boom'));
    await show(itemPage.default({ params: Promise.resolve({ key: 'system-access' }) }));
    expect(document.querySelector('h1')?.textContent).toBe('Request a service');
    expect(text()).toContain('Couldn’t load this service');
    expect(link('Services').getAttribute('href')).toBe('/catalogue');
  });
});

describe('the request, in steps', () => {
  it('walks the steps with a review and sends the visible answers once, with one key, then says it is in', async () => {
    await showItem();
    expect(stepHeading()).toBe('Step 1 of 3: System access');
    expect(document.querySelector('.itsm-FormRenderer__stepHeading')?.tagName).toBe('H2');

    // Checked before moving on.
    click(button('Continue'));
    expect(document.querySelector('.itsm-FormErrorSummary')?.textContent).toContain('System');

    choose(control('System'), 'hr');
    type(control('Which HR team?') as HTMLInputElement, 'Payroll');
    // Changing the answer hides the HR question: its answer must not be sent.
    choose(control('System'), 'finance');
    click(button('Continue'));
    expect(stepHeading()).toBe('Step 2 of 3: Access details');
    type(control('Why do you need it?') as HTMLTextAreaElement, 'Month-end close');
    click(button('Continue'));
    expect(stepHeading()).toBe('Step 3 of 3: Review your answers');
    expect(text()).toContain('Finance ledger');

    await clickAsync(button('Request System access'));
    expect(browserApi.submitRequest).toHaveBeenCalledTimes(1);
    const [key, answers, options] = browserApi.submitRequest.mock.calls[0]!;
    expect(key).toBe('system-access');
    expect(answers).toEqual({ reason: 'Month-end close', system: 'finance' });
    expect(Object.keys(answers as object)).toEqual(['reason', 'system']);
    expect(options?.idempotencyKey).toMatch(/^portal-request-/);

    const heading = document.querySelector<HTMLElement>('.app-ServiceDone__title')!;
    expect(heading.textContent).toBe('Requested · REQ-000046');
    expect(document.activeElement).toBe(heading);
    expect(text()).toContain('We’ve got it.');
    expect(text()).not.toContain('Sent for approval');
    expect(link('Track it').getAttribute('href')).toBe('/tickets/REQ-000046');
    expect(link('Request something else').getAttribute('href')).toBe('/catalogue');
    expect(document.querySelector('.itsm-FormRenderer')).toBeNull();
    expect(window.localStorage.getItem('itsm-draft:form:system-access@3')).toBeNull();
  });

  it('explains that nothing starts until an approval is given, when the request needs one', async () => {
    browserApi.submitRequest.mockResolvedValue(result('REQ-000047', 'appr-9'));
    await showItem();
    await answerEverything();
    await clickAsync(button('Request System access'));
    expect(document.querySelector('.app-ServiceDone__title')?.textContent).toBe('Requested · REQ-000047');
    expect(text()).toContain('Sent for approval. Nothing starts until it’s approved.');
    expect(document.querySelector('.app-ServiceDone__mark')?.getAttribute('data-tone')).toBe('neutral');
  });

  it('retries a failed send with the same key, and uses a new key once the answers change', async () => {
    browserApi.submitRequest.mockRejectedValueOnce(new ApiError(503, { type: 'about:blank', title: 'Unavailable', status: 503, correlationId: 'c1' }, 'down'));
    await showItem();
    await answerEverything();
    await clickAsync(button('Request System access'));
    expect(notify).toHaveBeenCalledTimes(1);
    const [, toast] = notify.mock.calls[0]! as [string, { action?: { label: string; onClick: () => void } }];
    expect(toast.action?.label).toBe('Try again');

    browserApi.submitRequest.mockRejectedValueOnce(new ApiError(503, null, 'down'));
    await act(async () => {
      toast.action!.onClick();
      await Promise.resolve();
    });
    const keys = browserApi.submitRequest.mock.calls.map((call) => call[2]?.idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);

    // Back to change an answer: a different request, a different key.
    click([...document.querySelectorAll<HTMLButtonElement>('.itsm-FormRenderer__reviewGroup button')][1]!);
    type(control('Why do you need it?') as HTMLTextAreaElement, 'Audit');
    click(button('Review answers'));
    await clickAsync(button('Request System access'));
    expect(browserApi.submitRequest).toHaveBeenCalledTimes(3);
    expect(browserApi.submitRequest.mock.calls[2]![2]?.idempotencyKey).not.toBe(keys[0]);
    expect(document.querySelector('.app-ServiceDone__title')?.textContent).toBe('Requested · REQ-000046');
  });

  it('makes one call for a double press', async () => {
    let finish: (value: SubmitResult) => void = () => undefined;
    browserApi.submitRequest.mockImplementation(() => new Promise<SubmitResult>((resolve) => (finish = resolve)));
    await showItem();
    await answerEverything();
    const send = button('Request System access');
    click(send);
    click(send);
    expect(browserApi.submitRequest).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish(result('REQ-000046'));
      await Promise.resolve();
    });
    expect(document.querySelector('.app-ServiceDone__title')).not.toBeNull();
  });

  it('takes the API’s field errors back to their step, with the summary', async () => {
    browserApi.submitRequest.mockRejectedValueOnce(
      new ApiError(422, { type: 'about:blank', title: 'Invalid', status: 422, correlationId: 'c2', errors: [{ code: 'too_short', field: 'reason', message: 'Say a little more' }] }, 'invalid'),
    );
    await showItem();
    await answerEverything();
    await clickAsync(button('Request System access'));
    expect(stepHeading()).toBe('Step 2 of 3: Access details');
    expect(document.querySelector('.itsm-FormErrorSummary')?.textContent).toContain('Say a little more');
    expect(notify).not.toHaveBeenCalled();
  });

  it('leaves a lost session to the frame, and says so when the item went away', async () => {
    const ended = vi.fn();
    const stop = onSessionEnded(ended);
    browserApi.submitRequest.mockRejectedValueOnce(new ApiError(401, null, 'expired'));
    await showItem();
    await answerEverything();
    await clickAsync(button('Request System access'));
    expect(ended).toHaveBeenCalledWith('action');
    expect(notify).not.toHaveBeenCalled();
    stop();

    browserApi.submitRequest.mockRejectedValueOnce(new ApiError(404, null, 'gone'));
    await clickAsync(button('Request System access'));
    expect(text()).toContain('This isn’t available to you any more');
    expect(link('Back to Services').getAttribute('href')).toBe('/catalogue');
  });

  it('does not send offline, says why, and keeps the answers on the device', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    await showItem();
    await answerEverything();
    const send = button('Request System access');
    expect(send.getAttribute('aria-disabled')).toBe('true');
    expect(text()).toContain('Requests can’t be sent offline. Your answers are saved on this device.');
    click(send);
    expect(browserApi.submitRequest).not.toHaveBeenCalled();
  });

  it('offers only “You” for a person question, with the reason, and reads it back as “You”', async () => {
    await showItem();
    choose(control('System'), 'finance');
    click(button('Continue'));
    expect(text()).toContain(flow.SELF_ONLY_HINT);
    const picker = document.querySelector<HTMLInputElement>('[role="combobox"]')!;
    act(() => picker.focus());
    // Anybody else's name finds nobody: the directory is not the requester's to search.
    type(picker, 'Grace');
    await wait(260);
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(0);
    type(picker, '');
    act(() => {
      picker.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    });
    await wait(260);
    const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
    expect(options.map((option) => option.textContent)).toEqual(['YouAda Lovelace']);
    act(() => {
      options[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    type(control('Why do you need it?') as HTMLTextAreaElement, 'Close');
    click(button('Continue'));
    expect(text()).toContain('Who approves it?You');
  });

  it('is one button for an item with nothing to fill in', async () => {
    await showItem({ key: 'laptop', name: 'New laptop', description: null, form: null });
    expect(text()).toContain('Nothing to fill in');
    await clickAsync(button('Request New laptop'));
    expect(browserApi.submitRequest).toHaveBeenCalledWith('laptop', {}, expect.objectContaining({ idempotencyKey: expect.stringMatching(/^portal-request-/) }));
    expect(document.querySelector('.app-ServiceDone__title')?.textContent).toBe('Requested · REQ-000046');
  });
});

describe('the draft on this device', () => {
  it('is written after five seconds, restored with a notice, and discarded on request', async () => {
    await showItem();
    choose(control('System'), 'hr');
    await wait(4900);
    expect(window.localStorage.getItem('itsm-draft:form:system-access@3')).toBeNull();
    await wait(250);
    const stored = JSON.parse(window.localStorage.getItem('itsm-draft:form:system-access@3')!) as { version: string; value: Record<string, unknown> };
    expect(stored.version).toBe('3');
    expect(stored.value).toMatchObject({ system: 'hr' });
    expect(document.querySelector('.itsm-DraftStatus')?.textContent).toContain('Draft saved');
    cleanupDocument();

    await showItem();
    await wait(0);
    expect(text()).toContain('Draft restored');
    expect((control('System') as HTMLSelectElement).value).toBe('hr');
    click(button('Discard'));
    expect((control('System') as HTMLSelectElement).value).toBe('');
    expect(window.localStorage.getItem('itsm-draft:form:system-access@3')).toBeNull();
  }, 15_000);

  it('drops a draft written for another version of the form, and says why', async () => {
    const old = { version: '2', savedAt: '2026-09-29T10:00:00Z', value: { system: 'finance' } };
    window.localStorage.setItem('itsm-draft:form:system-access@2', JSON.stringify(old));
    window.localStorage.setItem('itsm-draft:form:system-access-pro@1', JSON.stringify(old));
    await showItem();
    await wait(0);
    expect(window.localStorage.getItem('itsm-draft:form:system-access@2')).toBeNull();
    expect(window.localStorage.getItem('itsm-draft:form:system-access-pro@1')).not.toBeNull();
    expect(text()).toContain('This form changed since your draft was saved');
    expect((control('System') as HTMLSelectElement).value).toBe('');
  });
});

/* ---- Styles ------------------------------------------------------------------------------ */

describe('the styles for Services and asking for one', () => {
  it('reference no variable the design system does not emit, and never restyle a design-system part on its own', () => {
    const defined = new Set([...Object.keys(structuralVariables()), ...Object.keys(themeVariables('apple'))]);
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'app', '(portal)', 'catalogue', 'catalogue.css'), 'utf8');
    const used = [...new Set([...css.matchAll(/var\((--itsm-[a-zA-Z0-9-]+)/g)].map((match) => match[1]!))];
    expect(used.length).toBeGreaterThan(10);
    expect(used.filter((variable) => !defined.has(variable))).toEqual([]);
    expect(css).not.toMatch(/^\s*\.itsm-/m);
  });
});
