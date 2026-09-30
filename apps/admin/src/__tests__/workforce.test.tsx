// @vitest-environment jsdom
import { act, forwardRef, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

let search = '';
const router = { refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), forward: vi.fn() };
vi.mock('next/navigation', () => ({
  usePathname: () => '/workforce',
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(search),
}));

const setAvailability = vi.fn(async (input: { status: string }) => ({ userId: 'u', status: input.status, until: null }));
const addOverride = vi.fn(async (_key: string, input: { userId: string; startsAt: string; endsAt: string }) => ({ id: 'o9', ...input }));
const removeOverride = vi.fn(async () => undefined);
vi.mock('../client/api.js', () => ({
  api: { observe: { queues: { setAvailability, addOverride, removeOverride } }, tenant: { users: vi.fn(async () => []) } },
}));

const { ItsmProvider } = await import('@itsm/ui');
const { Toaster } = await import('@itsm/ui/overlays');
const { NowView } = await import('../components/workforce/NowView.js');
const { OnCallView } = await import('../components/workforce/OnCallView.js');
const { ShiftsView } = await import('../components/workforce/ShiftsView.js');
const workforce = await import('../components/workforce/presentation.js');
const { cleanupDocument, click, render, type } = await import('./support/render.js');

/**
 * Workforce (SPEC §6.1): what routing sees and how it is summed up, who may
 * change whose availability, the "away until" presets, rotas in words, the
 * status menu that changes a row at once with Undo, and the cover dialog.
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
      usePathname={() => '/workforce'}
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
const header = { tabs: [{ id: 'now', label: 'Now', href: '/workforce', match: 'exact' as const }] };

describe('availability in words', () => {
  const rows = [
    { effectiveStatus: 'available', capacity: 5 },
    { effectiveStatus: 'available', capacity: 3 },
    { effectiveStatus: 'busy', capacity: 5 },
    { effectiveStatus: 'away', capacity: 5 },
    { effectiveStatus: 'off_shift', capacity: 5 },
    { effectiveStatus: 'left', capacity: 5 },
  ];

  it('sums up what routing acts on: busy counts as away, and only the available count towards capacity', () => {
    const summary = workforce.summarise(rows);
    expect(summary).toEqual({ available: 2, away: 2, offline: 2, capacity: 8, onDefault: 0 });
    expect(workforce.summaryLine(summary)).toBe('2 available · 2 away · 2 offline · Capacity 8');
    // A capacity of null is the team's default, not nothing.
    const mixed = workforce.summarise([...rows, { effectiveStatus: 'available', capacity: null }]);
    expect(workforce.summaryLine(mixed)).toBe('3 available · 2 away · 2 offline · Capacity 8 + 1 on team defaults');
    expect(workforce.summaryLine(workforce.summarise([{ effectiveStatus: 'available', capacity: null }]))).toBe('1 available · 0 away · 0 offline · Capacity: team defaults');
    expect(workforce.summaryLine(workforce.summarise([{ effectiveStatus: 'away', capacity: 3 }]))).toBe('0 available · 1 away · 0 offline');
  });

  it('says when what somebody set has run out', () => {
    expect(workforce.statusNote({ status: 'away', effectiveStatus: 'available', until: '2026-09-30T13:00:00Z' }, 'en-GB', 'Europe/London')).toBe(
      'Set ‘Away’ until 14:00 — expired',
    );
    expect(workforce.statusNote({ status: 'away', effectiveStatus: 'away', until: null }, 'en-GB', 'Europe/London')).toBeNull();
  });

  it('lets a person change their own availability, and somebody else’s only at the any scope', () => {
    const own = { permissions: [{ key: 'workload.availability.set', scope: 'own' }] };
    const any = { permissions: [{ key: 'workload.availability.set', scope: 'any' }] };
    expect(workforce.maySetFor(own, true)).toBe(true);
    expect(workforce.maySetFor(own, false)).toBe(false);
    expect(workforce.maySetFor(any, false)).toBe(true);
    expect(workforce.maySetFor({ permissions: [{ key: 'workload.read', scope: 'any' }] }, true)).toBe(false);
  });

  it('offers "back at" times that are all in the future', () => {
    const morning = new Date(2026, 8, 30, 10, 0);
    const [hour, today, tomorrow] = workforce.untilPresets(morning);
    expect(hour!.at.getHours()).toBe(11);
    expect([today!.at.getHours(), today!.at.getMinutes()]).toEqual([18, 0]);
    expect([tomorrow!.at.getDate(), tomorrow!.at.getHours()]).toEqual([1, 9]);
    // After six, the end of today is midnight rather than a time already gone.
    const evening = workforce.untilPresets(new Date(2026, 8, 30, 18, 30));
    expect([evening[1]!.at.getHours(), evening[1]!.at.getMinutes()]).toEqual([23, 59]);
    expect(workforce.readLocalDateTime('2026-09-30T09:00', morning)).toBeNull();
    expect(workforce.readLocalDateTime('2026-09-30T12:00', morning)?.getHours()).toBe(12);
    expect(workforce.readLocalDateTime('soon', morning)).toBeNull();
    expect(workforce.toLocalInput(new Date(2026, 0, 2, 3, 4))).toBe('2026-01-02T03:04');
  });
});

describe('rotas and shifts in words', () => {
  it('says how a rota hands over, in its own zone', () => {
    expect(workforce.cadenceSentence({ cadence: 'weekly', handoverAt: '09:00', timeZone: 'Europe/London' }, '2026-10-05T08:00:00Z', 'en-GB')).toBe(
      'Weekly, hands over Mon 09:00 (Europe/London)',
    );
    expect(workforce.cadenceSentence({ cadence: 'daily', handoverAt: '08:30', timeZone: 'UTC' }, undefined, 'en-GB')).toBe('Daily, hands over at 08:30 (UTC)');
  });

  it('finds who has it now, whether they are covering, and the next different person', () => {
    const now = workforce.onCallNow({
      userId: 'a',
      via: 'override',
      upcoming: [
        { at: '2026-10-01T09:00:00Z', userId: 'a', covered: false },
        { at: '2026-10-08T09:00:00Z', userId: 'b', covered: false },
      ],
    });
    expect(now).toEqual({ userId: 'a', covering: true, next: { userId: 'b', at: '2026-10-08T09:00:00Z' } });
    expect(workforce.onCallNow(null)).toEqual({ userId: null, covering: false, next: null });
  });

  it('reads a shift pattern for the week strip and knows who is on it today', () => {
    expect(workforce.patternHours({ mon: [{ from: '09:00', to: '17:00' }], tue: 'x', wed: [{ start: '1' }] })).toEqual({ mon: [{ start: '09:00', end: '17:00' }] });
    const shift = {
      assignments: [
        { id: '1', userId: 'past', startsOn: '2026-01-01', endsOn: '2026-06-30' },
        { id: '2', userId: 'now', startsOn: '2026-09-01', endsOn: null },
        { id: '3', userId: 'soon', startsOn: '2026-11-01', endsOn: null },
      ],
    };
    expect(workforce.currentAssignees(shift, '2026-09-30')).toEqual(['now']);
    expect(workforce.assignmentSpan('2026-10-01', null, 'en-GB')).toBe('From 1 Oct 2026');
    expect(workforce.assignmentSpan('2026-10-01', '2026-12-31', 'en-GB')).toBe('1 Oct 2026 – 31 Dec 2026');
    expect(workforce.todayIn('UTC', new Date('2026-09-30T23:30:00Z'))).toBe('2026-09-30');
    expect(workforce.todayIn('Pacific/Auckland', new Date('2026-09-30T23:30:00Z'))).toBe('2026-10-01');
  });
});

/* ======================================================================= */

describe('Now', () => {
  const me = { id: '00000000-0000-4000-8000-000000000001', name: 'Alex Administrator' };
  const row = (userId: string, name: string, status: string, editable: boolean) => ({
    userId,
    person: { id: userId, name },
    status,
    effectiveStatus: status,
    reason: null,
    until: null,
    capacity: 5,
    source: 'manual',
    updatedAt: '2026-09-30T08:00:00Z',
    editable,
  });
  const rows = [row(me.id, 'Alex Administrator', 'available', true), row('00000000-0000-4000-8000-000000000002', 'Priya Agent', 'away', false)];

  it('sums up the desk, shows who is on call, and filters in place', () => {
    const { container } = render(
      <Frame>
        <NowView header={header} rows={rows} onCall={[{ name: 'Priya Agent' }]} me={me} canSetOwn />
      </Frame>,
    );
    expect(text(container.querySelector('.app-NowSummary__line'))).toBe('1 available · 1 away · 0 offline · Capacity 5');
    expect(container.querySelector('.app-NowSummary__onCall')).not.toBeNull();
    const away = [...container.querySelectorAll('[role="radio"]')].find((radio) => text(radio).startsWith('Away'))!;
    click(away);
    expect(text(container.querySelector('tbody'))).toContain('Priya Agent');
    expect(text(container.querySelector('tbody'))).not.toContain('Alex Administrator');
  });

  it('offers the status menu only on rows this person may change', () => {
    const { container } = render(
      <Frame>
        <NowView header={header} rows={rows} onCall={[]} me={me} canSetOwn />
      </Frame>,
    );
    const triggers = [...container.querySelectorAll('.app-NowStatus__trigger')];
    expect(triggers).toHaveLength(1);
    expect(triggers[0]!.getAttribute('aria-label')).toBe('Available. Change availability for Alex Administrator');
  });

  it('changes a row at once, saves it, and offers Undo that puts back what was there', async () => {
    const { container } = render(
      <Frame>
        <NowView header={header} rows={rows} onCall={[]} me={me} canSetOwn />
        <Toaster />
      </Frame>,
    );
    // Radix opens menus on pointerdown or from the keyboard.
    act(() => {
      container.querySelector('.app-NowStatus__trigger')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    const busy = [...document.querySelectorAll('[role="menuitem"]')].find((item) => text(item) === 'Busy') as HTMLElement | undefined;
    expect(busy).toBeDefined();
    await act(async () => {
      busy!.click();
    });
    expect(setAvailability).toHaveBeenCalledWith({ status: 'busy' });
    expect(text(container.querySelector('.app-NowSummary__line'))).toBe('0 available · 2 away · 0 offline');
    expect(router.refresh).toHaveBeenCalled();
    // The toast's Undo puts back what was there.
    let undo: HTMLButtonElement | undefined;
    await act(async () => {
      undo = await vi.waitFor(() => {
        const button = [...document.querySelectorAll('button')].find((candidate) => text(candidate) === 'Undo');
        if (!button) throw new Error('no Undo yet');
        return button;
      });
    });
    await act(async () => {
      undo!.click();
      // Let the toast settle inside the act scope.
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(setAvailability).toHaveBeenLastCalledWith({ status: 'available' });
  });

  it('sets my own availability from the header, with a reason and a time I choose', async () => {
    const { container } = render(
      <Frame>
        <NowView header={header} rows={rows} onCall={[]} me={me} canSetOwn />
      </Frame>,
    );
    click([...container.querySelectorAll('button')].find((button) => text(button) === 'Set my availability')!);
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(text(dialog.querySelector('h2'))).toBe('Set my availability');
    const until = dialog.querySelector('select') as HTMLSelectElement;
    act(() => {
      until.value = 'custom';
      until.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const when = dialog.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    type(when, '2020-01-01T09:00');
    await act(async () => {
      dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(setAvailability).not.toHaveBeenCalled();
    expect(text(dialog)).toContain('Choose a time in the future.');
    type(when, '2099-01-01T09:00');
    type([...dialog.querySelectorAll('input')].find((input) => input.getAttribute('maxlength') === '200') as HTMLInputElement, 'Dentist');
    await act(async () => {
      dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(setAvailability).toHaveBeenCalledWith({ status: 'away', until: new Date('2099-01-01T09:00').toISOString(), reason: 'Dentist' });
  });

  it('explains an empty desk', () => {
    const { container } = render(
      <Frame>
        <NowView header={header} rows={[]} onCall={[]} me={me} canSetOwn={false} />
      </Frame>,
    );
    expect(text(container)).toContain('Nobody has set their availability yet');
    expect(text(container)).toContain('Routing treats everyone as available.');
  });
});

describe('On call', () => {
  const rota = {
    key: 'infra',
    name: 'Infrastructure',
    teamName: 'Platform team',
    timeZone: 'Europe/London',
    cadence: 'weekly',
    handoverAt: '09:00',
    members: [
      { id: 'a', name: 'Ada' },
      { id: 'b', name: null },
    ],
    now: {
      person: { id: 'c', name: 'Cy' },
      covering: true,
      next: { person: { id: 'b', name: null }, at: '2026-10-05T08:00:00Z' },
      overrides: [{ id: 'o1', person: { id: 'c', name: 'Cy' }, startsAt: '2026-09-30T17:00:00Z', endsAt: '2026-10-01T08:00:00Z', reason: 'Swap' }],
    },
  };

  it('shows who has it now, that they are covering, who is next and the rota order', () => {
    const { container } = render(
      <Frame>
        <OnCallView header={header} rotas={[rota]} canCover={false} />
      </Frame>,
    );
    const card = container.querySelector('.app-RotaCard')!;
    expect(text(card)).toContain('Platform team · Weekly, hands over Mon 09:00 (Europe/London)');
    expect(text(card.querySelector('.app-RotaCard__name'))).toBe('Cy Covering');
    expect(text(card)).toContain('Next: Unknown person from Mon 09:00');
    expect([...card.querySelectorAll('.app-RotaCard__order li > span:last-child')].map((span) => text(span))).toEqual(['Ada', 'Unknown person']);
    // Read-only without the cover permission.
    expect([...card.querySelectorAll('button')].map((button) => text(button))).not.toContain('Cover a shift…');
  });

  it('adds cover from the dialog, checking the times first', async () => {
    const { container } = render(
      <Frame>
        <OnCallView header={header} rotas={[rota]} canCover />
      </Frame>,
    );
    click([...container.querySelectorAll('button')].find((button) => text(button) === 'Cover a shift…')!);
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(text(dialog.querySelector('h2'))).toBe('Cover Infrastructure');
    await act(async () => {
      dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(text(dialog)).toContain('Choose who covers.');
    expect(addOverride).not.toHaveBeenCalled();
  });

  it('removes cover with a named button', async () => {
    const { container } = render(
      <Frame>
        <OnCallView header={header} rotas={[rota]} canCover />
      </Frame>,
    );
    const remove = container.querySelector('button[aria-label^="Remove Cy’s cover"]') as HTMLButtonElement;
    expect(remove).not.toBeNull();
    await act(async () => {
      remove.click();
    });
    expect(removeOverride).toHaveBeenCalledWith('o1');
  });

  it('says when a desk has no rotas', () => {
    const { container } = render(
      <Frame>
        <OnCallView header={header} rotas={[]} canCover />
      </Frame>,
    );
    expect(text(container)).toContain('No on-call rotas');
  });
});

describe('Shifts', () => {
  it('lists each shift with its week and who is on it, and opens it in a drawer', () => {
    search = 'open=shift:early';
    const { container } = render(
      <Frame>
        <ShiftsView
          header={header}
          teams
          rows={[
            {
              key: 'early',
              name: 'Early',
              teamName: 'Service desk',
              timeZone: 'Europe/London',
              hours: { mon: [{ start: '07:00', end: '15:00' }] },
              people: [{ name: 'Ada' }],
              peopleCount: 1,
              assignments: [{ id: '1', person: { id: 'a', name: 'Ada' }, startsOn: '2026-09-01', endsOn: null, current: true }],
            },
          ]}
        />
      </Frame>,
    );
    expect(text(container.querySelector('tbody'))).toContain('Early');
    expect(text(container.querySelector('tbody'))).toContain('Service desk');
    expect(container.querySelector('tbody .app-WeekStrip')).not.toBeNull();
    const drawer = document.querySelector('[role="dialog"]')!;
    expect(text(drawer)).toContain('Ada');
    expect(text(drawer)).toContain('From 1 Sep');
    expect(text(drawer)).toContain('On it now');
  });
});
