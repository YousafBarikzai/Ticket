// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, forwardRef, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PriorityMatrixRow } from '@itsm/sdk';
import { structuralVariables, themeVariables } from '@itsm/ui/tokens';

vi.mock('server-only', () => ({}));

let search = '';
const router = { refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), forward: vi.fn() };
vi.mock('next/navigation', () => ({
  usePathname: () => '/sla',
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(search),
}));

const setPriorityMatrix = vi.fn(async (rows: readonly PriorityMatrixRow[]) => rows);
const setTargets = vi.fn(async () => ({}));
const createPolicy = vi.fn(async (input: Record<string, unknown>) => ({ id: 'p9', ...input }));
const createCalendar = vi.fn(async (input: Record<string, unknown>) => ({ id: 'c9', ...input }));
vi.mock('../client/api.js', () => ({
  api: { configure: { sla: { setPriorityMatrix, setTargets, createPolicy, createCalendar } } },
}));

const { ItsmProvider } = await import('@itsm/ui');
const { MatrixEditor } = await import('../components/sla/MatrixEditor.js');
const { HeatGrid } = await import('../components/sla/HeatGrid.js');
const { PoliciesView } = await import('../components/sla/PoliciesView.js');
const { NewCalendarSheet } = await import('../components/sla/NewCalendarSheet.js');
const { mapServerErrors, rankSentence } = await import('../components/sla/NewPolicySheet.js');
const sla = await import('../components/sla/presentation.js');
const { completeMatrix, matrixValue } = await import('../matrix.js');
const { cleanupDocument, click, clickAsync, render, type } = await import('./support/render.js');

/**
 * Service levels (SPEC §6.1; F26, F30): the words a policy reads as, the
 * targets grid that never turns a typo into sixty minutes, the priority
 * matrix that sends all nine cells and resyncs, and the confirmation that
 * stands between "Create" and a policy going live.
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
      usePathname={() => '/sla'}
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

function key(element: Element, name: string): void {
  act(() => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
  });
}

/* ======================================================================= */

describe('a policy in words', () => {
  it('describes what it applies to as a sentence, and refuses to simplify what it cannot draw', () => {
    expect(sla.describeConditions({ always: true })).toBe('Every ticket');
    expect(sla.describeConditions(undefined)).toBe('Every ticket');
    expect(sla.describeConditions({ eq: [{ var: 'ticket.priority' }, 'P1'] })).toBe('Priority is P1 · Critical');
    expect(sla.describeConditions({ and: [{ eq: [{ var: 'ticket.type' }, 'incident'] }, { eq: [{ var: 'ticket.sourceChannel' }, 'email'] }] })).toBe(
      'Type is Incident and Channel is Email',
    );
    expect(sla.describeConditions({ or: [{ eq: [{ var: 'ticket.impact' }, 'high'] }, { eq: [{ var: 'ticket.urgency' }, 'high'] }] })).toBe(
      'Impact is High or Urgency is High',
    );
    expect(sla.describeConditions({ not: { eq: [{ var: 'ticket.type' }, 'incident'] } })).toBe('Custom conditions');
  });

  it('says whose hours the clock runs on, including the seeded "policy" mode and a missing calendar', () => {
    const calendars = [{ id: 'c1', name: 'UK office hours' }];
    expect(sla.describeClock({ calendarMode: 'group', calendarId: null }, calendars)).toBe('Team’s calendar');
    expect(sla.describeClock({ calendarMode: 'group', calendarId: 'c1' }, calendars)).toBe('Team’s calendar, else UK office hours');
    expect(sla.describeClock({ calendarMode: 'fixed', calendarId: 'c1' }, calendars)).toBe('Fixed · UK office hours');
    expect(sla.describeClock({ calendarMode: 'policy', calendarId: 'c1' }, calendars)).toBe('Fixed · UK office hours');
    expect(sla.describeClock({ calendarMode: 'policy', calendarId: null }, calendars)).toBe('Around the clock');
    expect(sla.describeClock({ calendarMode: 'fixed', calendarId: 'gone' }, calendars)).toBe('Fixed · a calendar that no longer exists');
  });

  it('orders policies as the clock checks them and says where a new one would sit', () => {
    const policies = [
      { name: 'Default', specificity: 0 },
      { name: 'VIP', specificity: 50 },
      { name: 'Email', specificity: 10 },
    ];
    expect(sla.inEvaluationOrder(policies).map((policy) => policy.name)).toEqual(['VIP', 'Email', 'Default']);
    expect(sla.rankAgainst(10, policies)).toEqual({ above: ['VIP'], below: ['Default'], tied: ['Email'] });
    expect(rankSentence(sla.rankAgainst(20, policies))).toBe('Checked after VIP and before Email and Default.');
    expect(rankSentence(sla.rankAgainst(10, policies))).toContain('Ties with Email');
    expect(sla.autoSpecificity({ always: true })).toBe(0);
    expect(sla.autoSpecificity({ and: [{ eq: [{ var: 'ticket.type' }, 'incident'] }, { eq: [{ var: 'ticket.priority' }, 'P1'] }] })).toBe(20);
  });

  it('shows a live policy as Live', () => {
    expect(sla.policyState('published')).toEqual({ label: 'Live', tone: 'success' });
    expect(sla.policyState('draft').label).toBe('Draft');
  });
});

describe('durations and targets (F26)', () => {
  it('reads what the field reads, and calls anything else invalid — never sixty minutes', () => {
    expect(sla.readDuration('')).toBeNull();
    expect(sla.readDuration('90')).toBe(90);
    expect(sla.readDuration('4h')).toBe(240);
    expect(sla.readDuration('1h 30m')).toBe(90);
    expect(sla.readDuration('1:30')).toBe(90);
    expect(sla.readDuration('0')).toBe('invalid');
    expect(sla.readDuration('-5')).toBe('invalid');
    expect(sla.readDuration('abc')).toBe('invalid');
    expect(sla.readDuration('2 weeks')).toBe('invalid');
    // Business time is written in hours: a "day" of office hours is not a day.
    expect(sla.readDuration('1d')).toBe('invalid');
    expect(sla.readDuration('600000')).toBe('invalid');
  });

  it('writes targets in business hours and minutes', () => {
    expect(sla.formatTarget(1440)).toBe('24 h');
    expect(sla.formatTarget(90)).toBe('1 h 30 min');
    expect(sla.formatTarget(15)).toBe('15 min');
  });

  it('turns the grid into exactly the filled cells, with each column’s thresholds, and back', () => {
    const stored = [
      { priority: 'P1', targetType: 'response', minutes: 15, warningThresholds: [50, 75, 90] },
      { priority: 'P1', targetType: 'resolution', minutes: 240, warningThresholds: [80] },
      { priority: 'P3', targetType: 'resolution', minutes: 1440, warningThresholds: [80] },
    ];
    const model = sla.targetsModel(stored);
    expect(model.types).toEqual(['response', 'resolution']);
    const back = sla.targetsFrom(model);
    expect(back).toEqual([
      { priority: 'P1', targetType: 'response', minutes: 15, warningThresholds: [50, 75, 90] },
      { priority: 'P1', targetType: 'resolution', minutes: 240, warningThresholds: [80] },
      { priority: 'P3', targetType: 'resolution', minutes: 1440, warningThresholds: [80] },
    ]);
    // An empty policy starts with the two promises most desks make.
    expect(sla.targetsModel([]).types).toEqual(['response', 'resolution']);
  });

  it('counts each cell added, removed or changed, and each column whose thresholds changed', () => {
    const before = sla.targetsModel([{ priority: 'P1', targetType: 'response', minutes: 15, warningThresholds: [50, 75, 90] }]);
    const cells = { ...before.cells, 'P2:response': 60 };
    delete (cells as Record<string, number>)['P1:response'];
    expect(sla.targetChanges(before, { ...before, cells })).toBe(2);
    expect(sla.targetChanges(before, { ...before, cells: { 'P1:response': 30 } })).toBe(1);
    expect(sla.targetChanges(before, { ...before, thresholds: { response: [80] } })).toBe(1);
    expect(sla.targetChanges(before, before)).toBe(0);
    // Text typed into a cell that does not read as a duration is a change, counted once.
    expect(sla.targetChanges(before, before, new Set(['P2:response']))).toBe(1);
    expect(sla.targetChanges(before, { ...before, cells: {} }, new Set(['P1:response']))).toBe(1);
  });

  it('reads warning thresholds as the API allows them', () => {
    expect(sla.readThresholds('90, 50, 75, 50')).toEqual({ value: [50, 75, 90] });
    expect(sla.readThresholds('80%')).toEqual({ value: [80] });
    expect(sla.readThresholds('')).toEqual({ value: [] });
    expect('error' in sla.readThresholds('0, 50')).toBe(true);
    expect('error' in sla.readThresholds('100')).toBe(true);
    expect('error' in sla.readThresholds('10, 20, 30, 40, 50, 60')).toBe(true);
    expect('error' in sla.readThresholds('half')).toBe(true);
  });
});

describe('calendars', () => {
  it('reads hours by the clock’s day keys and ignores anything else', () => {
    expect(sla.weekFrom({ mon: [{ start: '09:00', end: '17:30' }], monday: [{ start: '01:00', end: '02:00' }], tue: 'closed' })).toEqual({
      mon: [{ start: '09:00', end: '17:30' }],
    });
    expect(sla.openDaysSummary({})).toBe('Closed every day');
    const always = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => [day, [{ start: '00:00', end: '24:00' }]]));
    expect(sla.openDaysSummary(always)).toBe('Open around the clock');
    expect(sla.openDaysSummary({ mon: [{ start: '09:00', end: '17:00' }] })).toBe('Open 1 day a week');
  });

  it('checks holidays: a date for each, no date twice, sorted', () => {
    expect(
      sla.holidaysFrom([
        { id: 'a', date: '2026-12-26', name: 'Boxing Day' },
        { id: 'b', date: '2026-12-25', name: '' },
        { id: 'c', date: null, name: '' },
      ]),
    ).toEqual({
      value: [
        { date: '2026-12-25', type: 'holiday' },
        { date: '2026-12-26', type: 'holiday', name: 'Boxing Day' },
      ],
    });
    expect(sla.holidaysFrom([{ id: 'a', date: null, name: 'Christmas' }])).toEqual({ error: 'Choose a date for “Christmas”.' });
    expect('error' in sla.holidaysFrom([{ id: 'a', date: '2026-12-25', name: '' }, { id: 'b', date: '2026-12-25', name: '' }])).toBe(true);
  });

  it('offers the browser’s own time zone first', () => {
    const zones = sla.timeZones('Europe/London');
    expect(zones[0]).toBe('Europe/London');
    expect(zones).toContain('UTC');
    expect(zones.filter((zone) => zone === 'Europe/London')).toHaveLength(1);
  });

  it('saves a new calendar with the clock’s day keys (never "monday") and its holidays', async () => {
    render(
      <Frame>
        <NewCalendarSheet open onClose={() => undefined} calendars={[]} />
      </Frame>,
    );
    const dialog = document.querySelector('[role="dialog"]')!;
    type(dialog.querySelector('input[name="name"]') as HTMLInputElement, 'Leeds office');
    const form = dialog.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(createCalendar).toHaveBeenCalledTimes(1);
    const sent = createCalendar.mock.calls[0]![0] as { key: string; hours: Record<string, unknown>; isDefault: boolean; exceptions: unknown[] };
    expect(sent.key).toBe('leeds-office');
    expect(Object.keys(sent.hours)).toEqual(['mon', 'tue', 'wed', 'thu', 'fri']);
    // The first calendar a desk makes is its default.
    expect(sent.isDefault).toBe(true);
    expect(sent.exceptions).toEqual([]);
  });

  it('refuses a calendar with no open hours, and says why', async () => {
    render(
      <Frame>
        <NewCalendarSheet open onClose={() => undefined} calendars={[]} />
      </Frame>,
    );
    const dialog = document.querySelector('[role="dialog"]')!;
    type(dialog.querySelector('input[name="name"]') as HTMLInputElement, 'Never');
    for (const toggle of [...dialog.querySelectorAll('[role="switch"][aria-checked="true"]')].filter((element) => element.closest('.app-WeekHours'))) {
      click(toggle);
    }
    await act(async () => {
      dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(createCalendar).not.toHaveBeenCalled();
    expect(text(dialog)).toContain('Open at least one day');
  });
});

/* ======================================================================= */

describe('the priority matrix (F30)', () => {
  const stored = completeMatrix([]);

  function editor(rows: readonly PriorityMatrixRow[] = stored, canManage = true) {
    return render(
      <Frame>
        <MatrixEditor rows={rows} canManage={canManage} />
      </Frame>,
    );
  }

  const cell = (container: Element, label: RegExp): HTMLButtonElement =>
    [...container.querySelectorAll<HTMLButtonElement>('[role="gridcell"] button')].find((button) => label.test(button.getAttribute('aria-label') ?? ''))!;

  it('is a grid with visible, title-cased axes and a P chip with words in each cell', () => {
    const { container } = editor();
    const grid = container.querySelector('[role="grid"]')!;
    expect(grid).not.toBeNull();
    expect(text(container.querySelector('.app-HeatGrid__axis--rows'))).toBe('Impact');
    expect(text(container.querySelector('.app-HeatGrid__axis--columns'))).toBe('Urgency');
    expect([...grid.querySelectorAll('th[scope="col"]')].map((th) => text(th))).toEqual(['Urgency High', 'Urgency Medium', 'Urgency Low']);
    expect(grid.querySelectorAll('[role="gridcell"]')).toHaveLength(9);
    expect(cell(container, /^Impact High, urgency High/).getAttribute('aria-label')).toBe('Impact High, urgency High: P1 · Critical');
    // One tab stop.
    expect(grid.querySelectorAll('button[tabindex="0"]')).toHaveLength(1);
  });

  it('moves between cells with the arrow keys and sets the focused cell with 1–4', () => {
    const { container } = editor();
    const first = cell(container, /^Impact High, urgency High/);
    act(() => first.focus());
    key(first, 'ArrowRight');
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^Impact High, urgency Medium/);
    key(document.activeElement!, 'ArrowDown');
    key(document.activeElement!, 'End');
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^Impact Medium, urgency Low/);
    key(document.activeElement!, '1');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Impact Medium, urgency Low: P1 · Critical, changed');
    expect(text(container.querySelector('.app-SlaDirty__count'))).toBe('1 unsaved change');
  });

  it('sends all nine cells after the confirmation, and keeps a draft to discard', async () => {
    const { container } = editor();
    const target = cell(container, /^Impact Low, urgency High/);
    act(() => target.focus());
    key(target, '2');
    click(buttonNamed(container, 'Save matrix')!);
    const confirm = document.querySelector('[role="dialog"], [role="alertdialog"]')!;
    expect(text(confirm)).toContain('Existing priorities don’t change');
    await clickAsync(buttonNamed(confirm, 'Save matrix')!);
    expect(setPriorityMatrix).toHaveBeenCalledTimes(1);
    const sent = setPriorityMatrix.mock.calls[0]![0];
    expect(sent).toHaveLength(9);
    expect(new Set(sent.map((row) => `${row.impact}:${row.urgency}`)).size).toBe(9);
    expect(matrixValue(sent, 'low', 'high')).toBe('P2');
    expect(router.refresh).toHaveBeenCalled();
  });

  it('resyncs from what the server sends after a refresh (the old grid never did)', () => {
    const { container, root } = editor();
    const target = cell(container, /^Impact Low, urgency Low/);
    act(() => target.focus());
    key(target, '1');
    expect(container.querySelector('.app-SlaDirty')).not.toBeNull();
    const fromServer = completeMatrix([]).map((row) => (row.impact === 'high' && row.urgency === 'low' ? { ...row, priority: 'P2' as const } : row));
    act(() => {
      root.render(
        <Frame>
          <MatrixEditor rows={fromServer} canManage />
        </Frame>,
      );
    });
    expect(cell(container, /^Impact High, urgency Low/).getAttribute('aria-label')).toBe('Impact High, urgency Low: P2 · High');
    expect(cell(container, /^Impact Low, urgency Low/).getAttribute('aria-label')).toBe('Impact Low, urgency Low: P4 · Low');
    expect(container.querySelector('.app-SlaDirty')).toBeNull();
  });

  it('resets to the recommendation into the draft only, and discards back to what is saved', () => {
    const odd = completeMatrix([]).map((row) => ({ ...row, priority: 'P1' as const }));
    const { container } = editor(odd);
    click(buttonNamed(container, 'Reset to recommended')!);
    expect(text(container.querySelector('.app-SlaDirty__count'))).toBe('8 unsaved changes');
    expect(setPriorityMatrix).not.toHaveBeenCalled();
    click(buttonNamed(container, 'Discard')!);
    expect(container.querySelector('.app-SlaDirty')).toBeNull();
    expect(cell(container, /^Impact Low, urgency Low/).getAttribute('aria-label')).toBe('Impact Low, urgency Low: P1 · Critical');
  });

  it('is read-only for a view-only person: no grid role, no buttons, the same words', () => {
    const { container } = editor(stored, false);
    expect(container.querySelector('[role="grid"]')).toBeNull();
    expect(container.querySelectorAll('.app-HeatGrid button')).toHaveLength(0);
    expect(text(container.querySelector('.app-HeatGrid__table tbody td'))).toBe('P1Critical');
    expect(buttonNamed(container, 'Reset to recommended')).toBeUndefined();
  });

  it('keeps shortcuts inside the grid: a 1 typed anywhere else changes nothing', () => {
    const changes = vi.fn();
    render(
      <Frame>
        <input aria-label="elsewhere" />
        <HeatGrid
          label="Grid"
          rows={{ label: 'Impact', values: [{ id: 'high', label: 'High' }] }}
          columns={{ label: 'Urgency', values: [{ id: 'high', label: 'High' }] }}
          options={[{ value: 'P1', label: 'P1', tone: 'danger', shortcut: '1' }]}
          value={() => 'P1'}
          onChange={changes}
        />
      </Frame>,
    );
    key(document.querySelector('input[aria-label="elsewhere"]')!, '1');
    expect(changes).not.toHaveBeenCalled();
  });
});

/* ======================================================================= */

describe('policies', () => {
  const header = { tabs: [{ id: 'policies', label: 'Policies', href: '/sla', match: 'exact' as const }] };
  const calendars = [{ id: 'c1', key: 'uk-office', name: 'UK office hours', timeZone: 'Europe/London', isDefault: true }];
  const policy = {
    id: 'p1',
    key: 'default',
    name: 'Default',
    status: 'published',
    specificity: 0,
    calendarMode: 'fixed',
    calendarId: 'c1',
    version: 1,
    match: { always: true },
    targets: [
      { priority: 'P1', targetType: 'response', minutes: 15, warningThresholds: [50, 75, 90] },
      { priority: 'P1', targetType: 'resolution', minutes: 240, warningThresholds: [50, 75, 90] },
    ],
  };

  it('shows cards in evaluation order with what each applies to, its clock and a targets matrix', () => {
    const { container } = render(
      <Frame>
        <PoliciesView header={header} policies={[policy, { ...policy, id: 'p2', key: 'vip', name: 'VIP tickets', specificity: 50 }]} calendars={calendars} canManage={false} />
      </Frame>,
    );
    const cards = [...container.querySelectorAll('.app-PolicyCard')];
    expect(cards.map((card) => text(card.querySelector('h2')))).toEqual(['VIP tickets', 'Default']);
    expect(text(cards[1])).toContain('Every ticket');
    expect(text(cards[1])).toContain('Fixed · UK office hours');
    expect(text(cards[1]!.querySelector('.app-MiniMatrix'))).toContain('15 min');
    expect(text(cards[1]!.querySelector('.app-MiniMatrix'))).toContain('4 h');
    expect(text(container)).toContain('The most specific matching policy applies');
    // View only: no New policy.
    expect(buttonNamed(container, 'New policy')).toBeUndefined();
  });

  it('says what an empty desk promises', () => {
    const { container } = render(
      <Frame>
        <PoliciesView header={header} policies={[]} calendars={[]} canManage />
      </Frame>,
    );
    expect(text(container)).toContain('No promises yet');
    expect(text(container)).toContain('Tickets won’t have SLA clocks until a policy exists.');
  });

  it('edits targets in the drawer, refuses to save a cell that is not a duration, then saves every target after confirming', async () => {
    search = 'open=policy:default';
    render(
      <Frame>
        <PoliciesView header={header} policies={[policy]} calendars={calendars} canManage />
      </Frame>,
    );
    const drawer = document.querySelector('[role="dialog"]')!;
    const p2Response = drawer.querySelector('input[aria-label^="P2 response target"]') as HTMLInputElement;
    type(p2Response, 'soon');
    const save = buttonNamed(drawer, 'Save targets')!;
    expect(save.getAttribute('aria-disabled')).toBe('true');
    expect(text(drawer)).toContain('1 change');
    type(p2Response, '1h');
    expect(buttonNamed(drawer, 'Save targets')!.getAttribute('aria-disabled')).toBeNull();
    click(buttonNamed(drawer, 'Save targets')!);
    const confirm = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].find((element) => text(element).includes('timers started from now'))!;
    await clickAsync(buttonNamed(confirm, 'Save targets')!);
    expect(setTargets).toHaveBeenCalledWith('default', [
      { priority: 'P1', targetType: 'response', minutes: 15, warningThresholds: [50, 75, 90] },
      { priority: 'P1', targetType: 'resolution', minutes: 240, warningThresholds: [50, 75, 90] },
      { priority: 'P2', targetType: 'response', minutes: 60, warningThresholds: [50, 75, 90] },
    ]);
  });

  it('never goes live silently: Create and publish asks first, then sends the policy', async () => {
    search = 'new=1';
    render(
      <Frame>
        <PoliciesView header={header} policies={[policy]} calendars={calendars} canManage />
      </Frame>,
    );
    const sheet = [...document.querySelectorAll('[role="dialog"]')].find((element) => text(element.querySelector('h2')) === 'New policy')!;
    type(sheet.querySelector('input[name="name"]') as HTMLInputElement, 'Major incidents');
    type(sheet.querySelector('input[aria-label^="P1 response target"]') as HTMLInputElement, '15m');
    await act(async () => {
      sheet.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(createPolicy).not.toHaveBeenCalled();
    const confirm = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].find((element) => text(element).includes('starts applying to new tickets immediately'))!;
    expect(text(confirm)).toContain('It matches every ticket');
    await clickAsync(buttonNamed(confirm, 'Create and publish')!);
    expect(createPolicy).toHaveBeenCalledWith({
      key: 'major-incidents',
      name: 'Major incidents',
      match: { always: true },
      specificity: 0,
      calendarMode: 'group',
      calendarId: null,
      targets: [{ priority: 'P1', targetType: 'response', minutes: 15, warningThresholds: [50, 75, 90] }],
    });
  });

  it('refuses a policy without a name or any target, and names both', async () => {
    search = 'new=1';
    render(
      <Frame>
        <PoliciesView header={header} policies={[]} calendars={calendars} canManage />
      </Frame>,
    );
    const sheet = [...document.querySelectorAll('[role="dialog"]')].find((element) => text(element.querySelector('h2')) === 'New policy')!;
    await act(async () => {
      sheet.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(text(sheet)).toContain('Enter a name for the policy.');
    expect(text(sheet)).toContain('Set at least one target');
    expect(createPolicy).not.toHaveBeenCalled();
  });

  it('folds the API’s field paths onto the sections that own them', () => {
    expect(mapServerErrors({ 'targets.0.minutes': 'Too long', key: 'Taken', calendarMode: 'Bad' })).toEqual({ targets: 'Too long', key: 'Taken', calendarId: 'Bad' });
  });
});

/* ======================================================================= */

describe('the pages’ stylesheet', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const defined = new Set([...Object.keys(structuralVariables()), ...Object.keys(themeVariables('apple'))]);
  const sheets = ['sla/sla.css', 'tickets/tickets.css', 'workforce/workforce.css'].map((path) => ({
    path,
    css: readFileSync(join(here, '..', 'components', path), 'utf8'),
  }));

  it('spends only custom properties the design system emits', () => {
    for (const { path, css } of sheets) {
      const used = [...new Set([...css.matchAll(/var\((--itsm-[a-zA-Z0-9-]+)/g)].map((match) => match[1]!))];
      expect(used.length, path).toBeGreaterThan(3);
      expect(used.filter((variable) => !defined.has(variable)), path).toEqual([]);
    }
  });

  it('declares only app- classes', () => {
    for (const { path, css } of sheets) {
      for (const line of css.split('\n').filter((entry) => /^\.[a-zA-Z]/.test(entry.trim()))) {
        expect(line.trim().startsWith('.app-'), `${path}: ${line}`).toBe(true);
      }
    }
  });
});
