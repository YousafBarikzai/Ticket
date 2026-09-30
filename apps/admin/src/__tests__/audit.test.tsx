// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, forwardRef, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Admin, AuditEventRow, Me } from '@itsm/sdk';
import { structuralVariables, themeVariables } from '@itsm/ui/tokens';

vi.mock('server-only', () => ({}));

let search = '';
const router = { refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), forward: vi.fn() };
vi.mock('next/navigation', () => ({
  usePathname: () => '/audit',
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(search),
}));

const auditEvents = vi.fn(async (_filter: unknown) => ({ data: [] as AuditEventRow[], nextCursor: null as string | null }));
const users = vi.fn(async () => []);
vi.mock('../client/api.js', () => ({ api: { observe: { auditEvents }, tenant: { users } } }));

const { ItsmProvider } = await import('@itsm/ui');
const audit = await import('../components/audit/presentation.js');
const { AuditView } = await import('../components/audit/AuditView.js');
const { auditRows, payloadLabel } = await import('../app/(console)/(admin)/audit/data.js');
const { cleanupDocument, clickAsync, render } = await import('./support/render.js');

/**
 * Audit log (SPEC §6.1 `/audit`, B §3.17, D13, F32): filters that mean what
 * the API does, a cursor that belongs to its filters, Older/Newer from a
 * cursor stack, sentences with names instead of ids, an honest sequence
 * check — and before/after only ever for the one event whose drawer is open.
 */

const Link = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean | null }>(function Link(
  { prefetch: _prefetch, ...props },
  ref,
) {
  return <a ref={ref} {...props} />;
});

function Frame({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <ItsmProvider app="admin" Link={Link} router={router} usePathname={() => '/audit'} useSearchParams={() => new URLSearchParams(search)} locale="en-GB" timeZone="Europe/London">
      {children}
    </ItsmProvider>
  );
}

beforeEach(() => {
  search = '';
  window.sessionStorage.clear();
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

async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

const ALEX = 'a0000000-0000-4000-8000-000000000001';
const SAM = 'a0000000-0000-4000-8000-000000000002';
const RULE = 'b0000000-0000-4000-8000-000000000003';

function event(seq: number, extra: Partial<AuditEventRow> = {}): AuditEventRow {
  return {
    id: `e${seq}`,
    seq: String(seq),
    action: 'rule.published',
    actorType: 'user',
    actorId: ALEX,
    targetType: 'business_rule',
    targetId: RULE,
    before: { status: 'draft', secretNote: 'before-payload' },
    after: { status: 'published', secretNote: 'after-payload' },
    reason: null,
    correlationId: `req-${seq}`,
    occurredAt: '2026-09-30T13:05:00.000Z',
    ...extra,
  };
}

const me = {
  actor: { type: 'user', id: ALEX, displayName: 'Alex Admin' },
  tenant: { id: 't', name: 'Acme', slug: 'acme', region: 'eu' },
  permissions: ['audit.read', 'rules.rule.read', 'identity.user.read', 'identity.org.read'].map((key) => ({ key, scope: 'any' })),
  organisations: [],
  teamIds: [],
  locale: 'en-GB',
  timeZone: 'Europe/London',
} satisfies Me;

function fakeApi(): Admin {
  return {
    tenant: {
      users: async ({ ids }: { ids?: readonly string[] }) =>
        [
          { id: ALEX, email: 'alex@acme.test', displayName: 'Alex Admin', status: 'active', primaryOrgId: null, isExternal: false },
          { id: SAM, email: 'sam@acme.test', displayName: 'Sam Lee', status: 'active', primaryOrgId: null, isExternal: false },
        ].filter((row) => !ids || ids.includes(row.id)),
      teams: async () => [],
      organisations: async () => [],
    },
    configure: { rules: { list: async () => [{ id: RULE, key: 'vip-requester', name: 'VIP requester' }] } },
  } as unknown as Admin;
}

/* ======================================================================= */

describe('the query string', () => {
  it('keeps what the API accepts and drops the rest', () => {
    expect(audit.readAuditQuery({ action: 'Rule.', actor: 'not-a-uuid', targetType: 'business_rule', targetId: 'x', when: '2026-09-30..2026-09-01' })).toEqual({
      action: 'rule.',
      targetType: 'business_rule',
      targetId: 'x',
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(audit.readAuditQuery({ action: 'DROP TABLE', when: 'yesterday' })).toEqual({});
    expect(audit.readAuditQuery({ actor: ALEX.toUpperCase() }).actor).toBe(ALEX);
  });

  it('honours a cursor only for the filters it was made for', () => {
    const filters = { action: 'rule.' };
    const cursor = audit.cursorParam('412', filters);
    expect(audit.readAuditQuery({ action: 'rule.', cursor }).cursor).toBe('412');
    // The same cursor after the filter changed would start the new list in the middle: ignored.
    expect(audit.readAuditQuery({ action: 'ticket.', cursor }).cursor).toBeUndefined();
    expect(audit.readAuditQuery({ cursor: '412' }).cursor).toBeUndefined();
    expect(audit.pageHref('/audit', filters, '412')).toBe(`/audit?action=rule.&cursor=${encodeURIComponent(cursor)}`);
    expect(audit.pageHref('/audit', {}, null)).toBe('/audit');
  });

  it('turns days into instants on the reader’s clock, including across British Summer Time', () => {
    const filter = audit.auditFilter({ from: '2026-09-30', to: '2026-09-30', actor: SAM }, 'Europe/London');
    expect(filter).toMatchObject({ limit: 100, actorId: SAM, from: '2026-09-29T23:00:00.000Z', to: '2026-09-30T22:59:59.999Z' });
    const winter = audit.auditFilter({ from: '2026-12-01' }, 'Europe/London');
    expect(winter.from).toBe('2026-12-01T00:00:00.000Z');
    expect(audit.cursorAt('412')).toBe('413');
  });
});

describe('the cursor stack', () => {
  it('pushes older pages, cuts back on newer, and knows nothing about a pasted link', () => {
    let stack = audit.stepStack([], null);
    expect(stack).toEqual([null]);
    stack = audit.stepStack(stack, '300');
    stack = audit.stepStack(stack, '200');
    expect(stack).toEqual([null, '300', '200']);
    expect(audit.newerCursor(stack, '200')).toBe('300');
    expect(audit.newerCursor(stack, '300')).toBeNull();
    stack = audit.stepStack(stack, '300');
    expect(stack).toEqual([null, '300']);
    expect(audit.newerCursor(audit.stepStack([], '200'), '200')).toBeUndefined();
    expect(audit.newerCursor([null], null)).toBeUndefined();
  });
});

describe('events as sentences', () => {
  it('opens each event in words', () => {
    expect(audit.actionOpening('rule.published', 'business_rule')).toEqual({ opening: 'Published rule', standalone: false });
    expect(audit.actionOpening('ticket.comment.added', 'ticket').opening).toBe('Commented on ticket');
    expect(audit.actionOpening('ticket.field.updated', 'field_definition').opening).toBe('Changed ticket field');
    expect(audit.actionOpening('sla.matrix.changed', 'priority_matrix')).toEqual({ opening: 'Changed the priority matrix', standalone: true });
    expect(audit.actionOpening('weird', 'thing').opening).toBe('Weird on thing');
    expect(audit.sentenceOf('Archived', false, null, 'error_queue_item')).toBe('Archived a failed delivery');
    expect(audit.sentenceOf('Retired', false, null, 'asset')).toBe('Retired an asset');
    // A noun the opening already carries takes an article instead of being said twice.
    expect(audit.sentenceOf('Created asset', false, null, 'asset')).toBe('Created an asset');
    expect(audit.sentenceOf('Cancelled workflow run', false, null, 'workflow_run')).toBe('Cancelled a workflow run');
    expect(audit.sentenceOf('Commented on ticket', false, null, 'ticket')).toBe('Commented on a ticket');
    expect(audit.sentenceOf('Commented on ticket', false, { label: 'INC-1' }, 'ticket')).toBe('Commented on ticket INC-1');
    expect(audit.actorWords('system')).toBe('The platform');
    expect(audit.actionLabel('rule.')).toBe('Rule — every event');
  });

  it('offers what was typed as a prefix, then known actions', () => {
    const options = audit.actionOptions('rule.pub');
    expect(options[0]).toEqual({ value: 'rule.pub', label: 'Starts with “rule.pub”' });
    expect(options.map((option) => option.value)).toContain('rule.published');
    expect(audit.actionOptions('rule.published')[0]!.value).toBe('rule.published');
  });

  it('labels a target from its own record: a ticket by number, never by title', () => {
    expect(payloadLabel({ targetType: 'ticket', before: null, after: { number: 'INC-000123', title: 'Payroll for Sam is wrong' } })).toBe('INC-000123');
    expect(payloadLabel({ targetType: 'ticket', before: null, after: { title: 'Payroll' } })).toBeNull();
    expect(payloadLabel({ targetType: 'team', before: null, after: { key: 'network-team', name: 'Network Team' } })).toBe('Network Team');
  });

  it('names people and targets, links where the reader may go, and carries no before or after', async () => {
    const rows = await auditRows(
      me,
      fakeApi(),
      [event(412), event(411, { action: 'user.deactivated', targetType: 'user', targetId: SAM, reason: 'Left' }), event(410, { actorType: 'system', actorId: null, action: 'team.created', targetType: 'team', targetId: 'tm', after: { name: 'Network Team' } })],
      new Date('2026-09-30T15:00:00Z'),
    );
    expect(rows[0]).toMatchObject({ seq: '412', actorName: 'Alex Admin', sentence: 'Published rule VIP requester', target: { label: 'VIP requester', href: '/rules/vip-requester' }, dayLabel: 'Today', timeLabel: '14:05' });
    expect(rows[1]).toMatchObject({ sentence: 'Deactivated Sam Lee', reason: 'Left' });
    expect(rows[2]).toMatchObject({ actorName: 'The platform', sentence: 'Created team Network Team' });
    const wire = JSON.stringify(rows);
    expect(wire).not.toContain('before-payload');
    expect(wire).not.toContain('after-payload');
    for (const row of rows) {
      expect(row).not.toHaveProperty('before');
      expect(row).not.toHaveProperty('after');
    }
  });

  it('heads days as a person reads them', () => {
    expect(audit.dayLabel('2026-09-30', '2026-09-30', 'en-GB')).toBe('Today');
    expect(audit.dayLabel('2026-09-29', '2026-09-30', 'en-GB')).toBe('Yesterday');
    expect(audit.dayLabel('2026-09-28', '2026-09-30', 'en-GB')).toBe('Monday 28 September');
    expect(audit.dayLabel('2025-12-24', '2026-09-30', 'en-GB')).toBe('Wednesday 24 December 2025');
    expect(audit.dayKeyOf('2026-09-30T23:30:00Z', 'Europe/London')).toBe('2026-10-01');
  });
});

describe('the sequence check', () => {
  it('is calm about gaps — the numbers are shared across workspaces — and warns only on order', () => {
    expect(audit.sequenceCheck(['423', '420', '301'])).toEqual({ state: 'ok', text: 'In sequence on this page · #301 to #423' });
    expect(audit.sequenceCheck(['5'])).toEqual({ state: 'ok', text: 'In sequence · #5' });
    expect(audit.sequenceCheck(['420', '423'])).toEqual({ state: 'warning', text: 'Out of order: #423 is listed after #420' });
    expect(audit.sequenceCheck(['420', '420'])?.state).toBe('warning');
    expect(audit.sequenceCheck([])).toBeNull();
  });
});

describe('export page', () => {
  it('writes the visible rows as a spreadsheet opens them, without before or after, formulas defused', async () => {
    const rows = await auditRows(me, fakeApi(), [event(412, { reason: '=HYPERLINK("x")' })], new Date('2026-09-30T15:00:00Z'));
    const csv = audit.auditCsv(rows);
    expect(csv.startsWith('﻿"Sequence","When (UTC)"')).toBe(true);
    expect(csv).toContain('\r\n"412","2026-09-30T13:05:00.000Z","Alex Admin"');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).not.toContain('payload');
    expect(audit.csvFileName('Acmé Group', '2026-09-30', '412')).toBe('audit-log-acme-group-2026-09-30-from-412.csv');
  });
});

/* ======================================================================= */

describe('the audit log page', () => {
  async function rowsFor(events: AuditEventRow[]) {
    return auditRows(me, fakeApi(), events, new Date('2026-09-30T15:00:00Z'));
  }

  it('shows a day-grouped timeline with names, the sequence check and Older with its signed cursor', async () => {
    const rows = await rowsFor([event(412), event(411)]);
    const { container } = render(
      <Frame>
        <AuditView rows={rows} query={{}} nextCursor="411" canExport chain={[]} workspace="acme" today="2026-09-30" />
      </Frame>,
    );
    await settle();
    expect(text(container)).toContain('Today');
    expect(text(container)).toContain('Alex Admin');
    expect(text(container)).toContain('Published rule VIP requester');
    expect(text(container)).toContain('In sequence on this page · #411 to #412');
    expect(text(container)).toContain('No break reported by the nightly chain check');
    expect(text(container)).not.toContain(ALEX);
    const older = [...container.querySelectorAll('a')].find((link) => text(link) === 'Older')!;
    expect(older.getAttribute('href')).toBe(`/audit?cursor=${encodeURIComponent(audit.cursorParam('411', {}))}`);
    // The first page: Newer has nowhere to go.
    expect([...container.querySelectorAll('button')].find((button) => text(button) === 'Newer')?.hasAttribute('disabled')).toBe(true);
  });

  it('finds Newer in the tab’s cursor stack', async () => {
    window.sessionStorage.setItem(audit.stackKey({}), JSON.stringify([null, '500']));
    const rows = await rowsFor([event(412)]);
    const { container } = render(
      <Frame>
        <AuditView rows={rows} query={{ cursor: '413' }} nextCursor={null} canExport={false} chain={null} workspace="acme" today="2026-09-30" />
      </Frame>,
    );
    await settle();
    const newer = [...container.querySelectorAll('a')].find((link) => text(link) === 'Newer')!;
    expect(newer.getAttribute('href')).toBe(`/audit?cursor=${encodeURIComponent(audit.cursorParam('500', {}))}`);
    expect([...container.querySelectorAll('a')].find((link) => text(link) === 'Newest')?.getAttribute('href')).toBe('/audit');
    expect(JSON.parse(window.sessionStorage.getItem(audit.stackKey({}))!)).toEqual([null, '500', '413']);
    // With filters, or someone who cannot read alerts, the check says nothing about the chain.
    expect(text(container)).not.toContain('nightly chain check');
  });

  it('opens an event by asking for that one event only, and diffs its before and after', async () => {
    auditEvents.mockResolvedValueOnce({ data: [event(412)], nextCursor: null });
    const rows = await rowsFor([event(412)]);
    search = 'open=event:412';
    render(
      <Frame>
        <AuditView rows={rows} query={{}} nextCursor={null} canExport chain={[]} workspace="acme" today="2026-09-30" />
      </Frame>,
    );
    await settle(10);
    expect(auditEvents).toHaveBeenCalledWith({ cursor: '413', limit: 1 });
    const sheet = dialogWith('What changed')!;
    expect(text(sheet)).toContain('Published rule VIP requester');
    expect(text(sheet)).toContain('req-412');
    expect(text(sheet)).toContain('before-payload');
    expect(text(sheet)).toContain('after-payload');
    expect(sheet.querySelector('a[href="/rules/vip-requester"]')).not.toBeNull();
  });

  it('uses the server’s copy on a hard load, and says so when an event is not in the log', async () => {
    const rows = await rowsFor([event(412)]);
    search = 'open=event:412';
    render(
      <Frame>
        <AuditView
          rows={rows}
          query={{}}
          nextCursor={null}
          canExport
          chain={[]}
          workspace="acme"
          today="2026-09-30"
          initialEvent={{ row: rows[0]!, change: { seq: '412', before: null, after: { status: 'published' } } }}
        />
      </Frame>,
    );
    await settle(10);
    expect(auditEvents).not.toHaveBeenCalled();
    // A creation has nothing before it: what it recorded, not a diff against null.
    expect(text(dialogWith('What changed'))).toContain('Nothing existed before this event');
    expect(text(dialogWith('What changed'))).toContain('published');
    expect(text(dialogWith('What changed'))).not.toContain('Removed');
    cleanupDocument();
    search = 'open=event:999';
    render(
      <Frame>
        <AuditView rows={rows} query={{}} nextCursor={null} canExport chain={[]} workspace="acme" today="2026-09-30" />
      </Frame>,
    );
    await settle(10);
    expect(text(document.body)).toContain('That event isn’t in this workspace’s log');
  });

  it('puts a chain break first, with a way to the event', async () => {
    const rows = await rowsFor([event(412)]);
    render(
      <Frame>
        <AuditView rows={rows} query={{}} nextCursor={null} canExport chain={[{ alertId: 'x', seq: '300', createdAt: '2026-09-30T02:00:00Z', createdLabel: '30 Sept 2026, 03:00' }]} workspace="acme" today="2026-09-30" />
      </Frame>,
    );
    await settle();
    expect(text(document.body)).toContain('The audit chain is broken at #300');
    expect(document.querySelector(`a[href="/audit?cursor=${encodeURIComponent(audit.cursorParam('301', {}))}&open=event:300"]`)).not.toBeNull();
  });

  it('exports the page as CSV when the person may', async () => {
    const created: Blob[] = [];
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: (blob: Blob) => (created.push(blob), 'blob:x'), revokeObjectURL: () => undefined }));
    const rows = await rowsFor([event(412)]);
    const { container } = render(
      <Frame>
        <AuditView rows={rows} query={{}} nextCursor={null} canExport chain={null} workspace="acme" today="2026-09-30" />
      </Frame>,
    );
    await clickAsync([...container.querySelectorAll('button')].find((button) => text(button) === 'Export page')!);
    expect(created).toHaveLength(1);
    const csv = await created[0]!.text();
    expect(csv).toContain('Published rule VIP requester');
    expect(csv).not.toContain('before-payload');
  });
});

/* ======================================================================= */

describe('the People, Security and Audit stylesheets', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const defined = new Set([...Object.keys(structuralVariables()), ...Object.keys(themeVariables('apple'))]);
  const sheets = ['people/people.css', 'security/security.css', 'audit/audit.css'].map((path) => ({ path, css: readFileSync(join(here, '..', 'components', path), 'utf8') }));

  it('spend only custom properties the design system emits', () => {
    for (const { path, css } of sheets) {
      const used = [...new Set([...css.matchAll(/var\((--itsm-[a-zA-Z0-9-]+)/g)].map((match) => match[1]!))];
      expect(used.length, path).toBeGreaterThan(3);
      expect(used.filter((variable) => !defined.has(variable)), path).toEqual([]);
    }
  });

  it('declare only app- classes', () => {
    for (const { path, css } of sheets) {
      for (const line of css.split('\n').filter((entry) => /^\.[a-zA-Z]/.test(entry.trim()))) {
        expect(line.trim().startsWith('.app-'), `${path}: ${line}`).toBe(true);
      }
    }
  });
});
