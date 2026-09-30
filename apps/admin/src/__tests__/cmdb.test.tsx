// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, forwardRef, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssetDetail, CiAttribute, CiClassRow, CiRow } from '@itsm/sdk';
import { structuralVariables, themeVariables } from '@itsm/ui/tokens';

vi.mock('server-only', () => ({}));

let search = '';
let pathname = '/cmdb';
const router = { refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), forward: vi.fn() };
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(search),
}));

const ID = {
  orders: '00000000-0000-4000-8000-000000000001',
  web: '00000000-0000-4000-8000-000000000002',
  host: '00000000-0000-4000-8000-000000000003',
  alex: '00000000-0000-4000-8000-0000000000aa',
  sam: '00000000-0000-4000-8000-0000000000bb',
};

const CLASSES: CiClassRow[] = [
  { id: 'c-server', key: 'server', name: 'Server', parentId: null },
  { id: 'c-db', key: 'database_server', name: 'Database server', parentId: 'c-server' },
  { id: 'c-app', key: 'application', name: 'Business application', parentId: null },
];

const ATTRIBUTES: Record<string, CiAttribute[]> = {
  server: [{ key: 'cpuCount', label: 'CPU count', type: 'number', required: false }],
  database_server: [
    { key: 'cpuCount', label: 'CPU count', type: 'number', required: false },
    { key: 'engine', label: 'Engine', type: 'enum', required: true, options: ['postgres', 'mysql'] },
    { key: 'backedUp', label: 'Backed up nightly', type: 'boolean', required: false },
  ],
  application: [],
};

const ciRow = (overrides: Partial<CiRow> = {}): CiRow => ({
  id: ID.orders,
  name: 'Orders database',
  classId: 'c-db',
  status: 'operational',
  criticality: 'high',
  externalKey: 'db-orders-01',
  serviceId: null,
  ownerId: ID.alex,
  environment: 'Production',
  description: null,
  attributes: { engine: 'postgres', cpuCount: 8 },
  source: 'manual',
  retiredAt: null,
  updatedAt: '2026-09-30T08:00:00Z',
  ...overrides,
});

const classAttributes = vi.fn(async (key: string) => ATTRIBUTES[key] ?? []);
const createCi = vi.fn(async (input: Record<string, unknown>) => ciRow({ id: '00000000-0000-4000-8000-000000000009', name: String(input.name) }));
const updateCi = vi.fn(async (_id: string, patch: Record<string, unknown>) => ciRow(patch as Partial<CiRow>));
const relationships = vi.fn(async () => ({
  needs: [{ type: 'runs_on', ci: { id: ID.host, name: 'Host LDN-01', status: 'operational' } }],
  neededBy: [{ type: 'depends_on', ci: { id: ID.web, name: 'Web shop', status: 'degraded' } }],
}));
const unrelate = vi.fn(async () => undefined);
const relate = vi.fn(async () => ({ id: 'r1', reads: 'x' }));
const impact = vi.fn(async () => ({
  ci: { id: ID.orders, name: 'Orders database', status: 'operational', criticality: 'high', serviceId: null },
  depth: 3,
  summary: { total: 2, byCriticality: { low: 0, medium: 1, high: 0, critical: 1 }, services: [], worst: 'critical', truncated: false },
  data: [
    { id: ID.web, name: 'Web shop', status: 'operational', criticality: 'critical', serviceId: null, className: 'Business application', depth: 1, via: 'depends_on' },
    { id: '00000000-0000-4000-8000-000000000004', name: 'Checkout', status: 'operational', criticality: 'medium', serviceId: null, className: 'Business application', depth: 2, via: 'depends_on' },
  ],
}));
const history = vi.fn(async () => ({ ci: { id: ID.orders, name: 'Orders database' }, data: [] }));
const auditEvents = vi.fn(async () => ({ data: [], nextCursor: null }));
const asset = vi.fn(
  async (tag: string): Promise<AssetDetail> => ({
    id: 'a1',
    tag,
    serial: 'PF2X9K',
    status: 'assigned',
    ciId: null,
    location: 'Leeds office',
    costCentre: 'IT-OPS',
    supplier: 'Insight',
    purchasedOn: '2023-10-02',
    warrantyEndsOn: '2026-10-12',
    retiredAt: null,
    assignments: [{ userId: ID.sam, location: null, note: 'Standard issue', assignedAt: '2026-09-01T09:00:00Z', returnedAt: null }],
  }),
);
const assignAsset = vi.fn(async (tag: string) => ({ tag, status: 'in_stock' }));
const returnAsset = vi.fn(async (tag: string) => ({ tag, status: 'in_stock' }));
const users = vi.fn(async () => [
  { id: ID.alex, displayName: 'Alex Administrator', email: 'alex@acme.test', status: 'active', primaryOrgId: null, isExternal: false },
  { id: ID.sam, displayName: 'Sam Agent', email: 'sam@acme.test', status: 'active', primaryOrgId: null, isExternal: false },
]);
vi.mock('../client/api.js', () => ({
  api: {
    observe: {
      estate: { classAttributes, createCi, updateCi, relationships, unrelate, relate, impact, history, asset, assignAsset, returnAsset, ci: vi.fn(), cis: vi.fn(async () => []) },
      auditEvents,
      ticket: vi.fn(),
    },
    tenant: { users },
  },
}));

const { ItsmProvider } = await import('@itsm/ui');
const cmdb = await import('../components/cmdb/presentation.js');
const { CisView } = await import('../components/cmdb/CisView.js');
const { CiForm } = await import('../components/cmdb/CiForm.js');
const { AssetDrawer } = await import('../components/cmdb/AssetDrawer.js');
const { attributesFrom } = await import('../components/cmdb/ClassSheet.js');
const { cleanupDocument, click, clickAsync, render, submit, type } = await import('./support/render.js');

/**
 * Configuration items and Assets (SPEC §6.1 `/cmdb`, `/cmdb/assets`): the
 * class tree as links with `aria-current`, items and assets with names
 * rather than ids, relationships read the right way round, typed class
 * attributes checked before they are sent, an edit that sends only what
 * changed, and the warranty in words.
 */

const Link = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean | null }>(function Link(
  { prefetch: _prefetch, ...props },
  ref,
) {
  return <a ref={ref} {...props} />;
});

function Frame({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <ItsmProvider
      app="admin"
      Link={Link}
      router={router}
      usePathname={() => pathname}
      useSearchParams={() => new URLSearchParams(search)}
      locale="en-GB"
      timeZone="Europe/London"
    >
      {children}
    </ItsmProvider>
  );
}

beforeEach(() => {
  search = '';
  pathname = '/cmdb';
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: /min-width/.test(query),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
});

afterEach(() => {
  cleanupDocument();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const text = (element: Element | null | undefined): string => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const buttonNamed = (root: ParentNode, name: string): HTMLButtonElement | undefined =>
  [...root.querySelectorAll<HTMLButtonElement>('button')].find((button) => text(button) === name || button.getAttribute('aria-label') === name);

function choose(select: HTMLSelectElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

const settle = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const context = {
  classes: CLASSES,
  serviceName: () => null,
  person: (id: string | null) => (id === ID.alex ? { id, name: 'Alex Administrator' } : id ? { id, name: null } : null),
};

/* ======================================================================= */

describe('the Configuration items query', () => {
  it('reads the URL defensively: unknown values are dropped, and only retired=true includes retired items', () => {
    expect(cmdb.readCiQuery(new URLSearchParams('class=server&q= db &status=down&criticality=high&retired=true'))).toEqual({
      classKey: 'server',
      q: 'db',
      status: 'down',
      criticality: 'high',
      retired: true,
    });
    expect(cmdb.readCiQuery({ class: 'Server!', status: 'broken', criticality: 'huge', retired: '1' })).toEqual({ classKey: null, q: '', status: null, criticality: null, retired: false });
  });

  it('asks once per class — the chosen one and those below it — and includes retired items when asked, or when Retired is the status', () => {
    const tree = cmdb.classTree(CLASSES);
    expect(cmdb.classAndDescendants(tree, 'server')).toEqual(['server', 'database_server']);
    const query = cmdb.readCiQuery({ class: 'server', q: 'db' });
    expect(cmdb.ciFilters(query, ['server', 'database_server'])).toEqual([
      { search: 'db', limit: 100, classKey: 'server' },
      { search: 'db', limit: 100, classKey: 'database_server' },
    ]);
    expect(cmdb.ciFilters(cmdb.readCiQuery({ retired: 'true' }), null)).toEqual([{ includeRetired: true, limit: 100 }]);
    expect(cmdb.ciFilters(cmdb.readCiQuery({ status: 'retired' }), null)).toEqual([{ status: 'retired', includeRetired: true, limit: 100 }]);
    expect(cmdb.ciFilters(cmdb.readCiQuery({}), null)).toEqual([{ limit: 100 }]);
  });

  it('merges several classes’ answers: each item once, by name, the first hundred', () => {
    const a = ciRow({ id: 'a', name: 'Zeta' });
    const b = ciRow({ id: 'b', name: 'Alpha' });
    expect(cmdb.mergeCis([[a, b], [b]]).map((row) => row.name)).toEqual(['Alpha', 'Zeta']);
    expect(cmdb.mergeCis([Array.from({ length: 150 }, (_, index) => ciRow({ id: `x${index}`, name: `Item ${String(index).padStart(3, '0')}` }))])).toHaveLength(100);
  });

  it('keeps the other filters when the class changes, and closes a drawer or sheet', () => {
    expect(cmdb.classHref('q=db&status=down&open=ci:x&new=1', 'server')).toBe('/cmdb?q=db&status=down&class=server');
    expect(cmdb.classHref('class=server&q=db', null)).toBe('/cmdb?q=db');
    expect(cmdb.classHref('', null)).toBe('/cmdb');
    expect(cmdb.drawerTarget('ci:abc', 'ci')).toBe('abc');
    expect(cmdb.drawerTarget(['asset:LAP-1'], 'asset')).toBe('LAP-1');
    expect(cmdb.drawerTarget('asset:LAP-1', 'ci')).toBeNull();
    expect(cmdb.drawerTarget('ci:', 'ci')).toBeNull();
  });
});

describe('classes', () => {
  it('nest under their parents by name; an orphan sits at the top and a loop cannot recurse', () => {
    const tree = cmdb.classTree([...CLASSES, { id: 'c-orphan', key: 'orphan', name: 'Access point', parentId: 'c-gone' }, { id: 'c-loop', key: 'loop', name: 'Loop', parentId: 'c-loop' }]);
    expect(tree.map((node) => node.name)).toEqual(['Access point', 'Business application', 'Loop', 'Server']);
    expect(tree.find((node) => node.key === 'server')?.children.map((node) => node.name)).toEqual(['Database server']);
    expect(cmdb.classPath(CLASSES, 'c-db')).toBe('Server › Database server');
    expect(cmdb.classOptions(cmdb.classTree(CLASSES)).map((option) => option.label)).toEqual(['Business application', 'Server', ' Database server']);
  });

  it('make keys the API accepts, from names with accents', () => {
    expect(cmdb.classKeyFor('Database server')).toBe('database_server');
    expect(cmdb.classKeyFor('Café terminal')).toBe('cafe_terminal');
    expect(cmdb.classKeyFor('1st line')).toBe('');
    expect(cmdb.CLASS_KEY.test('database_server')).toBe(true);
    expect(cmdb.attributeKeyFor('Port count')).toBe('portCount');
  });

  it('own what they add or tighten, not what they inherit unchanged', () => {
    const parent: CiAttribute[] = [{ key: 'env', label: 'Environment', type: 'string', required: false }];
    const carried: CiAttribute[] = [
      { key: 'env', label: 'Environment', type: 'string', required: true },
      { key: 'engine', label: 'Engine', type: 'enum', required: true, options: ['postgres'] },
    ];
    expect(cmdb.ownAttributes(carried, parent).map((attribute) => attribute.key)).toEqual(['env', 'engine']);
    expect(cmdb.ownAttributes(parent, parent)).toEqual([]);
  });

  it('check their attribute rows before saving: labels, keys, duplicates and options', () => {
    const row = { saved: false, keyEdited: false, required: false, options: '' };
    const checked = attributesFrom([
      { ...row, rowId: 'a', label: 'Port count', key: 'portCount', type: 'number' },
      { ...row, rowId: 'b', label: '', key: 'x', type: 'string' },
      { ...row, rowId: 'c', label: 'Ports', key: 'portCount', type: 'number' },
      { ...row, rowId: 'd', label: 'Role', key: 'role', type: 'enum', options: 'Primary\n\nMember\nPrimary' },
      { ...row, rowId: 'e', label: 'Tier', key: 'tier', type: 'enum' },
    ]);
    expect(checked.problems).toEqual({
      b: 'Give the attribute a label.',
      c: 'Another attribute already uses the key portCount.',
      e: 'List at least one option, one per line.',
    });
    expect(checked.list.find((attribute) => attribute.key === 'role')?.options).toEqual(['Primary', 'Member']);
  });
});

describe('relationships, the right way round', () => {
  it('read as sentences from either end', () => {
    expect(cmdb.relationSentence('depends_on', 'Web shop', 'Orders DB')).toBe('Web shop depends on Orders DB: if Orders DB fails, Web shop is in trouble.');
    expect(cmdb.relationSentence('installed_on', 'Agent', 'Laptop')).toBe('Agent is installed on Laptop.');
    expect(cmdb.edgeLabel('runs_on', 'needs')).toBe('Runs on');
    expect(cmdb.edgeLabel('member_of', 'needs')).toBe('A member of');
    expect(cmdb.edgeLabel('depends_on', 'neededBy')).toBe('depends on it');
  });

  it('offer every type both ways from the open item, the symmetric one once, and record the chosen direction', () => {
    const choices = cmdb.relateChoices('Orders DB');
    expect(choices).toHaveLength(9);
    expect(choices.filter((choice) => choice.type === 'connected_to')).toHaveLength(1);
    expect(choices.map((choice) => choice.label)).toContain('…runs on Orders DB');
    const incoming = choices.find((choice) => choice.value === 'in:runs_on')!;
    expect(cmdb.relationshipFor(incoming, 'this', 'other')).toEqual({ fromCi: 'other', toCi: 'this', type: 'runs_on' });
    expect(cmdb.relationshipFor(choices[0]!, 'this', 'other')).toEqual({ fromCi: 'this', toCi: 'other', type: 'depends_on' });
  });

  it('say what fails with it, nearest first, in words', () => {
    const groups = cmdb.impactGroups([
      { id: 'b', name: 'B', status: 'operational', criticality: 'low', serviceId: null, className: 'X', depth: 2, via: 'runs_on' },
      { id: 'a', name: 'A', status: 'operational', criticality: 'high', serviceId: null, className: 'X', depth: 1, via: 'depends_on' },
    ]);
    expect(groups.map((group) => group.label)).toEqual(['Directly', 'Two steps away']);
    expect(cmdb.impactSentence({ total: 3, byCriticality: { low: 0, medium: 1, high: 1, critical: 1 }, services: ['s1', 's2'], worst: 'critical', truncated: false }, ['Shop', 'CRM'])).toBe(
      '3 items are affected, 1 of them critical, across Shop and CRM.',
    );
    expect(cmdb.impactSentence({ total: 1, byCriticality: { low: 1, medium: 0, high: 0, critical: 0 }, services: ['s1'], worst: 'low', truncated: false }, [])).toBe('1 item is affected, across 1 service.');
  });
});

describe('typed class attributes', () => {
  const definitions = ATTRIBUTES.database_server!;

  it('refuse what the API would refuse, per field, before anything is sent', () => {
    const { values, problems } = cmdb.attributeValues(definitions, { cpuCount: 'eight', engine: '', backedUp: '' });
    expect(problems).toEqual({ cpuCount: 'CPU count must be a number.', engine: 'Engine is required.' });
    expect(values).toEqual({});
    expect(cmdb.attributeValues(definitions, { engine: 'oracle' }).problems.engine).toBe('Choose one of the engine options.');
    expect(cmdb.attributeValues([{ key: 'goLive', label: 'Went live', type: 'date', required: false }], { goLive: '31/12/2024' }).problems.goLive).toBe('Went live must be a date.');
  });

  it('send typed values: numbers as numbers, yes-or-no as booleans, and nothing for an unanswered optional field', () => {
    expect(cmdb.attributeValues(definitions, { cpuCount: '1,024', engine: 'mysql', backedUp: 'false' }).values).toEqual({ cpuCount: 1024, engine: 'mysql', backedUp: false });
    expect(cmdb.attributeValues(definitions, { engine: 'mysql' }).values).toEqual({ engine: 'mysql' });
  });

  it('send only what an edit changed, and a cleared answer as null', () => {
    const previous = { engine: 'postgres', cpuCount: 8 };
    expect(cmdb.attributeValues(definitions, cmdb.draftOf(definitions, previous), previous).values).toEqual({});
    expect(cmdb.attributeValues(definitions, { engine: 'postgres', cpuCount: '', backedUp: 'true' }, previous).values).toEqual({ cpuCount: null, backedUp: true });
  });

  it('show values in words, and a date-only value on its own day', () => {
    expect(cmdb.attributeText({ type: 'boolean' }, true, 'en-GB')).toBe('Yes');
    expect(cmdb.attributeText({ type: 'number' }, 1024, 'en-GB')).toBe('1,024');
    expect(cmdb.attributeText({ type: 'date' }, '2026-10-15', 'en-GB')).toBe('15 Oct 2026');
    expect(cmdb.attributeText(undefined, null, 'en-GB')).toBe('');
    expect(cmdb.formatDay('2026-01-01', 'en-US')).toBe('Jan 1, 2026');
  });
});

describe('an item’s history', () => {
  it('reads as what somebody did', () => {
    expect(cmdb.historyEntry({ action: 'cmdb.ci.created', before: null, after: { criticality: 'high' }, reason: null }, 'en-GB')).toEqual({ title: 'recorded it', body: 'High criticality' });
    expect(cmdb.historyEntry({ action: 'cmdb.ci.status.changed', before: { status: 'operational' }, after: { status: 'down', note: 'Disk failed' }, reason: null }, 'en-GB')).toEqual({
      title: 'changed its status from Operational to Down',
      tone: 'danger',
      body: 'Disk failed',
    });
    expect(cmdb.historyEntry({ action: 'cmdb.ci.updated', before: { name: 'A', criticality: 'low' }, after: { name: 'B', criticality: 'high' }, reason: null }, 'en-GB').body).toBe(
      'Renamed from “A” to “B” and criticality from Low to High',
    );
    expect(cmdb.historyEntry({ action: 'cmdb.ci.retired', before: null, after: { reason: 'Decommissioned' }, reason: null }, 'en-GB')).toMatchObject({ title: 'retired it', body: 'Decommissioned' });
  });
});

describe('assets in words', () => {
  it('read the URL defensively, including the Command centre’s ?warranty=30', () => {
    expect(cmdb.readAssetQuery({ warranty: '30', status: 'assigned', costCentre: 'IT-OPS', holder: ID.sam, q: 'LAP' })).toEqual({
      q: 'LAP',
      status: 'assigned',
      costCentre: 'IT-OPS',
      holder: ID.sam,
      warranty: '30',
    });
    expect(cmdb.readAssetQuery({ warranty: '45', status: 'lost', holder: 'sam' })).toEqual({ q: '', status: null, costCentre: null, holder: null, warranty: null });
    expect(cmdb.assetFilter(cmdb.readAssetQuery({ q: 'LAP', holder: ID.sam }))).toEqual({ search: 'LAP', userId: ID.sam, limit: 100 });
  });

  it('narrow the warranty report by the rest of the query, as the list endpoint would', () => {
    const base = { id: 'x', serial: null, ciId: null, location: null, supplier: null, purchasedOn: null, retiredAt: null, holderId: null };
    const rows = [
      { ...base, tag: 'LAP-0001', status: 'assigned', costCentre: 'IT-OPS', warrantyEndsOn: '2026-10-12', expired: false, holderId: ID.sam },
      { ...base, tag: 'LAP-0002', status: 'in_stock', costCentre: 'SALES', warrantyEndsOn: '2026-09-10', expired: true },
    ];
    expect(cmdb.narrowWarrantyRows(rows, cmdb.readAssetQuery({ warranty: 'expired' })).map((row) => row.tag)).toEqual(['LAP-0002']);
    expect(cmdb.narrowWarrantyRows(rows, cmdb.readAssetQuery({ warranty: '30', q: 'lap', costCentre: 'IT-OPS' })).map((row) => row.tag)).toEqual(['LAP-0001']);
    expect(cmdb.narrowWarrantyRows(rows, cmdb.readAssetQuery({ warranty: '30', holder: ID.sam })).map((row) => row.tag)).toEqual(['LAP-0001']);
  });

  it('say when a warranty ends, in words and not colour alone', () => {
    expect(cmdb.warrantyChip(cmdb.warrantyState('2026-10-12', '2026-09-30'))).toMatchObject({ label: 'Ends in 12 days', tone: 'warning' });
    expect(cmdb.warrantyChip(cmdb.warrantyState('2026-10-01', '2026-09-30'))?.label).toBe('Ends tomorrow');
    expect(cmdb.warrantyChip(cmdb.warrantyState('2026-09-30', '2026-09-30'))?.label).toBe('Ends today');
    expect(cmdb.warrantyChip(cmdb.warrantyState('2026-09-10', '2026-09-30'))).toMatchObject({ label: 'Expired', tone: 'danger' });
    expect(cmdb.warrantyChip(cmdb.warrantyState('2027-11-04', '2026-09-30'))).toBeNull();
    expect(cmdb.warrantyState(null, '2026-09-30')).toEqual({ kind: 'none', days: null });
    expect(cmdb.todayIn('Pacific/Auckland', new Date('2026-09-30T13:00:00Z'))).toBe('2026-10-01');
  });

  it('name the holder, and say nothing when the API does not', () => {
    const row = { id: 'a', tag: 'LAP-1', serial: null, status: 'assigned', ciId: null, location: null, costCentre: null, supplier: null, purchasedOn: null, warrantyEndsOn: null, retiredAt: null };
    const view = cmdb.assetView({ ...row, holderId: ID.alex }, { ...context, today: '2026-09-30', locale: 'en-GB' });
    expect(view.holder).toEqual({ id: ID.alex, name: 'Alex Administrator' });
    expect(cmdb.assetView(row, { ...context, today: '2026-09-30', locale: 'en-GB' }).holder).toBeUndefined();
    const expired = { ...row, warrantyEndsOn: '2026-09-10' };
    expect(cmdb.warrantyChip(cmdb.assetView(expired, { ...context, today: '2026-09-30', locale: 'en-GB' }).warranty)?.label).toBe('Expired');
    expect(cmdb.warrantyChip(cmdb.assetView({ ...expired, status: 'disposed', retiredAt: '2026-09-20T10:00:00Z' }, { ...context, today: '2026-09-30', locale: 'en-GB' }).warranty)).toBeNull();
    expect(cmdb.costCentres([{ costCentre: 'SALES' }, { costCentre: 'IT-OPS' }, { costCentre: null }, { costCentre: 'SALES' }], 'HR')).toEqual(['HR', 'IT-OPS', 'SALES']);
  });
});

/* ======================================================================= */

describe('the Configuration items page', () => {
  const rows = [ciView(), cmdb.ciView(ciRow({ id: ID.web, name: 'Web shop', classId: 'c-app', ownerId: ID.sam, criticality: 'critical' }), context)];
  function ciView() {
    return cmdb.ciView(ciRow(), context);
  }
  const base = {
    classes: CLASSES,
    rows,
    query: cmdb.readCiQuery({}),
    unknownClass: false,
    capped: false,
    services: null,
    canManage: true,
    canAudit: true,
    canReadTickets: true,
    mayOpenTickets: true,
    mayOpenAudit: true,
  };

  it('lists classes as links, the chosen one current, keeping the other filters', () => {
    search = 'class=server&q=db';
    const { container } = render(
      <Frame>
        <CisView {...base} query={cmdb.readCiQuery(new URLSearchParams(search))} />
      </Frame>,
    );
    const nav = container.querySelector('nav[aria-label="Classes"]')!;
    const links = [...nav.querySelectorAll('a')].map((link) => [text(link), link.getAttribute('href')]);
    expect(links).toEqual([
      ['All classes', '/cmdb?q=db'],
      ['Business application', '/cmdb?class=application&q=db'],
      ['Server', '/cmdb?class=server&q=db'],
      ['Database server', '/cmdb?class=database_server&q=db'],
    ]);
    expect(text(nav.querySelector('[aria-current="page"]'))).toBe('Server');
    // No ARIA tree: nested lists of links.
    expect(nav.querySelector('[role="tree"]')).toBeNull();
    expect(text(container.querySelector('h2'))).toBe('Server');
    expect(text(container)).toContain('Includes Database server.');
  });

  it('names classes, people and criticality in words, never ids', () => {
    const { container } = render(
      <Frame>
        <CisView {...base} />
      </Frame>,
    );
    const table = container.querySelector('table')!;
    expect(text(table)).toContain('Orders database');
    expect(text(table)).toContain('Database server');
    expect(text(table)).toContain('Critical');
    expect(text(table)).not.toContain('00000000-');
    expect(text(table)).not.toContain('c-db');
  });

  it('says when the API returned only the first hundred', () => {
    const { container } = render(
      <Frame>
        <CisView {...base} capped />
      </Frame>,
    );
    expect(text(container)).toContain('Showing the first 100 — search or filter to narrow.');
  });

  it('offers no writes without Manage configuration items, and says why', () => {
    const { container } = render(
      <Frame>
        <CisView {...base} canManage={false} viewOnly={{ label: 'Configuration items', permission: 'Manage configuration items', key: 'cmdb.manage' }} />
      </Frame>,
    );
    expect(buttonNamed(container, 'New item')).toBeUndefined();
    expect(buttonNamed(container, 'New class')).toBeUndefined();
    expect(text(container)).toContain('View only');
  });

  it('starts a new desk at its first class', () => {
    const { container } = render(
      <Frame>
        <CisView {...base} classes={[]} rows={[]} />
      </Frame>,
    );
    expect(text(container)).toContain('No classes yet');
    expect(buttonNamed(container, 'New class')).toBeDefined();
    expect(buttonNamed(container, 'New item')).toBeUndefined();
  });
});

describe('an item’s drawer', () => {
  const rows = [cmdb.ciView(ciRow(), context)];
  const props = {
    classes: CLASSES,
    rows,
    query: cmdb.readCiQuery({}),
    unknownClass: false,
    capped: false,
    services: null,
    canManage: true,
    canReadTickets: true,
    mayOpenTickets: true,
    mayOpenAudit: true,
  };

  it('opens from the URL with its tabs, History only for people who may read the audit log', async () => {
    search = `open=ci:${ID.orders}`;
    render(
      <Frame>
        <CisView {...props} canAudit={false} />
      </Frame>,
    );
    await settle();
    const drawer = document.querySelector('[role="dialog"]')!;
    expect([...drawer.querySelectorAll('[role="tab"]')].map((tab) => text(tab))).toEqual(['Overview', 'Relationships', 'Impact', 'Linked']);
    expect(text(drawer)).toContain('Server › Database server');
    expect(text(drawer)).toContain('Alex Administrator');
    expect(text(drawer)).toContain('db-orders-01');
    expect(classAttributes).toHaveBeenCalledWith('database_server');
    expect(text(drawer)).toContain('Engine');
    expect(text(drawer)).toContain('postgres');
    expect(buttonNamed(drawer, 'Edit')).toBeDefined();
    expect(buttonNamed(drawer, 'Retire…')).toBeDefined();
  });

  it('reads relationships the right way round, and removing one sends that direction', async () => {
    search = `open=ci:${ID.orders}`;
    render(
      <Frame>
        <CisView {...props} canAudit />
      </Frame>,
    );
    await settle();
    const drawer = document.querySelector('[role="dialog"]')!;
    await clickAsync([...drawer.querySelectorAll('[role="tab"]')].find((tab) => text(tab) === 'Relationships')!);
    await settle();
    const lines = [...drawer.querySelectorAll('.app-CiEdge')].map((line) => text(line));
    expect(lines[0]).toContain('Runs on Host LDN-01');
    expect(lines[1]).toContain('Web shop depends on it');
    expect(lines[1]).toContain('Degraded');
    await clickAsync(buttonNamed(drawer, 'Remove: Web shop depends on Orders database')!);
    expect(unrelate).toHaveBeenCalledWith({ fromCi: ID.web, toCi: ID.orders, type: 'depends_on' });
  });

  it('says what fails with it, by distance', async () => {
    search = `open=ci:${ID.orders}`;
    render(
      <Frame>
        <CisView {...props} canAudit />
      </Frame>,
    );
    await settle();
    const drawer = document.querySelector('[role="dialog"]')!;
    await clickAsync([...drawer.querySelectorAll('[role="tab"]')].find((tab) => text(tab) === 'Impact')!);
    await settle();
    expect(text(drawer)).toContain('If Orders database fails: 2 items are affected, 1 of them critical.');
    expect([...drawer.querySelectorAll('.app-CiSection__title')].map((title) => text(title))).toEqual(['Directly 1', 'Two steps away 1']);
  });

  it('shows no writes to someone who may only read', async () => {
    search = `open=ci:${ID.orders}`;
    render(
      <Frame>
        <CisView {...props} canManage={false} canAudit />
      </Frame>,
    );
    await settle();
    const drawer = document.querySelector('[role="dialog"]')!;
    expect(buttonNamed(drawer, 'Edit')).toBeUndefined();
    expect(buttonNamed(drawer, 'Retire…')).toBeUndefined();
  });
});

describe('the item form', () => {
  const noop = (): void => undefined;

  it('asks for the class first, then its typed details, and sends them typed', async () => {
    const onDone = vi.fn();
    const { container } = render(
      <Frame>
        <CiForm formId="f" classes={CLASSES} services={null} onDirtyChange={noop} onBusyChange={noop} onDone={onDone} />
      </Frame>,
    );
    const form = container.querySelector('form')!;
    await submit(form);
    expect(text(container)).toContain('Choose a class. It decides which details an item carries.');
    expect(createCi).not.toHaveBeenCalled();

    choose(container.querySelector<HTMLSelectElement>('#ci-class')!, 'database_server');
    await settle();
    expect(classAttributes).toHaveBeenCalledWith('database_server');
    type(container.querySelector<HTMLInputElement>('#ci-name')!, 'Billing database');
    type(container.querySelector<HTMLInputElement>('#ci-attribute-cpuCount')!, 'four');
    await submit(form);
    expect(text(container)).toContain('CPU count must be a number.');
    expect(text(container)).toContain('Engine is required.');
    expect(createCi).not.toHaveBeenCalled();

    type(container.querySelector<HTMLInputElement>('#ci-attribute-cpuCount')!, '4');
    choose(container.querySelector<HTMLSelectElement>('#ci-attribute-engine')!, 'mysql');
    await submit(form);
    expect(createCi).toHaveBeenCalledWith({ classKey: 'database_server', name: 'Billing database', criticality: 'medium', attributes: { cpuCount: 4, engine: 'mysql' } });
    expect(onDone).toHaveBeenCalled();
    // The caller refreshes after moving to the new item's drawer, not the form during it.
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('sends only what an edit changed', async () => {
    const onDone = vi.fn();
    const ci = cmdb.ciView(ciRow(), context);
    const { container } = render(
      <Frame>
        <CiForm formId="f" ci={ci} classes={CLASSES} services={null} onDirtyChange={noop} onBusyChange={noop} onDone={onDone} />
      </Frame>,
    );
    await settle();
    expect(container.querySelector('#ci-class')).toBeNull();
    type(container.querySelector<HTMLInputElement>('#ci-name')!, 'Orders DB');
    await submit(container.querySelector('form')!);
    expect(updateCi).toHaveBeenCalledWith(ID.orders, { name: 'Orders DB' });
  });

  it('will not pretend to clear what the API keeps', async () => {
    const ci = cmdb.ciView(ciRow(), context);
    const { container } = render(
      <Frame>
        <CiForm formId="f" ci={ci} classes={CLASSES} services={null} onDirtyChange={noop} onBusyChange={noop} onDone={noop} />
      </Frame>,
    );
    await settle();
    type(container.querySelector<HTMLInputElement>('#ci-external-key')!, '');
    await submit(container.querySelector('form')!);
    expect(text(container)).toContain('An identifier can’t be removed once set. Change it instead.');
    expect(updateCi).not.toHaveBeenCalled();
  });
});

describe('an asset’s drawer', () => {
  const noop = (): void => undefined;

  it('reads the asset with its holder by name and the warranty in words', async () => {
    pathname = '/cmdb/assets';
    search = 'open=asset:LAP-0001';
    render(
      <Frame>
        <AssetDrawer tag="LAP-0001" today="2026-09-30" canManage canReadCis takenTags={[]} onClose={noop} />
      </Frame>,
    );
    await settle();
    const drawer = document.querySelector('[role="dialog"]')!;
    expect(asset).toHaveBeenCalledWith('LAP-0001');
    expect(text(drawer)).toContain('Sam Agent');
    expect(text(drawer)).toContain('12 Oct 2026');
    expect(text(drawer)).toContain('Ends in 12 days');
    expect(text(drawer)).toContain('Standard issue');
    expect(text(drawer)).not.toContain(ID.sam);
  });

  it('assigns to a person or a place — one of them is needed — and returns to stock', async () => {
    pathname = '/cmdb/assets';
    render(
      <Frame>
        <AssetDrawer tag="LAP-0001" today="2026-09-30" canManage canReadCis takenTags={[]} onClose={noop} />
      </Frame>,
    );
    await settle();
    click(buttonNamed(document.querySelector('[role="dialog"]')!, 'Assign to…')!);
    await settle();
    const dialog = [...document.querySelectorAll('[role="dialog"]')].find((node) => text(node).startsWith('Assign LAP-0001'))!;
    await submit(dialog.querySelector('form')!);
    expect(text(dialog)).toContain('Choose who has it, or say where it is.');
    expect(assignAsset).not.toHaveBeenCalled();
    type([...dialog.querySelectorAll<HTMLInputElement>('input')].find((input) => input.closest('.itsm-Field') && text(input.closest('.itsm-Field')).startsWith('Location'))!, 'Store room');
    await submit(dialog.querySelector('form')!);
    expect(assignAsset).toHaveBeenCalledWith('LAP-0001', { location: 'Store room' });

    click(buttonNamed(document.querySelector('[role="dialog"]')!, 'Return')!);
    await settle();
    const giveBack = [...document.querySelectorAll('[role="dialog"]')].find((node) => text(node).startsWith('Return LAP-0001'))!;
    await submit(giveBack.querySelector('form')!);
    expect(returnAsset).toHaveBeenCalledWith('LAP-0001', undefined);
  });

  it('offers nothing to change without Manage assets', async () => {
    pathname = '/cmdb/assets';
    render(
      <Frame>
        <AssetDrawer tag="LAP-0001" today="2026-09-30" canManage={false} canReadCis takenTags={[]} onClose={noop} />
      </Frame>,
    );
    await settle();
    const drawer = document.querySelector('[role="dialog"]')!;
    expect(buttonNamed(drawer, 'Assign to…')).toBeUndefined();
    expect(buttonNamed(drawer, 'Retire…')).toBeUndefined();
  });
});

describe('the pages’ stylesheet', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const defined = new Set([...Object.keys(structuralVariables()), ...Object.keys(themeVariables('apple'))]);
  const css = readFileSync(join(here, '..', 'components', 'cmdb', 'cmdb.css'), 'utf8');

  it('spends only custom properties the design system emits', () => {
    const used = [...new Set([...css.matchAll(/var\((--itsm-[a-zA-Z0-9-]+)/g)].map((match) => match[1]!))];
    expect(used.length).toBeGreaterThan(3);
    expect(used.filter((variable) => !defined.has(variable))).toEqual([]);
  });

  it('declares only app- classes', () => {
    for (const line of css.split('\n').filter((entry) => /^\.[a-zA-Z]/.test(entry.trim()))) expect(line.trim().startsWith('.app-'), line).toBe(true);
  });
});
