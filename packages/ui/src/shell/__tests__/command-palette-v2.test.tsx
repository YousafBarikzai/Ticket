// @vitest-environment jsdom
import { act, useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { destroyAnnouncer, installAnnouncer } from '../../a11y/announcer.js';
import { TestProvider, testRouter } from '../../provider/__tests__/support/provider.js';
import { registerCommands, type CommandItem, type CommandProvider } from '../../provider/commands.js';
import { resetNotifications, subscribeToNotifications, type NotifyEvent } from '../../provider/notify.js';
import { resetRecentsForTesting } from '../../provider/recents.js';
import { CommandPalette, rankCommands } from '../../web/CommandPalette.js';
import { activeElement, cleanupDocument, click, press, render, settle, typeInto } from '../../web/__tests__/support/render.js';

vi.mock('../../overlays/Toaster.js', () => ({ Toaster: () => null }));

beforeEach(() => {
  window.localStorage.clear();
  resetRecentsForTesting();
  installAnnouncer(document);
});

afterEach(() => {
  cleanupDocument();
  destroyAnnouncer();
  resetNotifications();
  vi.useRealTimers();
});

const input = (): HTMLInputElement => document.querySelector<HTMLInputElement>('.itsm-CommandPalette__input')!;
const options = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[role="option"]')];
const labels = (): string[] => options().map((option) => option.querySelector('.itsm-CommandPalette__label')?.textContent ?? '');
const active = (): HTMLElement | undefined => options().find((option) => option.dataset.active === 'true');
const groups = (): string[] => [...document.querySelectorAll('[role="group"] > .itsm-CommandPalette__group')].map((heading) => heading.textContent ?? '');

function Palette({
  providers,
  fallback,
  router = testRouter(),
  onOpenChange,
}: {
  readonly providers: readonly CommandProvider[];
  readonly fallback?: (query: string) => CommandItem | null;
  readonly router?: ReturnType<typeof testRouter>;
  readonly onOpenChange?: (open: boolean) => void;
}): ReactNode {
  const [open, setOpen] = useState(true);
  return (
    <TestProvider router={router}>
      <button type="button" id="opener" onClick={() => setOpen(true)}>
        Open
      </button>
      <CommandPalette
        open={open}
        onOpenChange={(next) => {
          onOpenChange?.(next);
          setOpen(next);
        }}
        providers={providers}
        {...(fallback ? { fallback } : {})}
      />
    </TestProvider>
  );
}

const goTo: CommandProvider = {
  id: 'nav',
  group: 'Go to',
  items: [
    { id: 'rules', label: 'Rules', href: '/rules', icon: 'automation' },
    { id: 'workflows', label: 'Workflows', href: '/workflows', icon: 'workflow' },
    { id: 'settings', label: 'Settings', href: '/settings', icon: 'settings', keywords: ['configuration'] },
  ],
};

describe('CommandPalette v2: empty query', () => {
  it('shows Recent and Suggested (page commands) first, then the providers’ groups', async () => {
    window.localStorage.setItem('itsm-recents:admin', JSON.stringify([{ id: 'INC-000123', label: 'INC-000123 Printer jammed', href: '/tickets/123', kind: 'ticket' }]));
    const unregister = registerCommands([{ id: 'resolve', label: 'Resolve this ticket', run: () => undefined }]);
    render(<Palette providers={[goTo]} />);
    await settle();
    expect(groups()).toEqual(['Recent', 'Suggested', 'Go to']);
    expect(labels()).toEqual(['INC-000123 Printer jammed', 'Resolve this ticket', 'Rules', 'Workflows', 'Settings']);
    expect(active()?.textContent).toContain('INC-000123');
    act(() => unregister());
  });

  it('opens a recent item’s page through the app’s router', async () => {
    window.localStorage.setItem('itsm-recents:admin', JSON.stringify([{ id: 'r1', label: 'VIP requester', href: '/rules/vip', kind: 'rule' }]));
    const router = testRouter();
    render(<Palette providers={[goTo]} router={router} />);
    await settle();
    press(input(), 'Enter');
    expect(router.push).toHaveBeenCalledWith('/rules/vip');
    expect(document.querySelector('.itsm-CommandPalette')).toBeNull();
  });
});

describe('CommandPalette v2: searching', () => {
  it('ranks prefix matches first and falls back to fuzzy matching for typos', () => {
    const items = [{ label: 'Settings' }, { label: 'Service levels' }, { label: 'Workflows › Runs' }];
    expect(rankCommands(items, 'se').map((item) => item.label)).toEqual(['Settings', 'Service levels']);
    expect(rankCommands(items, 'sttngs').map((item) => item.label)).toEqual(['Settings']);
    expect(rankCommands(items, 'zzz')).toEqual([]);
  });

  it('runs async providers debounced, aborting the overtaken search, and keeps results while searching', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const search = vi.fn(async (query: string, signal: AbortSignal) => {
      signals.push(signal);
      return [{ id: `t-${query}`, label: `Ticket about ${query}`, href: `/tickets/${query}` }];
    });
    render(<Palette providers={[goTo, { id: 'tickets', group: 'Tickets', search, debounceMs: 150, minQuery: 2 }]} />);

    typeInto(input(), 'v');
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(search).not.toHaveBeenCalled();

    typeInto(input(), 'vp');
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    typeInto(input(), 'vpn');
    await act(async () => {
      vi.advanceTimersByTime(149);
    });
    expect(search).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('vpn', expect.any(AbortSignal));
    expect(groups()).toEqual(['Tickets']);
    expect(labels()).toEqual(['Ticket about vpn']);

    // Typing on: the last results stay while the next search runs.
    typeInto(input(), 'vpn2');
    expect(labels()).toEqual(['Ticket about vpn']);
    expect(document.querySelector('.itsm-CommandPalette__status')?.textContent).toBe('Searching…');
    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    expect(labels()).toEqual(['Ticket about vpn2']);
    expect(signals[0]!.aborted).toBe(true);
  });

  it('pins a provider whose pattern recognises the query ("INC-123")', async () => {
    vi.useFakeTimers();
    const tickets: CommandProvider = {
      id: 'tickets',
      group: 'Tickets',
      match: /^(INC|REQ)-?\d+$/i,
      search: async (query) => [{ id: 'open', label: `Open ${query.toUpperCase()}`, href: '/tickets/123' }],
    };
    const other: CommandProvider = { id: 'nav', group: 'Go to', items: [{ id: 'inc', label: 'Incidents inc-123 report', href: '/x' }] };
    render(<Palette providers={[other, tickets]} />);
    typeInto(input(), 'inc-123');
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(groups()).toEqual(['Tickets', 'Go to']);
    expect(active()?.textContent).toContain('Open INC-123');
  });

  it('says so when a search fails, and keeps the rest usable', async () => {
    vi.useFakeTimers();
    render(<Palette providers={[goTo, { id: 'people', group: 'People', search: async () => Promise.reject(new Error('503')) }]} />);
    typeInto(input(), 'rul');
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(labels()).toEqual(['Rules']);
    expect(document.querySelector('.itsm-CommandPalette__status')?.textContent).toBe('Couldn’t search people just now.');
  });
});

describe('CommandPalette v2: nested pages', () => {
  const assign: CommandProvider = {
    id: 'ticket',
    group: 'This ticket',
    items: [
      {
        id: 'assign',
        label: 'Assign to…',
        children: async () => [
          { id: 'jo', label: 'Jo Resolver', run: vi.fn() },
          { id: 'ada', label: 'Ada Lovelace', run: vi.fn() },
        ],
      },
      { id: 'resolve', label: 'Resolve…', run: vi.fn() },
    ],
  };

  it('opens a page of commands with a chip for where it is, filters it, and goes back with Backspace', async () => {
    render(<Palette providers={[assign]} />);
    press(input(), 'Enter');
    await settle();
    expect(document.querySelector('.itsm-CommandPalette__crumb')?.textContent).toBe('Assign to');
    expect(labels()).toEqual(['Jo Resolver', 'Ada Lovelace']);
    expect(input().getAttribute('aria-label')).toBe('Command palette: Assign to');
    expect(activeElement()).toBe(input());

    typeInto(input(), 'ada');
    expect(labels()).toEqual(['Ada Lovelace']);
    typeInto(input(), '');
    press(input(), 'Backspace');
    expect(document.querySelector('.itsm-CommandPalette__crumb')).toBeNull();
    expect(labels()).toEqual(['Assign to…', 'Resolve…']);
  });

  it('goes back a level with Escape, and closes from the top', async () => {
    const onOpenChange = vi.fn();
    render(<Palette providers={[assign]} onOpenChange={onOpenChange} />);
    press(input(), 'Enter');
    await settle();
    press(input(), 'Escape');
    expect(document.querySelector('.itsm-CommandPalette')).not.toBeNull();
    expect(labels()).toEqual(['Assign to…', 'Resolve…']);
    press(input(), 'Escape');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(document.querySelector('.itsm-CommandPalette')).toBeNull();
  });

  it('runs a command from the page and closes', async () => {
    render(<Palette providers={[assign]} />);
    press(input(), 'Enter');
    await settle();
    press(input(), 'ArrowDown');
    expect(active()?.textContent).toContain('Ada Lovelace');
    press(input(), 'Enter');
    expect(document.querySelector('.itsm-CommandPalette')).toBeNull();
  });
});

describe('CommandPalette v2: no results', () => {
  it('shows "No matching commands" and an actionable fallback row', async () => {
    const router = testRouter();
    render(
      <Palette
        providers={[goTo]}
        router={router}
        fallback={(query) => ({ id: 'search-tickets', label: `Search tickets for ‘${query}’`, icon: 'search', href: `/tickets?q=${encodeURIComponent(query)}` })}
      />,
    );
    typeInto(input(), 'printer');
    expect(document.querySelector('.itsm-CommandPalette__empty')?.textContent).toBe('No matching commands');
    expect(labels()).toEqual(['Search tickets for ‘printer’']);
    expect(input().getAttribute('aria-activedescendant')).toBe(active()?.id);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(document.querySelector('[data-itsm-live-region="polite"]')?.textContent).toBe('No matching commands. Search tickets for ‘printer’');
    press(input(), 'Enter');
    expect(router.push).toHaveBeenCalledWith('/tickets?q=printer');
  });
});

describe('CommandPalette v2: choosing', () => {
  it('opens a destination in a new tab with ⌘Enter / Ctrl Enter', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<Palette providers={[goTo]} />);
    press(input(), 'Enter', { ctrlKey: true });
    expect(open).toHaveBeenCalledWith('/rules', '_blank', 'noopener,noreferrer');
    open.mockRestore();
  });

  it('returns focus to where it was when it closes', () => {
    function Harness(): ReactNode {
      const [open, setOpen] = useState(false);
      return (
        <TestProvider>
          <button type="button" id="opener" onClick={() => setOpen(true)}>
            Open
          </button>
          <CommandPalette open={open} onOpenChange={setOpen} providers={[goTo]} />
        </TestProvider>
      );
    }
    render(<Harness />);
    const opener = document.getElementById('opener')!;
    act(() => opener.focus());
    click(opener);
    expect(activeElement()).toBe(input());
    press(input(), 'Escape');
    expect(activeElement()).toBe(opener);
  });

  it('reports a command that fails, rather than failing silently', async () => {
    const events: NotifyEvent[] = [];
    const unsubscribe = subscribeToNotifications((event) => events.push(event));
    render(<Palette providers={[{ id: 'a', group: 'Actions', items: [{ id: 'x', label: 'Copy link', run: () => Promise.reject(new Error('nope')) }] }]} />);
    press(input(), 'Enter');
    await settle();
    expect(document.querySelector('.itsm-CommandPalette')).toBeNull();
    expect(events).toContainEqual(expect.objectContaining({ type: 'show', message: 'Couldn’t copy link', options: expect.objectContaining({ tone: 'danger' }) }));
    unsubscribe();
  });
});
