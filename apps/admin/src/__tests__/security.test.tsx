// @vitest-environment jsdom
import { act, forwardRef, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PermissionRow, RoleRow, SecurityAlertRow } from '@itsm/sdk';

vi.mock('server-only', () => ({}));

let search = '';
const router = { refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), forward: vi.fn() };
vi.mock('next/navigation', () => ({
  usePathname: () => '/security',
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(search),
}));

const { ItsmProvider } = await import('@itsm/ui');
const security = await import('../components/security/presentation.js');
const { AlertsView } = await import('../components/security/AlertsView.js');
const { AccessView } = await import('../components/security/AccessView.js');
const { cleanupDocument, click, render } = await import('./support/render.js');

/**
 * Security (SPEC §6.1 `/security/**`, B §3.15): alerts as sentences with the
 * people they name, never a JSON blob; who can do what as roles against the
 * areas of the product, in words, built from the grants themselves.
 */

const Link = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean | null }>(function Link(
  { prefetch: _prefetch, ...props },
  ref,
) {
  return <a ref={ref} {...props} />;
});

function Frame({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <ItsmProvider app="admin" Link={Link} router={router} usePathname={() => '/security'} useSearchParams={() => new URLSearchParams(search)} locale="en-GB" timeZone="Europe/London">
      {children}
    </ItsmProvider>
  );
}

beforeEach(() => {
  search = '';
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
const dialogWith = (words: string): Element | undefined => [...document.querySelectorAll('[role="dialog"]')].find((dialog) => text(dialog).includes(words));

const NOW = Date.parse('2026-09-30T12:00:00.000Z');
const ago = (days: number): string => new Date(NOW - days * 86_400_000).toISOString();
const ADA = 'a0000000-0000-4000-8000-000000000001';
const ALEX = 'a0000000-0000-4000-8000-000000000002';
const names = new Map([
  [ADA, 'Ada Lovelace'],
  [ALEX, 'Alex Admin'],
]);
const nameOf = (id: string): string | null => names.get(id) ?? null;

function alert(type: string, severity: string, details: unknown, createdAt = ago(1)): SecurityAlertRow {
  return { id: `${type}-${createdAt}`, type, severity, details, createdAt };
}

/* ======================================================================= */

describe('alerts in words', () => {
  it('titles every alert, known or not', () => {
    expect(security.alertTitle('auth.login.failed.burst')).toBe('Repeated failed sign-ins');
    expect(security.alertTitle('audit.chain.broken')).toBe('Audit trail chain broken');
    expect(security.alertTitle('data.export.unusual')).toBe('Data export unusual');
  });

  it('summarises an alert from its details, naming people', () => {
    expect(
      security.alertSummary(alert('auth.login.failed.burst', 'medium', { subject: 'sam@acme.test', ip: '203.0.113.9', attempts: 5, windowMinutes: 10 }), nameOf),
    ).toBe('5 failed attempts for sam@acme.test from 203.0.113.9 within 10 minutes');
    expect(security.alertSummary(alert('privilege.administrator.granted', 'high', { userId: ADA, grantedBy: ALEX, roleKey: 'administrator' }), nameOf)).toBe(
      'Alex Admin made Ada Lovelace an administrator',
    );
    expect(security.alertSummary(alert('privilege.administrator.granted', 'high', { userId: 'nobody' }), nameOf)).toBe('Someone the directory can’t name was made an administrator');
    expect(security.alertSummary(alert('attachment.infected', 'high', { filename: 'invoice.pdf', signature: 'Eicar-Test' }), nameOf)).toBe('“invoice.pdf” was held back · Eicar-Test');
    expect(security.alertSummary(alert('audit.chain.broken', 'critical', { brokenAt: { seq: '412', reason: 'x' }, checked: 5000 }), nameOf)).toBe(
      'The nightly check found the chain broken at #412 after checking 5,000 events',
    );
    expect(security.alertSummary(alert('something.new', 'low', { a: 1, b: 2 }), nameOf)).toBe('2 details recorded');
  });

  it('lays out the details in words, with people and roles named', () => {
    const details = security.alertDetails(alert('privilege.administrator.granted', 'high', { userId: ADA, grantedBy: 'unknown-id', roleKey: 'administrator' }), nameOf, new Map([['administrator', 'Administrator']]));
    expect(details).toEqual([
      { id: 'userId', label: 'Person', value: 'Ada Lovelace' },
      { id: 'grantedBy', label: 'Granted by', value: 'unknown-id', mono: true },
      { id: 'roleKey', label: 'Role', value: 'Administrator' },
    ]);
    expect(security.alertPeople([alert('privilege.administrator.granted', 'high', { userId: ADA, grantedBy: ALEX })])).toEqual([ADA, ALEX]);
    expect(security.brokenAtSeq(alert('audit.chain.broken', 'critical', { brokenAt: { seq: '412' } }))).toBe('412');
  });

  it('counts the week’s alerts by severity, most severe first', () => {
    const alerts = [alert('a', 'medium', {}), alert('b', 'high', {}), alert('c', 'medium', {}), alert('d', 'critical', {}, ago(9))];
    expect(security.alertSummaryLine(alerts, NOW)).toBe('1 high · 2 medium in the last 7 days');
    expect(security.alertSummaryLine([alert('d', 'critical', {}, ago(9))], NOW)).toBe('Nothing new in the last 7 days · 1 older alert still open');
    expect(security.alertSummaryLine([], NOW)).toBe('Nothing open');
    expect(security.sortAlerts(alerts).map((entry) => entry.type)).toEqual(['d', 'b', 'a', 'c']);
  });
});

/* ======================================================================= */

describe('the alerts page', () => {
  const rows = [
    {
      id: 'x1',
      severity: 'critical' as const,
      title: 'Audit trail chain broken',
      summary: 'The nightly check found the chain broken at #412',
      createdAt: ago(1),
      details: [{ id: 'brokenAt', label: 'Broken at', value: '#412 · previous hash does not match' }],
      auditHref: '/audit?cursor=413.abc&open=event:412',
    },
  ];

  it('says an empty list is good news', () => {
    render(
      <Frame>
        <AlertsView tabs={[]} rows={[]} summary="Nothing open" />
      </Frame>,
    );
    expect(text(document.body)).toContain('No open alerts');
    expect(document.querySelector('table')).toBeNull();
  });

  it('opens an alert with its details and a way to the broken event', () => {
    search = 'open=alert:x1';
    render(
      <Frame>
        <AlertsView tabs={[]} rows={rows} summary="1 critical in the last 7 days" />
      </Frame>,
    );
    expect(text(document.body)).toContain('1 critical in the last 7 days');
    const sheet = dialogWith('Broken at')!;
    expect(text(sheet)).toContain('#412 · previous hash does not match');
    expect(sheet.querySelector('a[href="/audit?cursor=413.abc&open=event:412"]')).not.toBeNull();
    // There is no acknowledge: the API has none.
    expect(text(sheet)).not.toContain('Acknowledge');
  });
});

/* ======================================================================= */

describe('who can do what', () => {
  const registry: PermissionRow[] = [
    { key: 'ticket.read', module: 'MOD-04', scopes: ['own', 'team', 'any'], description: 'Read tickets.' },
    { key: 'ticket.update', module: 'MOD-04', scopes: ['team', 'any'], description: 'Update tickets.' },
    { key: 'ticket.config.manage', module: 'MOD-04', scopes: ['any'], description: 'Manage ticket fields.' },
    { key: 'rules.rule.read', module: 'MOD-06', scopes: ['any'], description: 'Read rules.' },
    { key: 'rules.rule.manage', module: 'MOD-06', scopes: ['any'], description: 'Manage rules.' },
    { key: 'audit.export', module: 'MOD-15', scopes: ['any'], description: 'Export the audit trail.' },
  ];
  const role = (key: string, name: string, permissions: RoleRow['permissions']): RoleRow => ({ id: key, key, name, description: `${name}.`, isSystem: true, permissions });
  const roles = [
    role('requester', 'Requester', [
      { key: 'ticket.read', scope: 'own' },
      { key: 'identity.session.manage', scope: 'own' },
    ]),
    role('agent', 'Service desk agent', [
      { key: 'ticket.read', scope: 'team' },
      { key: 'ticket.update', scope: 'team' },
    ]),
    role('administrator', 'Administrator', [
      { key: 'ticket.read', scope: 'any' },
      { key: 'ticket.config.manage', scope: 'any' },
      { key: 'rules.rule.manage', scope: 'any' },
      { key: 'audit.export', scope: 'any' },
    ]),
  ];

  it('sorts permissions into the console’s areas and levels', () => {
    expect(security.areaOf('ticket.read')).toEqual({ id: 'tickets', label: 'Tickets' });
    expect(security.areaOf('workflow.operate').label).toBe('Rules & workflows');
    expect(security.areaOf('widget.thing').label).toBe('Widget');
    expect(security.levelOf('ticket.read')).toBe('read');
    expect(security.levelOf('audit.export')).toBe('read');
    expect(security.levelOf('ticket.comment.internal')).toBe('work');
    expect(security.levelOf('ticket.config.manage')).toBe('manage');
    expect(security.levelOf('approval.policy.read')).toBe('read');
  });

  it('puts roles against areas, the most each may do and how widely', () => {
    const matrix = security.roleMatrix(roles, registry);
    expect(matrix.areas.map((area) => area.label)).toEqual(['Tickets', 'Rules & workflows', 'People & access', 'Security & audit']);
    const words = (area: string, key: string): string => security.cellWords(matrix.cells[area]![key]!);
    expect(words('tickets', 'requester')).toBe('Read · their own');
    expect(words('tickets', 'agent')).toBe('Work · their teams');
    expect(words('tickets', 'administrator')).toBe('Manage');
    expect(words('automation', 'agent')).toBe('No access');
    // Managing only your own sessions is your own work, not managing the desk.
    expect(words('people', 'requester')).toBe('Work · their own');
    expect(matrix.cells.tickets!.administrator).toMatchObject({ held: 2, of: 3 });
    expect(matrix.roles.map((entry) => entry.count)).toEqual([2, 2, 4]);
  });

  it('lists the registry in words, with who holds each and whether you do', () => {
    const views = security.permissionViews(registry, roles, [
      { key: 'ticket.read', scope: 'team' },
      { key: 'ticket.read', scope: 'any' },
    ]);
    const read = views.find((view) => view.key === 'ticket.read')!;
    expect(read).toMatchObject({ label: 'Read tickets', description: 'Read tickets', areaLabel: 'Tickets', scopes: 'Their own, Their teams, Everything', held: true, you: 'Everything' });
    expect(read.roles).toEqual(['requester', 'agent', 'administrator']);
    expect(views.find((view) => view.key === 'audit.export')).toMatchObject({ held: false, you: null, levelLabel: 'Read' });
    expect(security.areaOptions(views).map((option) => option.label)).toEqual(['Tickets', 'Rules & workflows', 'Security & audit']);
  });

  it('draws the matrix without keys, and a role’s heading narrows the registry to it', () => {
    const replace = vi.spyOn(window.history, 'replaceState');
    const views = security.permissionViews(registry, roles, []);
    render(
      <Frame>
        <AccessView tabs={[]} matrix={security.roleMatrix(roles, registry)} permissions={views} areas={security.areaOptions(views)} />
      </Frame>,
    );
    const matrix = document.querySelector('.app-Matrix')!;
    expect(text(matrix)).toContain('Work · their teams');
    expect(text(matrix)).not.toContain('ticket.read');
    const heading = [...matrix.querySelectorAll('button')].find((button) => text(button).startsWith('Service desk agent'))!;
    expect(text(heading)).toContain('2 permissions');
    act(() => click(heading));
    expect(replace).toHaveBeenCalledWith(null, '', expect.stringContaining('role=agent'));
    // The registry names permissions; the technical key column is hidden unless keys are shown.
    expect(text(document.querySelector('table.itsm-DataTable__table'))).toContain('Manage ticket fields');
  });
});
