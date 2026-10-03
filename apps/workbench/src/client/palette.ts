import type { AvailabilityStatus, Ticket } from '@itsm/sdk';
import type { CommandItem, CommandProvider } from '@itsm/ui';
import type { Prefs } from '@itsm/ui/theme';
import { stateLabel, typeLabel } from '../inbox/presentation.js';
import { VIEWS, viewKey, viewPath, type TeamSummary } from '../inbox/views.js';
import type { DeskDestination } from '../navigation.js';

/**
 * The workbench's command palette (SPEC §5.5): what ⌘K offers.
 *
 * Groups, in the order they are listed on an empty query: Go to (the
 * Overview, the views with their `g` chords, the person's teams, and the
 * Board once it ships), Create, Switch area (v3 §3.9, A2 §10.3), Preferences,
 * Help. As
 * the person types, three searches join them — ticket numbers ("INC-123" is
 * pinned first as "Open INC-000123"), tickets by text, and people ("Tickets
 * from Ada") — and when nothing at all matches, the fallback row "Search
 * tickets for 'x'" goes to All open filtered by the words, so the palette is
 * never a dead end (F23). The "This ticket" group is registered by the ticket
 * workspace while one is open (`useRegisterCommands`).
 *
 * Built from injected functions rather than from the SDK and the router
 * directly, so the whole registry is testable as data. The places and the
 * areas arrive as data the server built (`navigation.ts`): this module is
 * also read by the frame's first load, so it imports nothing of the area
 * contracts itself.
 */

/** Availability as the pill and the palette offer it; `left` is a manager's decision, not a menu item. */
export const AVAILABILITY_CHOICES = [
  { value: 'available', label: 'Available' },
  { value: 'busy', label: 'Busy' },
  { value: 'away', label: 'Away' },
  { value: 'off_shift', label: 'Off shift' },
] as const satisfies readonly { value: AvailabilityStatus; label: string }[];

export type AvailabilityChoice = (typeof AVAILABILITY_CHOICES)[number]['value'];

export interface PersonHit {
  readonly id: string;
  readonly displayName: string;
  readonly email?: string;
}

export interface DeskPaletteDeps {
  readonly canReadTickets: boolean;
  readonly canSearch: boolean;
  readonly canCreate: boolean;
  readonly canSetAvailability: boolean;
  readonly canReadPeople: boolean;
  readonly teams: readonly TeamSummary[];
  /** The Overview and, once it ships, the Board (`deskDestinations`); a pending place is not in the list. */
  readonly destinations?: readonly DeskDestination[];
  /** "Switch to {area}" for each other area, and in a demo the site's home (`switchAreaCommands`). */
  readonly switchArea?: readonly CommandItem[];
  readonly prefs: Prefs;
  setPrefs(patch: Partial<Prefs>): void;
  openNewTicket(): void;
  openShortcuts(): void;
  signOut(): void;
  setAvailability(status: AvailabilityChoice): void;
  searchTickets(query: string, signal: AbortSignal): Promise<readonly Ticket[]>;
  searchPeople(query: string, signal: AbortSignal): Promise<readonly PersonHit[]>;
}

/** The ticket types the desk numbers, in the order a bare number is guessed at. */
const NUMBER_PREFIXES = ['INC', 'REQ', 'QNA', 'PRB', 'CHG', 'TSK'] as const;
/** The types worth offering for a bare number: the ones the workbench raises. */
const BARE_NUMBER_GUESSES = ['INC', 'REQ', 'QNA'] as const;

/** `INC-123`, `inc 123`, `INC123`, or a bare `123`. */
export const TICKET_NUMBER_PATTERN = /^(?:(INC|REQ|QNA|PRB|CHG|TSK)[\s-]?)?#?(\d{1,9})$/i;

/**
 * The ticket numbers a query could mean, written the way the API numbers
 * them (six digits, zero-padded): `inc-123` → `INC-000123`; a bare `123` →
 * an incident, a request and a question, because the prefix is the type and
 * the person did not say.
 */
export function ticketNumbersFor(query: string): string[] {
  const match = TICKET_NUMBER_PATTERN.exec(query.trim());
  if (!match) return [];
  const digits = match[2]!.padStart(6, '0');
  const prefix = match[1]?.toUpperCase() as (typeof NUMBER_PREFIXES)[number] | undefined;
  return (prefix ? [prefix] : [...BARE_NUMBER_GUESSES]).map((type) => `${type}-${digits}`);
}

export function ticketHref(number: string): string {
  return `/tickets/${encodeURIComponent(number)}`;
}

/** "Search tickets for 'vpn'": All open, filtered by the words. */
export function searchAllHref(query: string): string {
  return `/inbox/all?q=${encodeURIComponent(query.trim().slice(0, 200))}`;
}

export function searchFallback(query: string, canReadTickets: boolean): CommandItem | null {
  const trimmed = query.trim();
  if (!canReadTickets || !trimmed) return null;
  return { id: 'fallback:search-all', label: `Search tickets for ‘${trimmed}’`, icon: 'search', href: searchAllHref(trimmed) };
}

function goToItems(teams: readonly TeamSummary[], destinations: readonly DeskDestination[]): CommandItem[] {
  const place = (id: string): CommandItem[] =>
    destinations
      .filter((entry) => entry.id === id)
      .map((entry) => ({ id: `go:${entry.id}`, label: entry.label, icon: entry.icon, shortcut: entry.shortcut, keywords: [...entry.keywords], href: entry.href }));
  return [
    ...place('overview'),
    ...VIEWS.map(
      (view): CommandItem => ({
        id: `go:${view.id}`,
        label: view.label,
        icon: view.icon,
        shortcut: view.shortcut,
        keywords: ['go to', 'view', ...view.keywords],
        href: viewPath({ kind: 'view', id: view.id }),
      }),
    ),
    ...teams.map(
      (team): CommandItem => ({
        id: `go:${viewKey({ kind: 'team', teamId: team.id })}`,
        label: team.name,
        description: 'Team',
        icon: 'people',
        keywords: ['team', 'go to'],
        href: viewPath({ kind: 'team', teamId: team.id }),
      }),
    ),
    ...place('board'),
  ];
}

function preferenceItems(deps: DeskPaletteDeps): CommandItem[] {
  const { prefs, setPrefs } = deps;
  const appearance = (value: Prefs['appearance'], label: string): CommandItem => ({
    id: `pref:appearance:${value}`,
    label: `Appearance: ${label}`,
    icon: value === 'dark' ? 'moon' : value === 'light' ? 'sun' : 'monitor',
    keywords: ['theme', 'dark mode', 'light mode', 'colour'],
    ...(prefs.appearance === value ? { meta: 'Current' } : {}),
    run: () => setPrefs({ appearance: value }),
  });
  const contrastOn = prefs.contrast === 'more';
  const compact = prefs.density === 'compact';
  const singleKeys = prefs.shortcuts !== 'off';
  const announcing = prefs.announceLive !== 'off';
  return [
    appearance('system', 'Automatic'),
    appearance('light', 'Light'),
    appearance('dark', 'Dark'),
    {
      id: 'pref:contrast',
      label: contrastOn ? 'Turn off increased contrast' : 'Increase contrast',
      icon: 'contrast',
      keywords: ['accessibility', 'high contrast', 'theme'],
      run: () => setPrefs({ contrast: contrastOn ? 'standard' : 'more' }),
    },
    {
      id: 'pref:density',
      label: compact ? 'Density: Comfortable' : 'Density: Compact',
      icon: 'rows-3',
      keywords: ['spacing', 'rows', 'dense'],
      run: () => setPrefs({ density: compact ? 'comfortable' : 'compact' }),
    },
    ...(deps.canSetAvailability
      ? [
          {
            id: 'pref:availability',
            label: 'Set availability…',
            icon: 'circle-dashed',
            keywords: ['status', 'away', 'busy', 'available', 'off shift', 'lunch'],
            children: () =>
              AVAILABILITY_CHOICES.map(
                (choice): CommandItem => ({
                  id: `availability:${choice.value}`,
                  label: choice.label,
                  run: () => deps.setAvailability(choice.value),
                }),
              ),
          } satisfies CommandItem,
        ]
      : []),
    {
      id: 'pref:shortcuts',
      label: singleKeys ? 'Turn off single-key shortcuts' : 'Turn on single-key shortcuts',
      icon: 'keyboard',
      keywords: ['keyboard', 'hotkeys'],
      run: () => setPrefs({ shortcuts: singleKeys ? 'off' : 'on' }),
    },
    {
      id: 'pref:announce',
      label: announcing ? 'Stop announcing live updates' : 'Announce live updates',
      icon: 'bell',
      keywords: ['screen reader', 'live region', 'accessibility'],
      run: () => setPrefs({ announceLive: announcing ? 'off' : 'on' }),
    },
  ];
}

function ticketItem(ticket: Ticket): CommandItem {
  return {
    id: `ticket:${ticket.number}`,
    label: ticket.title,
    description: `${ticket.number} · ${typeLabel(ticket.type)}`,
    meta: stateLabel(ticket.status),
    icon: 'ticket',
    href: ticketHref(ticket.number),
  };
}

export function deskCommandProviders(deps: DeskPaletteDeps): CommandProvider[] {
  const providers: CommandProvider[] = [];

  if (deps.canReadTickets) {
    providers.push({ id: 'go', group: 'Go to', items: goToItems(deps.teams, deps.destinations ?? []) });
    providers.push({
      id: 'number',
      group: 'Go to',
      match: TICKET_NUMBER_PATTERN,
      minQuery: 1,
      debounceMs: 0,
      search: async (query) =>
        ticketNumbersFor(query).map(
          (number): CommandItem => ({ id: `open:${number}`, label: `Open ${number}`, icon: 'ticket', href: ticketHref(number) }),
        ),
    });
  }

  if (deps.canCreate) {
    providers.push({
      id: 'create',
      group: 'Create',
      items: [{ id: 'create:ticket', label: 'New ticket', icon: 'compose', shortcut: 'c', keywords: ['raise', 'log', 'create'], run: deps.openNewTicket }],
    });
  }

  if (deps.switchArea && deps.switchArea.length > 0) {
    providers.push({ id: 'areas', group: 'Switch area', items: deps.switchArea });
  }

  if (deps.canReadTickets && deps.canSearch) {
    providers.push({
      id: 'tickets',
      group: 'Tickets',
      minQuery: 2,
      debounceMs: 200,
      search: async (query, signal) => {
        const tickets = await deps.searchTickets(query, signal);
        return [
          ...tickets.slice(0, 5).map(ticketItem),
          { id: 'tickets:all', label: `See all tickets matching ‘${query}’`, icon: 'search', href: searchAllHref(query) },
        ];
      },
    });
  }

  if (deps.canReadTickets && deps.canReadPeople) {
    providers.push({
      id: 'people',
      group: 'People',
      minQuery: 2,
      debounceMs: 200,
      limit: 5,
      search: async (query, signal) => {
        const people = await deps.searchPeople(query, signal);
        return people.slice(0, 5).map(
          (person): CommandItem => ({
            id: `person:${person.id}`,
            label: `Tickets from ${person.displayName}`,
            ...(person.email ? { description: person.email } : {}),
            icon: 'user',
            href: `/inbox/all?requester=${encodeURIComponent(person.id)}`,
          }),
        );
      },
    });
  }

  providers.push({ id: 'preferences', group: 'Preferences', items: preferenceItems(deps) });
  providers.push({
    id: 'help',
    group: 'Help',
    items: [
      { id: 'help:shortcuts', label: 'Keyboard shortcuts', icon: 'keyboard', shortcut: '?', keywords: ['help', 'keys'], run: deps.openShortcuts },
      { id: 'help:sign-out', label: 'Sign out', icon: 'log-out', keywords: ['log out', 'leave'], run: deps.signOut },
    ],
  });

  return providers;
}
