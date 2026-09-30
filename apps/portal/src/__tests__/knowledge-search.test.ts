// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, cloneElement, createElement as h, forwardRef, isValidElement, Suspense, type AnchorHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type Article, type ArticleSummary, type Me, type SearchHit, type SearchResults } from '@itsm/sdk';
import { ItsmProvider } from '@itsm/ui';
import { structuralVariables, themeVariables } from '@itsm/ui/tokens';
import { cleanupDocument, click, render, type } from './support/render.js';

/**
 * Knowledge (SPEC §6.3 `/knowledge`, `?q=`, `/knowledge/[key]`, X-14, F2):
 * the search asks the index by its real name (`knowledge`; `article` found
 * nothing) and links each result by the article's key, with the matched
 * words marked and nothing else ever becoming markup; browsing by category,
 * popular and recent; an article with its category, dates and reading time;
 * and the one card at the end — Yes, or No and report an issue.
 */

vi.mock('server-only', () => ({}));

const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({
  usePathname: () => '/knowledge',
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
    return h('a', { ref, ...props });
  }),
}));

const helpFlow = { open: vi.fn(), available: true };
vi.mock('../components/PortalShell.js', () => ({ useHelpFlow: () => helpFlow }));

const browserApi = { rateArticle: vi.fn(async (_key: string, _helpful: boolean, _comment?: string) => ({ ok: true })) };
vi.mock('../client/api.js', () => ({ api: browserApi }));

let permissions: string[] = [];
const serverApi = {
  search: vi.fn(async (_q: string, _o?: unknown): Promise<SearchResults> => ({ data: [], meta: { facets: {}, engine: 'meilisearch' } })),
  knowledge: vi.fn(async (_f?: { status?: string; category?: string; limit?: number }): Promise<ArticleSummary[]> => []),
  article: vi.fn(async (_key: string): Promise<Article> => article()),
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

const knowledgePage = await import('../app/(portal)/knowledge/page.js');
const articlePage = await import('../app/(portal)/knowledge/[key]/page.js');
const rules = await import('../app/(portal)/knowledge/categories.js');
const { SearchBox } = await import('../app/(portal)/knowledge/SearchBox.js');
const { ArticleEnd, reportDetails } = await import('../knowledge/ArticleEnd.js');

/* ---- Fixtures ------------------------------------------------------------------ */

function summary(key: string, title: string, viewCount: number, publishedAt = '2026-09-01T09:00:00Z', categoryId: string | null = null): ArticleSummary {
  return {
    id: `id-${key}`,
    key,
    title,
    status: 'published',
    audience: 'all',
    categoryId,
    keywords: [],
    viewCount,
    helpfulCount: 0,
    unhelpfulCount: 0,
    reviewDueAt: null,
    // Moved by every view, so it says nothing about the content (see `publishedOf`).
    updatedAt: '2026-09-30T08:00:00Z',
    publishedAt,
  };
}

function article(overrides: Partial<Article> = {}): Article {
  return {
    key: 'vpn-setup',
    title: 'Set up the VPN',
    status: 'published',
    audience: 'all',
    version: 2,
    summary: 'Connect from home in three steps.',
    body: [
      { type: 'paragraph', content: [{ text: 'word '.repeat(390) }] },
      { type: 'paragraph', content: [{ text: '<script>alert(1)</script> stays text' }] },
      { type: 'list', ordered: true, items: [[{ text: 'Open the app' }], [{ text: 'Sign in', bold: true }]] },
      { type: 'table', rows: [] },
    ],
    keywords: [],
    helpfulCount: 0,
    unhelpfulCount: 0,
    reviewDueAt: null,
    publishedAt: '2026-08-01T09:00:00Z',
    ...overrides,
  };
}

function hit(key: string, title: string, snippet: string, entityType = 'knowledge'): SearchHit {
  return { entityType, entityId: `id-${key}`, title, snippet, rank: 1, facets: { key, categoryId: null } };
}

const everything = [
  summary('vpn-setup', 'Set up the VPN', 40, '2026-09-03T09:00:00Z'),
  summary('password', 'Reset your password', 90, '2026-06-01T09:00:00Z'),
  summary('printer', 'Add a printer', 5, '2026-09-20T09:00:00Z'),
  summary('mfa', 'Set up two-step sign-in', 12, '2025-11-01T09:00:00Z'),
  summary('unread', 'A new policy', 0, '2026-09-25T09:00:00Z'),
];

/* ---- Rendering ------------------------------------------------------------------- */

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
});

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
  return h('a', { href, ...rest }, children);
}

function provided(children: ReactNode): ReactElement {
  return h(ItsmProvider, {
    app: 'portal',
    Link,
    router,
    usePathname: () => '/knowledge',
    useSearchParams: () => new URLSearchParams(),
    locale: 'en-GB',
    timeZone: 'Europe/London',
    storageScope: 'u1',
    children,
  });
}

async function show(page: Promise<ReactNode>): Promise<void> {
  const tree = await resolveServer(await page);
  render(provided(tree));
  await act(async () => {
    await Promise.resolve();
  });
}

const params = (values: Record<string, string>): { searchParams: Promise<Record<string, string>> } => ({ searchParams: Promise.resolve(values) });

function text(): string {
  return document.body.textContent?.replace(/\s+/g, ' ') ?? '';
}

function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent?.replace(/\s+/g, ' ').trim() === name);
  if (!found) throw new Error(`no button “${name}” in: ${text()}`);
  return found;
}

function linksIn(selector: string): string[][] {
  return [...document.querySelectorAll<HTMLAnchorElement>(`${selector} a`)].map((anchor) => [anchor.textContent ?? '', anchor.getAttribute('href') ?? '']);
}

beforeEach(() => {
  permissions = ['knowledge.read', 'search.query', 'ticket.create'];
  for (const mock of [...Object.values(serverApi), ...Object.values(browserApi)]) mock.mockReset();
  serverApi.search.mockResolvedValue({ data: [], meta: { facets: {}, engine: 'meilisearch' } });
  serverApi.knowledge.mockResolvedValue([]);
  serverApi.article.mockResolvedValue(article());
  browserApi.rateArticle.mockResolvedValue({ ok: true });
  helpFlow.open.mockClear();
  helpFlow.available = true;
  router.push.mockClear();
  router.replace.mockClear();
});

afterEach(() => {
  cleanupDocument();
  vi.useRealTimers();
});

/* ---- Rules -------------------------------------------------------------------------- */

describe('knowledge rules', () => {
  it('knows the three browse categories, and nothing else — runbooks are the desk’s', () => {
    expect(rules.CATEGORIES.map((category) => category.label)).toEqual(['How-to', 'Troubleshooting', 'Policies']);
    expect(rules.categoryFor('how-to')?.label).toBe('How-to');
    expect(rules.categoryFor('runbooks')).toBeNull();
    expect(rules.categoryFor(['policies', 'x'])?.key).toBe('policies');
    expect(rules.categoryHref(rules.CATEGORIES[1]!)).toBe('/knowledge?category=troubleshooting');
    expect(rules.queryOf(['  vpn  ', 'x'])).toBe('vpn');
    expect(rules.queryOf('a'.repeat(300))).toHaveLength(200);
  });

  it('calls the most read popular only when three have been read, and lists the newest by publication, not by the last touch', () => {
    expect(rules.popularOf(everything).map((entry) => entry.key)).toEqual(['password', 'vpn-setup', 'mfa', 'printer']);
    expect(rules.popularOf(everything.slice(0, 2))).toEqual([]);
    expect(rules.recentOf(everything).map((entry) => entry.key)).toEqual(['unread', 'printer', 'vpn-setup', 'password', 'mfa']);
    expect(rules.recentOf([{ ...everything[4]!, updatedAt: '2027-01-01T00:00:00Z', publishedAt: '2020-01-01T00:00:00Z' }, everything[0]!]).map((entry) => entry.key)).toEqual(['vpn-setup', 'unread']);
    expect(rules.publishedOf({ publishedAt: null, updatedAt: '2026-01-01T00:00:00Z' })).toBe('2026-01-01T00:00:00Z');
    expect(rules.moreIn(everything, 'password').map((entry) => entry.key)).toEqual(['vpn-setup', 'mfa', 'printer']);
  });

  it('reads the time an article takes, and says when it changed in the reader’s zone', () => {
    expect(rules.readingTime(article().body)).toBe('2 min read');
    expect(rules.readingTime([])).toBe('1 min read');
    expect(rules.plainTextOf(article().body)).toContain('Open the app Sign in');
    const reader = { locale: 'en-GB', timeZone: 'Europe/London' };
    expect(rules.dayOf('2026-09-03T09:00:00Z', reader, new Date('2026-09-30T12:00:00Z'))).toBe('3 Sept');
    expect(rules.dayOf('2025-11-01T09:00:00Z', reader, new Date('2026-09-30T12:00:00Z'))).toBe('1 Nov 2025');
    // 23:30 UTC on New Year's Eve is already next year in Tokyo.
    expect(rules.dayOf('2025-12-31T23:30:00Z', { locale: 'en-GB', timeZone: 'Asia/Tokyo' }, new Date('2026-01-10T00:00:00Z'))).toBe('1 Jan');
  });
});

/* ---- Search -------------------------------------------------------------------------- */

describe('searching knowledge', () => {
  it('asks the knowledge index by its real name, and opens each result by the article’s key (F2)', async () => {
    serverApi.search.mockResolvedValue({
      data: [hit('vpn-setup', 'Set up the VPN', 'Connect the <b>VPN</b> client'), hit('ticket-1', 'A ticket', 'not an article', 'ticket')],
      meta: { facets: {}, engine: 'meilisearch' },
    });
    await show(knowledgePage.default(params({ q: '  vpn ' })));
    expect(serverApi.search).toHaveBeenCalledWith('vpn', { types: 'knowledge', limit: 20 });
    expect(serverApi.knowledge).not.toHaveBeenCalled();
    expect(document.querySelector('h1')?.textContent).toBe('Knowledge');
    expect(text()).toContain('Results for ‘vpn’');
    expect(linksIn('.app-Knowledge__list')).toEqual([['Set up the VPN', '/knowledge/vpn-setup']]);
    expect(document.querySelector('.app-Knowledge__snippet mark')?.textContent).toBe('VPN');
    expect(text()).not.toContain('<b>');
    expect(document.querySelector('.app-Knowledge__categories')).toBeNull();
  });

  it('marks the matched words and nothing else: markup in a snippet stays text', async () => {
    serverApi.search.mockResolvedValue({
      data: [hit('x', 'Odd one', 'before <img src=x onerror=alert(1)> and <b>vpn</b> <script>bad()</script>')],
      meta: { facets: {}, engine: 'meilisearch' },
    });
    await show(knowledgePage.default(params({ q: 'vpn' })));
    const snippet = document.querySelector('.app-Knowledge__snippet')!;
    expect(snippet.querySelector('img, script')).toBeNull();
    expect(snippet.textContent).toContain('<img src=x onerror=alert(1)>');
    expect([...snippet.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual(['vpn']);
  });

  it('says once, quietly, when the answer came from the simpler search', async () => {
    serverApi.search.mockResolvedValue({ data: [hit('vpn-setup', 'Set up the VPN', 'VPN')], meta: { facets: {}, engine: 'postgres' } });
    await show(knowledgePage.default(params({ q: 'vpn' })));
    expect(text()).toContain('Search is working in a simpler way just now');
    expect(text()).toContain('Not what you were looking for?');
    click(button('Report ‘vpn’ as an issue'));
    expect(helpFlow.open).toHaveBeenCalledWith({ step: 'details', text: 'vpn' });
  });

  it('finds nothing honestly, with the report action carrying the words', async () => {
    await show(knowledgePage.default(params({ q: 'teleporter' })));
    expect(text()).toContain('Nothing matched ‘teleporter’');
    expect(document.querySelector('a[href="/knowledge"]')?.textContent).toBe('Browse all articles');
    click(button('Report ‘teleporter’ as an issue'));
    expect(helpFlow.open).toHaveBeenCalledWith({ step: 'details', text: 'teleporter' });
  });

  it('keeps the heading and the field when the search fails, and says so with Retry', async () => {
    serverApi.search.mockRejectedValue(new ApiError(503, null, 'down'));
    await show(knowledgePage.default(params({ q: 'vpn' })));
    expect(document.querySelector('h1')?.textContent).toBe('Knowledge');
    expect(document.querySelector('[role="search"] input')).not.toBeNull();
    expect(text()).toContain('Couldn’t load the search results');
    expect(button('Retry')).toBeDefined();
  });

  it('has no search without search.query, and no report without ticket.create', async () => {
    permissions = ['knowledge.read'];
    serverApi.knowledge.mockResolvedValue([]);
    await show(knowledgePage.default(params({ q: 'vpn' })));
    expect(serverApi.search).not.toHaveBeenCalled();
    expect(document.querySelector('[role="search"]')).toBeNull();
    expect(text()).toContain('No articles yet');
    expect([...document.querySelectorAll('button')].some((node) => node.textContent?.includes('Report'))).toBe(false);
  });

  it('follows the words 300 ms after typing pauses, and pushes a finished search on Enter', async () => {
    vi.useFakeTimers();
    render(provided(h(SearchBox, { query: '' })));
    const field = document.querySelector<HTMLInputElement>('input[type="search"]')!;
    expect(field.getAttribute('aria-keyshortcuts') ?? document.querySelector('kbd')?.textContent).toBeTruthy();
    type(field, 'vpn');
    await act(async () => {
      vi.advanceTimersByTime(299);
    });
    expect(router.replace).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(router.replace).toHaveBeenCalledWith('/knowledge?q=vpn', { scroll: false });

    type(field, 'vpn client');
    act(() => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    expect(router.push).toHaveBeenCalledWith('/knowledge?q=vpn%20client', { scroll: false });
  });

  it('titles the page after what was searched or browsed', async () => {
    await expect(knowledgePage.generateMetadata(params({ q: 'vpn' }))).resolves.toEqual({ title: 'Results for ‘vpn’ · Knowledge' });
    await expect(knowledgePage.generateMetadata(params({ category: 'policies' }))).resolves.toEqual({ title: 'Policies · Knowledge' });
    await expect(knowledgePage.generateMetadata(params({}))).resolves.toEqual({ title: 'Knowledge' });
  });
});

/* ---- Browsing -------------------------------------------------------------------------- */

describe('browsing knowledge', () => {
  it('reads everything published once, and shows what is popular and what is new', async () => {
    serverApi.knowledge.mockResolvedValue(everything);
    await show(knowledgePage.default(params({})));
    expect(serverApi.knowledge).toHaveBeenCalledTimes(1);
    expect(serverApi.knowledge).toHaveBeenCalledWith({ status: 'published', limit: 200 });
    expect(linksIn('.app-Knowledge__categories')).toEqual([
      ['All', '/knowledge'],
      ['How-to', '/knowledge?category=how-to'],
      ['Troubleshooting', '/knowledge?category=troubleshooting'],
      ['Policies', '/knowledge?category=policies'],
    ]);
    expect(document.querySelector('.app-Knowledge__chip[aria-current="page"]')?.textContent).toBe('All');
    const [popular, recent] = [...document.querySelectorAll('.app-Knowledge__section')];
    expect(popular?.querySelector('h2')?.textContent).toBe('Popular');
    expect([...popular!.querySelectorAll('a')].map((anchor) => anchor.textContent)).toEqual(['Reset your password', 'Set up the VPN', 'Set up two-step sign-in', 'Add a printer']);
    expect(recent?.querySelector('h2')?.textContent).toBe('Recently added');
    expect(recent?.querySelector('a')?.getAttribute('href')).toBe('/knowledge/unread');
    expect(recent?.querySelector('.app-Knowledge__meta')?.textContent).toMatch(/^Published 25 Sept(?: 2026)?$/);
    expect(text()).not.toContain('Updated');
  });

  it('shows one category’s shelf, and an empty shelf (or a category this tenant lacks) as empty, not broken', async () => {
    serverApi.knowledge.mockResolvedValue(everything.slice(0, 2));
    await show(knowledgePage.default(params({ category: 'how-to' })));
    expect(serverApi.knowledge).toHaveBeenCalledWith({ status: 'published', category: 'how-to', limit: 200 });
    expect(document.querySelector('.app-Knowledge__chip[aria-current="page"]')?.textContent).toBe('How-to');
    expect(document.querySelector('h2')?.textContent).toBe('How-to');
    expect(text()).toContain('2 articles');
    cleanupDocument();

    serverApi.knowledge.mockRejectedValue(new ApiError(404, null, 'no such category'));
    await show(knowledgePage.default(params({ category: 'policies' })));
    expect(text()).toContain('Nothing in Policies yet');
    expect(text()).not.toContain('Couldn’t load');
  });

  it('says there is nothing yet, with the report action, and keeps the heading on failure', async () => {
    await show(knowledgePage.default(params({})));
    expect(text()).toContain('No articles yet');
    click(button('Report an issue'));
    expect(helpFlow.open).toHaveBeenCalledWith({});
    cleanupDocument();

    serverApi.knowledge.mockRejectedValue(new ApiError(500, null, 'boom'));
    await show(knowledgePage.default(params({})));
    expect(document.querySelector('h1')?.textContent).toBe('Knowledge');
    expect(text()).toContain('Couldn’t load the articles');
  });

  it('keeps the heading for somebody without knowledge.read, and reads nothing', async () => {
    permissions = ['ticket.create'];
    await show(knowledgePage.default(params({ q: 'vpn' })));
    expect(document.querySelector('h1')?.textContent).toBe('Knowledge');
    expect(text()).toContain('Knowledge isn’t available to you');
    expect(serverApi.search).not.toHaveBeenCalled();
    expect(serverApi.knowledge).not.toHaveBeenCalled();
  });
});

/* ---- An article ------------------------------------------------------------------------- */

describe('an article', () => {
  it('reads with its category, publication date, reading time and body — the body as text, never markup', async () => {
    serverApi.knowledge.mockImplementation(async (filter) =>
      filter?.category === 'how-to' ? [summary('vpn-setup', 'Set up the VPN', 40, '2026-09-03T09:00:00Z'), summary('printer', 'Add a printer', 5), summary('mfa', 'Set up two-step sign-in', 12)] : [],
    );
    await show(articlePage.default({ params: Promise.resolve({ key: 'vpn-setup' }) }));
    expect(serverApi.article).toHaveBeenCalledWith('vpn-setup');
    expect(linksIn('.app-Article__crumbs')).toEqual([
      ['Knowledge', '/knowledge'],
      ['How-to', '/knowledge?category=how-to'],
    ]);
    expect(document.querySelector('h1')?.textContent).toBe('Set up the VPN');
    expect(document.querySelector('.app-Article__lede')?.textContent).toBe('Connect from home in three steps.');
    // The article's own publication date: the lists' `updatedAt` moves on every view.
    expect(document.querySelector('.app-Article__meta')?.textContent).toMatch(/^Published 1 Aug(?: 2026)? · 2 min read$/);
    const body = document.querySelector('.itsm-Prose')!;
    expect(body.getAttribute('data-size')).toBe('lg');
    expect(body.querySelector('script')).toBeNull();
    expect(body.textContent).toContain('<script>alert(1)</script> stays text');
    expect(body.querySelectorAll('ol li')).toHaveLength(2);
    expect(document.querySelector('.app-Article__more h2')?.textContent).toBe('More in How-to');
    expect(linksIn('.app-Article__more')).toEqual([
      ['Set up two-step sign-in', '/knowledge/mfa'],
      ['Add a printer', '/knowledge/printer'],
    ]);
  });

  it('is titled after itself, and without a category shelf simply has no breadcrumb category or “More in”', async () => {
    await expect(articlePage.generateMetadata({ params: Promise.resolve({ key: 'vpn-setup' }) })).resolves.toEqual({ title: 'Set up the VPN' });
    serverApi.knowledge.mockRejectedValue(new ApiError(503, null, 'down'));
    await show(articlePage.default({ params: Promise.resolve({ key: 'vpn-setup' }) }));
    expect(linksIn('.app-Article__crumbs')).toEqual([['Knowledge', '/knowledge']]);
    expect(document.querySelector('.app-Article__more')).toBeNull();
    expect(document.querySelector('.app-Article__meta')?.textContent).toMatch(/^Published 1 Aug(?: 2026)? · 2 min read$/);
  });

  it('is a 404 for an article that does not exist or is not theirs, and keeps a heading when the read fails', async () => {
    serverApi.article.mockRejectedValue(new ApiError(404, null, 'no'));
    // Returned, not thrown (the page streams behind its skeleton; see NotFoundScreen).
    await show(articlePage.default({ params: Promise.resolve({ key: 'secret' }) }));
    expect(document.querySelector('h1')?.textContent).toBe('We couldn’t find that');
    await expect(articlePage.generateMetadata({ params: Promise.resolve({ key: 'secret' }) })).resolves.toEqual({ title: 'Not found', robots: { index: false } });
    cleanupDocument();
    serverApi.article.mockRejectedValue(new ApiError(500, null, 'boom'));
    await show(articlePage.default({ params: Promise.resolve({ key: 'vpn-setup' }) }));
    expect(document.querySelector('h1')?.textContent).toBe('Knowledge');
    expect(text()).toContain('Couldn’t load this article');
  });
});

describe('the end of an article (X-14)', () => {
  it('thanks a Yes, with focus on the thanks, and records it', async () => {
    render(provided(h(ArticleEnd, { articleKey: 'vpn-setup', title: 'Set up the VPN' })));
    expect(document.querySelector('h2')?.textContent).toBe('Did this solve it?');
    click(button('Yes'));
    expect(browserApi.rateArticle).toHaveBeenCalledWith('vpn-setup', true, undefined);
    const thanks = document.querySelector('.app-ArticleEnd__thanks')!;
    expect(thanks.textContent).toBe('Glad that helped.');
    expect(document.activeElement).toBe(thanks);
    click(button('Report an issue'));
    expect(helpFlow.open).toHaveBeenCalledWith({ step: 'details', details: 'I read ‘Set up the VPN’ and it didn’t help:' });
  });

  it('asks what they were looking for on a No, then records it and opens the report with their words', async () => {
    render(provided(h(ArticleEnd, { articleKey: 'vpn-setup', title: 'Set up the VPN' })));
    click(button('No, report an issue'));
    const field = document.querySelector('textarea')!;
    expect(document.activeElement).toBe(field);
    expect(text()).toContain('What were you looking for?');
    type(field, 'It asks for a token I do not have');
    click(button('Report an issue'));
    expect(browserApi.rateArticle).toHaveBeenCalledWith('vpn-setup', false, 'It asks for a token I do not have');
    expect(helpFlow.open).toHaveBeenCalledWith({ step: 'details', details: 'I read ‘Set up the VPN’ and it didn’t help: It asks for a token I do not have' });
    expect(document.activeElement).toBe(document.querySelector('.app-ArticleEnd__thanks'));
  });

  it('goes back to the question on Cancel, and without ticket.create a No is feedback only', async () => {
    render(provided(h(ArticleEnd, { articleKey: 'vpn-setup', title: 'Set up the VPN' })));
    click(button('No, report an issue'));
    click(button('Cancel'));
    expect(document.activeElement).toBe(button('No, report an issue'));
    cleanupDocument();

    helpFlow.available = false;
    render(provided(h(ArticleEnd, { articleKey: 'vpn-setup', title: 'Set up the VPN' })));
    click(button('No'));
    click(button('Send'));
    expect(browserApi.rateArticle).toHaveBeenCalledWith('vpn-setup', false, undefined);
    expect(helpFlow.open).not.toHaveBeenCalled();
    expect(text()).toContain('Thanks. That goes to whoever looks after this article.');
  });

  it('never lets a failed rating reach the reader', async () => {
    browserApi.rateArticle.mockRejectedValue(new ApiError(500, null, 'boom'));
    render(provided(h(ArticleEnd, { articleKey: 'vpn-setup', title: 'Set up the VPN' })));
    click(button('Yes'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(text()).toContain('Glad that helped.');
    expect(reportDetails('T', '  ')).toBe('I read ‘T’ and it didn’t help:');
  });
});

/* ---- Styles ------------------------------------------------------------------------------ */

describe('the styles for Knowledge', () => {
  it('reference no variable the design system does not emit, and never restyle a design-system part on its own', () => {
    const defined = new Set([...Object.keys(structuralVariables()), ...Object.keys(themeVariables('apple'))]);
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'app', '(portal)', 'knowledge', 'knowledge.css'), 'utf8');
    const used = [...new Set([...css.matchAll(/var\((--itsm-[a-zA-Z0-9-]+)/g)].map((match) => match[1]!))];
    expect(used.length).toBeGreaterThan(10);
    expect(used.filter((variable) => !defined.has(variable))).toEqual([]);
    expect(css).not.toMatch(/^\s*\.itsm-/m);
  });
});
