// @vitest-environment jsdom
import { act, forwardRef, type AnchorHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Me, PublicStatus } from '@itsm/sdk';
import { ItsmProvider } from '@itsm/ui';
import { cleanupDocument, clickAsync, render, submit, type } from './support/render.js';

/**
 * `/report` (SPEC §6.3, D17, Y-1.3.5; v3 §7.2, WP-49): "How can we help?" as
 * a page — for the manifest shortcut, a link, and *New request* offline. The
 * same three steps as the sheet (Describe · Details · Review, under a small
 * Stepper) beneath the page's own heading; gated on `ticket.create`; `?q=`
 * starts the details; the status page read on the server feeds "Is it
 * this?"; the flow queues when there is no network, and ends on the panel
 * the server draws when there is.
 */

vi.mock('server-only', () => ({}));

const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({
  usePathname: () => '/report',
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(),
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

vi.mock('../help/actions.js', () => ({
  renderSentPanel: async (input: { number: string }) => (
    <section aria-labelledby="sent-test" data-sent="">
      <h2 id="sent-test">Request sent: {input.number}</h2>
    </section>
  ),
}));

vi.mock('../client/api.js', () => ({
  api: {
    search: vi.fn(async () => ({ data: [], meta: { facets: {}, engine: 'meilisearch' } })),
    catalogue: vi.fn(async () => ({ data: [] })),
    myTickets: vi.fn(async () => ({ data: [], nextCursor: null })),
    slaTimers: vi.fn(async () => ({ ticketId: 't1', timers: [] })),
    article: vi.fn(),
    rateArticle: vi.fn(),
  },
}));

let permissions: string[] = [];
let publicStatus: () => Promise<PublicStatus | null> = async () => null;

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
  apiFor: () => ({ publicStatus: () => publicStatus() }),
}));

const { default: ReportPage, metadata } = await import('../app/(portal)/report/page.js');
const { readStatus, followUrlFor } = await import('../help/status.js');
const { outboxStore } = await import('@itsm/pwa');

beforeAll(() => {
  const scope = globalThis as Record<string, unknown>;
  scope.matchMedia ??= (query: string) => ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false });
  Element.prototype.scrollIntoView ??= () => undefined;
});

const incident: PublicStatus = {
  page: { slug: 'acme', name: 'Acme status', description: null, supportUrl: null, path: '/status/acme' },
  overall: 'degraded',
  components: [{ key: 'vpn', name: 'VPN', description: null, group: null, status: 'degraded' }],
  incidents: [{ id: 'i1', title: 'VPN degraded', impact: 'minor', status: 'investigating', startedAt: '2026-09-30T08:00:00Z', resolvedAt: null, components: ['vpn'], updates: [] }],
  maintenance: [],
  generatedAt: '2026-09-30T09:00:00Z',
};

let fetches = 0;
beforeEach(() => {
  permissions = ['ticket.create', 'search.query', 'knowledge.read', 'catalogue.read'];
  publicStatus = async () => null;
  router.push.mockClear();
  fetches = 0;
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  vi.stubGlobal('fetch', async () => {
    fetches += 1;
    throw new TypeError('Failed to fetch');
  });
});

afterEach(async () => {
  cleanupDocument();
  localStorage.clear();
  vi.unstubAllGlobals();
  const store = await outboxStore();
  for (const item of await store.all()) await store.delete(item.id);
});

function Link({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }): ReactNode {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}

async function open(query: Record<string, string> = {}): Promise<void> {
  const page = (await ReportPage({ searchParams: Promise.resolve(query) })) as ReactElement;
  render(
    <ItsmProvider app="portal" Link={Link} router={router} usePathname={() => '/report'} useSearchParams={() => new URLSearchParams()} locale="en-GB" timeZone="Europe/London" storageScope="u1">
      {page}
    </ItsmProvider>,
  );
  await act(async () => {
    await Promise.resolve();
  });
}

function text(): string {
  return document.body.textContent?.replace(/\s+/g, ' ') ?? '';
}

function field(label: string): HTMLInputElement {
  const found = [...document.querySelectorAll('label')].find((node) => node.textContent?.includes(label));
  const control = document.getElementById(found?.getAttribute('for') ?? '');
  if (!(control instanceof HTMLInputElement)) throw new Error(`no field ${label}`);
  return control;
}

function button(name: string): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>('button, a')].find((node) => node.textContent?.replace(/\s+/g, ' ').trim().startsWith(name));
  if (!found) throw new Error(`no button ${name}`);
  return found;
}

/** Details → review → Send report, through each step's own form. */
async function sendFromDetails(): Promise<void> {
  const details = document.querySelector('form');
  if (!(details instanceof HTMLFormElement)) throw new Error('no form');
  await submit(details);
  await act(async () => {
    await Promise.resolve();
  });
  expect(document.querySelector('[data-phase]')?.getAttribute('data-phase')).toBe('review');
  const review = document.querySelector('form.app-HelpReview');
  if (!(review instanceof HTMLFormElement)) throw new Error('no review');
  await submit(review);
}

describe('/report', () => {
  it('is “Report an issue”: heading, title and the flow’s first step, with the caret in its one field', async () => {
    expect(metadata).toEqual({ title: 'Report an issue' });
    await open();
    expect(document.querySelector('h1')?.textContent).toBe('Report an issue');
    expect(text()).toContain('Step 1 of 3 · Describe it');
    // The step header: three steps, the first current.
    const steps = [...document.querySelectorAll('.app-HelpFlow__steps .itsm-Stepper__step')];
    expect(steps.map((step) => step.getAttribute('data-status'))).toEqual(['current', 'upcoming', 'upcoming']);
    expect(document.activeElement).toBe(field('What do you need help with?'));
    expect(document.querySelector('[data-phase]')?.getAttribute('data-phase')).toBe('describe');
  });

  it('keeps the heading and explains, for somebody who cannot report anything', async () => {
    permissions = ['knowledge.read'];
    await open();
    expect(document.querySelector('h1')?.textContent).toBe('Report an issue');
    expect(text()).toContain('You can’t report issues here');
    expect(document.querySelector('form')).toBeNull();
  });

  it('starts at the details with ?q= as the title', async () => {
    await open({ q: '  printer jammed  ' });
    expect(text()).toContain('Step 2 of 3 · Add the details');
    expect(field('Title').value).toBe('printer jammed');
  });

  it('checks the description against the incidents the server read', async () => {
    publicStatus = async () => incident;
    await open();
    type(field('What do you need help with?'), 'the vpn will not connect');
    expect(text()).toContain('Is it this?');
    expect((button('Follow updates') as HTMLAnchorElement).href).toBe(followUrlFor(incident));
  });

  it('queues the report when there is no network, and says so on the page', async () => {
    await open({ q: 'Laptop will not start' });
    await sendFromDetails();
    await vi.waitFor(() => expect(text()).toContain('Saved on this device'));
    expect(fetches).toBeGreaterThanOrEqual(1);
    expect((button('Back to Home') as HTMLAnchorElement).getAttribute('href')).toBe('/');
    const [queued] = await (await outboxStore()).all();
    expect(queued).toMatchObject({ action: 'report-issue', summary: 'Laptop will not start' });
  });

  it('goes Home when they are done', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ number: 'INC-000200' }), { status: 201 }));
    await open({ q: 'Screen flickers' });
    await sendFromDetails();
    await vi.waitFor(() => expect(text()).toContain('Request sent: INC-000200'));
    expect(document.querySelector('[data-phase]')?.getAttribute('data-phase')).toBe('sent');
    await clickAsync(button('Done'));
    expect(router.push).toHaveBeenCalledWith('/');
  });
});

describe('reading the status page', () => {
  const api = (answer: () => Promise<PublicStatus | null>) => ({ publicStatus: answer }) as never;

  it('asks nothing without a workspace slug', async () => {
    expect(await readStatus(api(async () => incident), null)).toEqual({ status: null, failed: false });
  });

  it('gives the page, or nothing when there is none', async () => {
    expect(await readStatus(api(async () => incident), 'acme')).toEqual({ status: incident, failed: false });
    expect(await readStatus(api(async () => null), 'acme')).toEqual({ status: null, failed: false });
  });

  it('never holds the page up: a slow or failed read is "couldn’t check"', async () => {
    expect(await readStatus(api(() => new Promise(() => undefined)), 'acme', 10)).toEqual({ status: null, failed: true });
    expect(await readStatus(api(async () => Promise.reject(new Error('down'))), 'acme')).toEqual({ status: null, failed: true });
  });

  it('links "Follow updates" to the public page on the API’s public origin', () => {
    expect(followUrlFor(incident)).toMatch(/^https?:\/\/[^/]+\/status\/acme$/);
    expect(followUrlFor(null)).toBeNull();
  });
});
