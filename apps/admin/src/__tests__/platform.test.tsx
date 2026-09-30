// @vitest-environment jsdom
import { act, forwardRef, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanRow, TenantRow } from '@itsm/sdk';

vi.mock('server-only', () => ({}));

const router = { refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), forward: vi.fn() };
vi.mock('next/navigation', () => ({
  usePathname: () => '/tenants',
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(),
}));

const refresh = vi.fn();
vi.mock('next/cache', () => ({ refresh }));

const platform = {
  suspendTenant: vi.fn(async (id: string) => ({ id, status: 'suspended' })),
  resumeTenant: vi.fn(async (id: string) => ({ id, status: 'active' })),
  assignPlan: vi.fn(async (id: string, planKey: string) => ({ id, planKey })),
  setAiRegions: vi.fn(async (id: string, regions: string[]) => ({ id, aiAllowedRegions: regions })),
};
const loadActor = vi.fn();
const requirePlatformOperator = vi.fn();
vi.mock('../server/session.js', () => ({ loadActor, requirePlatformOperator }));

const { ItsmProvider } = await import('@itsm/ui');
const actions = await import('../app/(console)/(platform)/actions.js');
const presentation = await import('../components/platform/presentation.js');
const { TenantsView, drawerParam } = await import('../components/platform/TenantsView.js');
const { default: TenantsPage } = await import('../app/(console)/(platform)/tenants/page.js');
const { default: PlansPage } = await import('../app/(console)/(platform)/plans/page.js');
const { cleanupDocument, click, clickAsync, render, type } = await import('./support/render.js');

/**
 * The platform section (SPEC §6.1 `/tenants`, `/plans`; §3.6 rule 7): tenants
 * with their status and plan, a drawer with the operator's actions, plans as
 * a price list — and Server Actions that ask again, on every call, whether
 * the caller is a platform operator, because an action is an endpoint and
 * not a page.
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
      usePathname={() => '/tenants'}
      useSearchParams={() => new URLSearchParams()}
      locale="en-GB"
      timeZone="Europe/London"
    >
      {children}
    </ItsmProvider>
  );
}

beforeEach(() => {
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
  [...root.querySelectorAll('button')].find((button) => text(button) === name) as HTMLButtonElement | undefined;
const dialogWith = (words: string): Element | undefined => [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].find((dialog) => text(dialog).includes(words));

async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

const TENANT = '01a0ee8e-2e36-7705-b28e-80a403f83962';

function actor(permissions: string[]) {
  return {
    kind: 'ok' as const,
    session: {},
    api: { platform },
    me: { permissions: permissions.map((key) => ({ key, scope: 'any' })) },
  };
}

/* ======================================================================= */

describe('the Server Actions', () => {
  it('refuse a caller who is not a platform operator now, with the section’s 404, and never reach the API', async () => {
    loadActor.mockResolvedValue(actor(['admin.setting.manage', 'identity.user.manage']));
    for (const result of [
      await actions.suspendTenant(TENANT, 'Unpaid'),
      await actions.resumeTenant(TENANT),
      await actions.changePlan(TENANT, 'starter'),
      await actions.setAiRegions(TENANT, ['eu-west']),
    ]) {
      expect(result).toEqual({ ok: false, problem: { status: 404, title: 'Not found' } });
    }
    for (const call of Object.values(platform)) expect(call).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refuse when the session is gone or the API would not say who is asking', async () => {
    loadActor.mockResolvedValue({ kind: 'ended' });
    expect(await actions.resumeTenant(TENANT)).toMatchObject({ ok: false, problem: { status: 404 } });
    expect(platform.resumeTenant).not.toHaveBeenCalled();
  });

  it('ask on every call, so a permission removed after the page loaded is refused', async () => {
    loadActor.mockResolvedValueOnce(actor(['platform.tenant.manage'])).mockResolvedValueOnce(actor([]));
    expect(await actions.resumeTenant(TENANT)).toEqual({ ok: true });
    expect(await actions.resumeTenant(TENANT)).toMatchObject({ ok: false });
    expect(platform.resumeTenant).toHaveBeenCalledTimes(1);
    expect(loadActor).toHaveBeenCalledTimes(2);
  });

  it('pass an operator’s writes to the platform API and refresh the page', async () => {
    loadActor.mockResolvedValue(actor(['platform.tenant.manage']));
    expect(await actions.suspendTenant(TENANT, '  Unpaid since June ')).toEqual({ ok: true });
    expect(platform.suspendTenant).toHaveBeenCalledWith(TENANT, 'Unpaid since June');
    expect(await actions.changePlan(TENANT, 'professional')).toEqual({ ok: true });
    expect(platform.assignPlan).toHaveBeenCalledWith(TENANT, 'professional');
    expect(await actions.setAiRegions(TENANT, ['eu-west', 'us'])).toEqual({ ok: true });
    expect(platform.setAiRegions).toHaveBeenCalledWith(TENANT, ['eu-west', 'us']);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('check every argument, since it arrives from a request and not from the page', async () => {
    loadActor.mockResolvedValue(actor(['platform.tenant.manage']));
    expect(await actions.resumeTenant('../../users')).toMatchObject({ ok: false, problem: { status: 404 } });
    expect(await actions.suspendTenant(TENANT, '   ')).toMatchObject({ ok: false, problem: { status: 422 } });
    expect(await actions.changePlan(TENANT, 'bad key!')).toMatchObject({ ok: false, problem: { status: 422 } });
    expect(await actions.setAiRegions(TENANT, ['EU West'])).toMatchObject({ ok: false, problem: { status: 422 } });
    expect(await actions.setAiRegions(TENANT, 'eu-west' as never)).toMatchObject({ ok: false, problem: { status: 422 } });
    for (const call of Object.values(platform)) expect(call).not.toHaveBeenCalled();
  });

  it('say what the API refused, without refreshing', async () => {
    loadActor.mockResolvedValue(actor(['platform.tenant.manage']));
    platform.assignPlan.mockRejectedValueOnce(Object.assign(new Error('the trial plan is retired; nobody new goes onto it'), { status: 409 }));
    const result = await actions.changePlan(TENANT, 'trial');
    expect(result.ok).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('are the only exports of the actions file, and none of them hands back the session', () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'app', '(console)', '(platform)', 'actions.ts'), 'utf8');
    expect(source.startsWith("'use server';")).toBe(true);
    const exported = [...source.matchAll(/^export (?:async function|const|function) (\w+)/gm)].map((match) => match[1]);
    expect(exported).toEqual(['suspendTenant', 'resumeTenant', 'changePlan', 'setAiRegions']);
  });
});

/* ======================================================================= */

describe('in words', () => {
  const plans: PlanRow[] = [
    { key: 'starter', name: 'Starter', description: 'One desk.', features: [], pricePerAgentMicros: '19000000', currency: 'GBP', isRetired: false, sortOrder: 20, limits: [{ meter: 'storage', soft: 8 * 1024 ** 3, hard: 10 * 1024 ** 3 }, { meter: 'agents', soft: 8, hard: 10 }] },
    { key: 'enterprise', name: 'Enterprise', description: null, features: ['ticket.customFields'], pricePerAgentMicros: null, currency: 'GBP', isRetired: true, sortOrder: 40, limits: [{ meter: 'agents', soft: 400, hard: null }] },
  ];

  it('prices per agent and says limits the way the plan enforces them', () => {
    expect(presentation.formatPrice('19000000', 'GBP')).toBe('£19.00');
    expect(presentation.formatPrice(null, 'GBP')).toBe('Negotiated');
    const starter = presentation.planView(plans[0]!);
    expect(starter.limits).toEqual([
      { label: 'Agents', text: 'Up to 10 · warned at 8' },
      { label: 'Storage', text: 'Up to 10 GB · warned at 8 GB' },
    ]);
    const enterprise = presentation.planView(plans[1]!);
    expect(enterprise).toMatchObject({ retired: true, price: 'Negotiated', features: ['Custom fields on tickets'] });
    expect(enterprise.limits).toEqual([{ label: 'Agents', text: 'No limit · warned at 400' }]);
  });

  it('names a tenant’s plan, and says so when an older API did not', () => {
    const row: TenantRow = { id: TENANT, name: 'Acme', slug: 'acme', status: 'suspended', region: 'eu-west', createdAt: '2026-09-01T10:00:00Z', planKey: 'starter', aiAllowedRegions: [], suspendedAt: '2026-09-20T10:00:00Z' };
    const format = { locale: 'en-GB', timeZone: 'Europe/London' };
    expect(presentation.tenantView(row, plans, format)).toMatchObject({ plan: 'Starter', statusLabel: 'Suspended', aiRegions: [], suspendedSince: expect.stringMatching(/20 Sept? 2026/) });
    expect(presentation.tenantView({ ...row, planKey: null }, plans, format).plan).toBe('No plan');
    const { planKey: _planKey, aiAllowedRegions: _regions, ...older } = row;
    expect(presentation.tenantView(older, plans, format)).toMatchObject({ plan: null, aiRegions: null });
  });

  it('reads AI regions as the API will, and says what an empty list means', () => {
    expect(presentation.parseRegions('us, eu-west eu-west')).toEqual({ ok: true, regions: ['eu-west', 'us'] });
    expect(presentation.parseRegions('')).toEqual({ ok: true, regions: [] });
    expect(presentation.parseRegions('eu_west')).toMatchObject({ ok: false });
    expect(presentation.parseRegions('EU-West')).toEqual({ ok: true, regions: ['eu-west'] });
    expect(presentation.regionsText([], 'eu-west')).toBe('Only where its data lives (eu-west)');
    expect(presentation.regionsText(['us'], 'eu-west')).toBe('us');
  });
});

/* ======================================================================= */

describe('the tenants page', () => {
  const view = (overrides: Partial<Parameters<typeof presentation.tenantView>[0]> = {}) =>
    presentation.tenantView(
      { id: TENANT, name: 'Acme Group', slug: 'acme', status: 'active', region: 'eu-west', createdAt: '2026-09-01T10:00:00Z', planKey: 'starter', aiAllowedRegions: [], ...overrides },
      [{ key: 'starter', name: 'Starter', description: null, features: [], pricePerAgentMicros: null, currency: 'GBP', isRetired: false, sortOrder: 1, limits: [] }],
      { locale: 'en-GB', timeZone: 'Europe/London' },
    );
  const plans = [
    { key: 'starter', name: 'Starter', retired: false },
    { key: 'professional', name: 'Professional', retired: false },
    { key: 'trial', name: 'Trial', retired: true },
  ];
  const wired = {
    suspend: vi.fn(async () => ({ ok: true as const })),
    resume: vi.fn(async () => ({ ok: true as const })),
    changePlan: vi.fn(async () => ({ ok: true as const })),
    setAiRegions: vi.fn(async () => ({ ok: true as const })),
  };
  const meters = [{ meter: 'agents' as const, label: 'Agents', description: '', display: '12 people', period: 'Now', unit: 'people' as const, value: 12, soft: 8, hard: 10, state: 'blocked' as const, lines: 'The plan stops at 10. Administrators are warned at 8.' }];

  it('lists tenants with their status and plan, and opens the drawer by navigating to it', () => {
    render(
      <Frame>
        <TenantsView rows={[view()]} plans={plans} detail={null} actions={wired} />
      </Frame>,
    );
    expect(text(document.querySelector('table'))).toContain('Acme Group');
    expect(text(document.querySelector('table'))).toContain('Starter');
    expect(text(document.querySelector('table'))).toContain('Active');
    const title = [...document.querySelectorAll<HTMLElement>('table button, table a')].find((entry) => text(entry).includes('Acme Group'))!;
    click(title);
    expect(router.push).toHaveBeenCalledWith(drawerParam(TENANT), { scroll: false });
    // The sheet opens at once with the row; the meters come with the page.
    expect(dialogWith('Acme Group')).toBeDefined();
    expect(text(dialogWith('Acme Group'))).toContain('Loading usage');
  });

  it('shows the server’s meters, and suspends only after the slug is typed and a reason given', async () => {
    render(
      <Frame>
        <TenantsView rows={[view()]} plans={plans} detail={{ id: TENANT, meters }} actions={wired} />
      </Frame>,
    );
    const sheet = dialogWith('Acme Group')!;
    expect(text(sheet)).toContain('12 people');
    expect(text(sheet)).toContain('At the limit');
    click(buttonNamed(sheet, 'Suspend…')!);
    await settle(20);
    const confirm = dialogWith('Suspend Acme Group?')!;
    const go = buttonNamed(confirm, 'Suspend tenant')!;
    await clickAsync(go);
    expect(wired.suspend).not.toHaveBeenCalled();
    const [reason, slug] = [confirm.querySelector('textarea, input[name="reason"]'), [...confirm.querySelectorAll('input')].find((input) => input.getAttribute('name') !== 'reason')];
    if (reason) type(reason as HTMLTextAreaElement, 'Unpaid since June');
    type(slug as HTMLInputElement, 'acme');
    await clickAsync(buttonNamed(confirm, 'Suspend tenant')!);
    await settle();
    expect(wired.suspend).toHaveBeenCalledWith(TENANT, 'Unpaid since June');
  });

  it('keeps the confirmation open with the API’s reason when an action is refused', async () => {
    wired.resume.mockResolvedValueOnce({ ok: false, problem: { status: 404, title: 'Not found', detail: 'You can no longer do this.' } } as never);
    render(
      <Frame>
        <TenantsView rows={[view({ status: 'suspended', suspendedAt: '2026-09-20T10:00:00Z' })]} plans={plans} detail={{ id: TENANT, meters }} actions={wired} />
      </Frame>,
    );
    const sheet = dialogWith('Acme Group')!;
    expect(text(sheet)).toContain('Suspended since');
    click(buttonNamed(sheet, 'Resume…')!);
    await settle(20);
    const confirm = dialogWith('Resume Acme Group?')!;
    await clickAsync(buttonNamed(confirm, 'Resume tenant')!);
    await settle();
    expect(wired.resume).toHaveBeenCalledWith(TENANT);
    expect(dialogWith('Resume Acme Group?')).toBeDefined();
    expect(text(dialogWith('Resume Acme Group?'))).toContain('You can no longer do this.');
  });

  it('offers retired plans only to a tenant already on one, and changes plan after asking', async () => {
    render(
      <Frame>
        <TenantsView rows={[view()]} plans={plans} detail={{ id: TENANT, meters }} actions={wired} />
      </Frame>,
    );
    const sheet = dialogWith('Acme Group')!;
    const select = sheet.querySelector<HTMLSelectElement>('select')!;
    expect([...select.options].map((option) => option.value).filter(Boolean)).toEqual(['starter', 'professional']);
    const change = buttonNamed(sheet, 'Change plan')!;
    expect(change.getAttribute('aria-disabled')).toBe('true');
    act(() => {
      select.value = 'professional';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    click(buttonNamed(sheet, 'Change plan')!);
    await settle(20);
    await clickAsync(buttonNamed(dialogWith('Move Acme Group to Professional?')!, 'Change plan')!);
    await settle();
    expect(wired.changePlan).toHaveBeenCalledWith(TENANT, 'professional');
  });

  it('says when a linked tenant no longer exists', () => {
    render(
      <Frame>
        <TenantsView rows={[]} plans={plans} detail={{ id: TENANT, meters: null, problem: { status: 404 } }} actions={wired} />
      </Frame>,
    );
    expect(text(dialogWith('That tenant no longer exists'))).toContain('That tenant no longer exists');
  });
});

/* ======================================================================= */

describe('the gate', () => {
  it('keeps the platform pages behind the layout’s 404, with loading files only below it', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const platformDir = join(here, '..', 'app', '(console)', '(platform)');
    expect(readFileSync(join(platformDir, 'layout.tsx'), 'utf8')).toContain('await requirePlatformOperator()');
    for (const page of ['tenants/page.tsx', 'plans/page.tsx']) expect(readFileSync(join(platformDir, page), 'utf8')).toContain('await requirePlatformOperator()');
  });
});

describe('the pages, rendered as the server would', () => {
  const operatorApi = {
    platform: {
      ...platform,
      tenants: vi.fn(async () => [
        { id: TENANT, name: 'Acme Group', slug: 'acme', status: 'active', region: 'eu-west', createdAt: '2026-09-01T10:00:00Z', planKey: 'professional', aiAllowedRegions: ['eu-west'], suspendedAt: null },
      ]),
      plans: vi.fn(async () => [
        { key: 'professional', name: 'Professional', description: 'One desk running properly.', features: ['ticket.customFields'], pricePerAgentMicros: '45000000', currency: 'GBP', isRetired: false, sortOrder: 30, limits: [{ meter: 'agents', soft: 40, hard: 50 }] },
        { key: 'trial', name: 'Trial', description: null, features: [], pricePerAgentMicros: null, currency: 'GBP', isRetired: true, sortOrder: 10, limits: [] },
      ]),
      tenantUsage: vi.fn(async () => ({ planKey: 'professional', meters: [{ meter: 'agents', value: 12, display: '12 people', state: 'ok', period: 'live', soft: 40, hard: 50 }] })),
    },
  };
  beforeEach(() => {
    requirePlatformOperator.mockResolvedValue({ me: { locale: 'en-GB', timeZone: 'Europe/London', permissions: [{ key: 'platform.tenant.manage', scope: 'any' }] }, api: operatorApi, session: {} });
  });

  it('renders tenants with the open tenant’s meters read on the server, and the operator cue', async () => {
    const element = await TenantsPage({ searchParams: Promise.resolve({ open: `tenant:${TENANT}` }) });
    render(<Frame>{element}</Frame>);
    expect(operatorApi.platform.tenantUsage).toHaveBeenCalledWith(TENANT);
    expect(text(document.querySelector('h1'))).toBe('Tenants');
    expect(text(document.body)).toContain('Operator');
    expect(text(document.querySelector('table'))).toContain('Professional');
    const sheet = dialogWith('Acme Group')!;
    expect(text(sheet)).toContain('12 people');
    expect(text(sheet)).toContain('eu-west');
  });

  it('never asks for the usage of a tenant that is not in the list', async () => {
    const element = await TenantsPage({ searchParams: Promise.resolve({ open: 'tenant:00000000-0000-4000-8000-000000000000' }) });
    render(<Frame>{element}</Frame>);
    expect(operatorApi.platform.tenantUsage).not.toHaveBeenCalled();
    expect(text(dialogWith('That tenant no longer exists'))).toContain('That tenant no longer exists');
  });

  it('renders plans as cards in their order, with price, limits, features and the retired pill', async () => {
    const element = await PlansPage();
    render(<Frame>{element}</Frame>);
    const cards = [...document.querySelectorAll('.app-Plans__item')].map(text);
    expect(cards[0]).toContain('Trial');
    expect(cards[0]).toContain('Retired');
    expect(cards[1]).toContain('£45.00 per agent a month');
    expect(cards[1]).toContain('Up to 50 · warned at 40');
    expect(cards[1]).toContain('Includes Custom fields on tickets.');
  });
});
