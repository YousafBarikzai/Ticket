// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Ticket } from '@itsm/sdk';
import type { CommandItem } from '@itsm/ui';
import { defaultPrefs } from '@itsm/ui/theme';
import {
  TICKET_NUMBER_PATTERN,
  deskCommandProviders,
  searchFallback,
  ticketNumbersFor,
  type DeskPaletteDeps,
} from '../client/palette.js';
import { DeskHotkeys } from '../components/DeskShell.js';
import { VIEWS } from '../inbox/views.js';
import { cleanupDocument, render } from './support/render.js';

/**
 * The keyboard map's frame keys and the palette registry (SPEC §5.5, §5.6).
 *
 * The rules that matter are the ones a person relies on without looking:
 * `g` then a letter goes to a view, `c` raises a ticket, `/` finds, none of
 * them fire while typing, and ⌘K never dead-ends.
 */

afterEach(() => {
  cleanupDocument();
  localStorage.clear();
});

function press(key: string, target: Element = document.activeElement ?? document.body): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function mountHotkeys(overrides: Partial<Parameters<typeof DeskHotkeys>[0]> = {}) {
  const props = {
    canReadTickets: true,
    canCreate: true,
    navigate: vi.fn(),
    openNewTicket: vi.fn(),
    openSearch: vi.fn(),
    ...overrides,
  };
  render(<DeskHotkeys {...props} />);
  return props;
}

describe('the frame’s keys', () => {
  it('goes to each view with g and its letter (SPEC §5.6)', () => {
    const { navigate } = mountHotkeys();
    const letters: Record<string, string> = { m: '/inbox/mine', u: '/inbox/unassigned', d: '/inbox/due', w: '/inbox/waiting', a: '/inbox/all', r: '/inbox/resolved' };
    for (const [letter, path] of Object.entries(letters)) {
      press('g');
      press(letter);
      expect(navigate).toHaveBeenLastCalledWith(path);
    }
    expect(navigate).toHaveBeenCalledTimes(6);
  });

  it('opens the new-ticket sheet with c, only for someone who can raise one', () => {
    const allowed = mountHotkeys();
    press('c');
    expect(allowed.openNewTicket).toHaveBeenCalledTimes(1);
    cleanupDocument();
    const refused = mountHotkeys({ canCreate: false });
    press('c');
    expect(refused.openNewTicket).not.toHaveBeenCalled();
  });

  it('never fires while the person is typing', () => {
    const { navigate, openNewTicket } = mountHotkeys();
    const field = document.createElement('input');
    document.body.append(field);
    field.focus();
    press('c', field);
    press('g', field);
    press('m', field);
    expect(openNewTicket).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('focuses the page’s own search with /, or opens the palette when there is none', () => {
    const { openSearch } = mountHotkeys();
    press('/');
    expect(openSearch).toHaveBeenCalledTimes(1);

    const main = document.createElement('main');
    const search = Object.assign(document.createElement('input'), { type: 'search' });
    main.append(search);
    document.body.append(main);
    press('/');
    expect(document.activeElement).toBe(search);
    expect(openSearch).toHaveBeenCalledTimes(1);
  });

  it('has no view keys without ticket.read', () => {
    const { navigate } = mountHotkeys({ canReadTickets: false });
    press('g');
    press('m');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('keeps every chord distinct and clear of the workspace’s single keys', () => {
    const chords = VIEWS.map((view) => view.shortcut);
    expect(new Set(chords).size).toBe(chords.length);
    for (const chord of chords) expect(chord).toMatch(/^g [a-z]$/);
  });
});

function deps(overrides: Partial<DeskPaletteDeps> = {}): DeskPaletteDeps {
  return {
    canReadTickets: true,
    canSearch: true,
    canCreate: true,
    canSetAvailability: true,
    canReadPeople: true,
    teams: [{ id: '9b2c1a40-1111-4a2b-8c3d-0123456789ab', name: 'Network' }],
    prefs: defaultPrefs,
    setPrefs: vi.fn(),
    openNewTicket: vi.fn(),
    openShortcuts: vi.fn(),
    signOut: vi.fn(),
    setAvailability: vi.fn(),
    searchTickets: vi.fn(async () => [{ number: 'INC-000042', title: 'VPN keeps dropping', type: 'incident', status: 'in_progress' } as Ticket]),
    searchPeople: vi.fn(async () => [{ id: 'u1', displayName: 'Ada Lovelace', email: 'ada@example.com' }]),
    ...overrides,
  };
}

function items(providers: ReturnType<typeof deskCommandProviders>, id: string): readonly CommandItem[] {
  return providers.find((provider) => provider.id === id)?.items ?? [];
}

describe('the palette (SPEC §5.5)', () => {
  it('lists the views with their chords, then the teams, under Go to', () => {
    const goTo = items(deskCommandProviders(deps()), 'go');
    expect(goTo.slice(0, 6).map((item) => [item.label, item.shortcut, item.href])).toEqual(
      VIEWS.map((view) => [view.label, view.shortcut, `/inbox/${view.id}`]),
    );
    expect(goTo[6]).toMatchObject({ label: 'Network', href: '/inbox/team/9b2c1a40-1111-4a2b-8c3d-0123456789ab' });
  });

  it('offers creating, preferences and help, each doing what it says', () => {
    const d = deps();
    const providers = deskCommandProviders(d);
    items(providers, 'create')[0]!.run!();
    expect(d.openNewTicket).toHaveBeenCalled();
    const preferences = items(providers, 'preferences');
    preferences.find((item) => item.id === 'pref:appearance:dark')!.run!();
    expect(d.setPrefs).toHaveBeenCalledWith({ appearance: 'dark' });
    preferences.find((item) => item.id === 'pref:density')!.run!();
    expect(d.setPrefs).toHaveBeenCalledWith({ density: 'compact' });
    preferences.find((item) => item.id === 'pref:shortcuts')!.run!();
    expect(d.setPrefs).toHaveBeenCalledWith({ shortcuts: 'off' });
    const help = items(providers, 'help');
    expect(help.map((item) => item.label)).toEqual(['Keyboard shortcuts', 'Sign out']);
  });

  it('sets availability from a nested page', async () => {
    const d = deps();
    const availability = items(deskCommandProviders(d), 'preferences').find((item) => item.id === 'pref:availability')!;
    const choices = await availability.children!();
    expect(choices.map((item) => item.label)).toEqual(['Available', 'Busy', 'Away', 'Off shift']);
    choices[2]!.run!();
    expect(d.setAvailability).toHaveBeenCalledWith('away');
  });

  it('leaves out what the person cannot do', () => {
    const providers = deskCommandProviders(
      deps({ canCreate: false, canSearch: false, canReadPeople: false, canSetAvailability: false }),
    );
    const ids = providers.map((provider) => provider.id);
    expect(ids).not.toContain('create');
    expect(ids).not.toContain('tickets');
    expect(ids).not.toContain('people');
    expect(items(providers, 'preferences').some((item) => item.id === 'pref:availability')).toBe(false);
    expect(deskCommandProviders(deps({ canReadTickets: false })).map((provider) => provider.id)).toEqual(['create', 'preferences', 'help']);
  });

  it('pins "Open INC-000123" for a ticket number, however it is typed', async () => {
    expect(ticketNumbersFor('INC-123')).toEqual(['INC-000123']);
    expect(ticketNumbersFor('req 45')).toEqual(['REQ-000045']);
    expect(ticketNumbersFor('#7')).toEqual(['INC-000007', 'REQ-000007', 'QNA-000007']);
    expect(ticketNumbersFor('vpn')).toEqual([]);
    expect(TICKET_NUMBER_PATTERN.test('INC-123')).toBe(true);

    const number = deskCommandProviders(deps()).find((provider) => provider.id === 'number')!;
    const found = await number.search!('inc-123', new AbortController().signal);
    expect(found).toEqual([expect.objectContaining({ label: 'Open INC-000123', href: '/tickets/INC-000123' })]);
  });

  it('searches tickets and people, and always offers the whole result', async () => {
    const d = deps();
    const providers = deskCommandProviders(d);
    const tickets = await providers.find((provider) => provider.id === 'tickets')!.search!('vpn', new AbortController().signal);
    expect(tickets.map((item) => item.label)).toEqual(['VPN keeps dropping', 'See all tickets matching ‘vpn’']);
    expect(tickets[0]).toMatchObject({ href: '/tickets/INC-000042', meta: 'In progress' });
    expect(tickets[1]!.href).toBe('/inbox/all?q=vpn');
    const people = await providers.find((provider) => provider.id === 'people')!.search!('ada', new AbortController().signal);
    expect(people[0]).toMatchObject({ label: 'Tickets from Ada Lovelace', href: '/inbox/all?requester=u1' });
  });

  it('never dead-ends: "Search tickets for x" when nothing matches (F23)', () => {
    expect(searchFallback('  printer  ', true)).toMatchObject({ label: 'Search tickets for ‘printer’', href: '/inbox/all?q=printer' });
    expect(searchFallback('printer', false)).toBeNull();
    expect(searchFallback('   ', true)).toBeNull();
  });
});
