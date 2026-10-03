import type { AreaId, AreaModel } from '@itsm/contracts/areas';
import type { CatalogueItem, SearchHit, Ticket } from '@itsm/sdk';
import type { CommandItem, CommandProvider } from '@itsm/ui';
import type { NavItem } from '@itsm/ui/shell';
import type { Prefs } from '@itsm/ui/theme';
import { serviceIcon } from '../catalogue/icons.js';
import type { HelpFlowRequest } from '../components/PortalShell.js';
import { snippetText } from '../knowledge/highlight.js';
import { approvalsWaitingLabel, type PortalCan } from '../navigation.js';
import { requesterState, typeLabel } from '../tickets/presentation.js';

/**
 * The portal's command palette (SPEC §5.5): ⌘K, or the search button in the
 * top bar. It is the Home page's search panel wherever the person is —
 * answers, services and their own requests as they type, and always, last,
 * "Report 'vpn' as an issue" — plus the handful of things somebody opens the
 * portal to do: a new request, their requests, approvals, their profile,
 * appearance, sign out — and the other areas (v3 §3.9), which the palette's
 * own module adds (`PortalPalette.tsx`): this module is also read by Home's
 * search and the help flow, so what it carries is in every page's first
 * load, and the Switch area group is weight only the palette needs.
 *
 * A request number ("INC-123", "req 46") is pinned first as "Open INC-000123".
 * Nothing here is a single-key shortcut: the portal has none apart from `/` on
 * Home and Knowledge (D14).
 *
 * Built from injected functions rather than the SDK and the router directly,
 * so the whole registry is testable as data.
 */

export interface PortalPaletteDeps {
  readonly can: PortalCan;
  /** The frame's pills (Home, My requests, Services, Knowledge), as the navigation built them. */
  readonly nav: readonly NavItem[];
  /** The person's areas (`currentAreas()`): the Switch area group and, in a demo visit, *End demo* (`PortalPalette.tsx`). */
  readonly areas?: AreaModel;
  /** Each area's search words (`AREAS[…].keywords`), handed over by the layout so no contracts table reaches the browser. */
  readonly areaKeywords?: Readonly<Partial<Record<AreaId, readonly string[]>>>;
  readonly approvalsWaiting: number;
  readonly prefs: Prefs;
  setPrefs(patch: Partial<Prefs>): void;
  openHelp(request?: HelpFlowRequest): void;
  signOut(): void;
  searchAnswers(query: string, signal: AbortSignal): Promise<readonly SearchHit[]>;
  searchRequests(query: string, signal: AbortSignal): Promise<readonly Ticket[]>;
  /**
   * The catalogue, fetched once per palette and filtered here (the list is
   * short and entitlement-filtered). No abort signal: one keystroke's search
   * giving way to the next must not cancel the fetch the next one waits on.
   */
  services(): Promise<readonly CatalogueItem[]>;
}

/** The ticket types a requester raises, in the order a bare number is guessed at. */
const NUMBER_PREFIXES = ['INC', 'REQ', 'QNA'] as const;

/** `INC-123`, `req 46`, `INC123`, `#123` or a bare `123`. */
export const REQUEST_NUMBER_PATTERN = /^(?:(INC|REQ|QNA)[\s-]?)?#?(\d{1,9})$/i;

/**
 * The request numbers a query could mean, written the way the API numbers
 * them (six digits): `inc-123` → `INC-000123`; a bare `123` → an issue, a
 * request and a question, because the prefix is the type and the person did
 * not say.
 */
export function requestNumbersFor(query: string): string[] {
  const match = REQUEST_NUMBER_PATTERN.exec(query.trim());
  if (!match) return [];
  const digits = match[2]!.padStart(6, '0');
  const prefix = match[1]?.toUpperCase() as (typeof NUMBER_PREFIXES)[number] | undefined;
  return (prefix ? [prefix] : [...NUMBER_PREFIXES]).map((type) => `${type}-${digits}`);
}

export function requestHref(number: string): string {
  return `/tickets/${encodeURIComponent(number)}`;
}

/** An article's page: its key when the index carried one, else its id (the page accepts either). */
export function articleHref(hit: Pick<SearchHit, 'entityId' | 'facets'>): string {
  const key = typeof hit.facets.key === 'string' && hit.facets.key !== '' ? hit.facets.key : hit.entityId;
  return `/knowledge/${encodeURIComponent(key)}`;
}

export function knowledgeSearchHref(query: string): string {
  return `/knowledge?q=${encodeURIComponent(query.trim().slice(0, 200))}`;
}

/** "Report ‘vpn’ as an issue": the row that is always last, so a search never ends in nothing (X-40). */
export function reportItem(query: string, openHelp: (request?: HelpFlowRequest) => void): CommandItem {
  const text = query.trim();
  return {
    id: 'report:query',
    label: `Report ‘${text}’ as an issue`,
    icon: 'compose',
    run: () => openHelp({ step: 'details', text }),
  };
}

/** When nothing at all matched: report it if the person can, else search the articles for it. */
export function paletteFallback(query: string, deps: Pick<PortalPaletteDeps, 'can' | 'openHelp'>): CommandItem | null {
  const text = query.trim();
  if (!text) return null;
  if (deps.can.createTickets) return reportItem(text, deps.openHelp);
  if (deps.can.readKnowledge) return { id: 'fallback:knowledge', label: `Search help articles for ‘${text}’`, icon: 'search', href: knowledgeSearchHref(text) };
  return null;
}

/** Whether a catalogue item answers the query: every word appears in its name, summary or service. */
export function serviceMatches(item: CatalogueItem, query: string): boolean {
  const haystack = [item.name, item.shortSummary ?? '', item.description ?? '', item.service ?? ''].join(' ').toLocaleLowerCase('en-GB');
  return query
    .toLocaleLowerCase('en-GB')
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

function goToItems(deps: PortalPaletteDeps): CommandItem[] {
  return [
    ...deps.nav.map(
      (item): CommandItem => ({
        id: `go:${item.id}`,
        label: item.label,
        ...(item.icon ? { icon: item.icon } : {}),
        keywords: ['go to', ...(item.keywords ?? [])],
        href: item.href,
      }),
    ),
    ...(deps.can.readApprovals
      ? [
          {
            id: 'go:approvals',
            label: 'Approvals',
            icon: 'approvals',
            description: deps.approvalsWaiting > 0 ? approvalsWaitingLabel(deps.approvalsWaiting) : 'Nothing waiting on you',
            keywords: ['go to', 'approve', 'decisions', 'reject'],
            href: '/approvals',
          } satisfies CommandItem,
        ]
      : []),
    { id: 'go:profile', label: 'Profile', icon: 'profile', keywords: ['go to', 'me', 'account', 'notifications', 'settings'], href: '/profile' },
  ];
}

function preferenceItems({ prefs, setPrefs }: PortalPaletteDeps): CommandItem[] {
  const appearance = (value: Prefs['appearance'], label: string): CommandItem => ({
    id: `pref:appearance:${value}`,
    label: `Appearance: ${label}`,
    icon: value === 'dark' ? 'moon' : value === 'light' ? 'sun' : 'monitor',
    keywords: ['theme', 'dark mode', 'light mode', 'colour'],
    ...(prefs.appearance === value ? { meta: 'Current' } : {}),
    run: () => setPrefs({ appearance: value }),
  });
  const contrastOn = prefs.contrast === 'more';
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
  ];
}

function requestItem(ticket: Ticket): CommandItem {
  return {
    id: `request:${ticket.number}`,
    label: ticket.title,
    description: `${ticket.number} · ${typeLabel(ticket.type)}`,
    meta: requesterState(ticket.status).label,
    icon: 'ticket',
    href: requestHref(ticket.number),
  };
}

export function portalCommandProviders(deps: PortalPaletteDeps): CommandProvider[] {
  const { can } = deps;
  const providers: CommandProvider[] = [
    {
      id: 'number',
      group: 'Go to',
      match: REQUEST_NUMBER_PATTERN,
      minQuery: 1,
      debounceMs: 0,
      search: async (query) =>
        requestNumbersFor(query).map((number): CommandItem => ({ id: `open:${number}`, label: `Open ${number}`, icon: 'ticket', href: requestHref(number) })),
    },
    { id: 'go', group: 'Go to', items: goToItems(deps) },
  ];

  if (can.createTickets) {
    providers.push({
      id: 'actions',
      group: 'Get help',
      items: [
        {
          id: 'help:new',
          label: 'New request',
          icon: 'compose',
          keywords: ['how can we help', 'ask', 'raise', 'log', 'create', 'ticket'],
          run: () => deps.openHelp(),
        },
        {
          id: 'help:report',
          label: 'Report an issue',
          icon: 'triangle-alert',
          keywords: ['broken', 'not working', 'problem', 'fault', 'incident'],
          run: () => deps.openHelp({ step: 'details' }),
        },
      ],
    });
  }

  if (can.search && can.readKnowledge) {
    providers.push({
      id: 'answers',
      group: 'Answers',
      minQuery: 2,
      debounceMs: 200,
      search: async (query, signal) => {
        const hits = await deps.searchAnswers(query, signal);
        return [
          ...hits.slice(0, 4).map(
            (hit): CommandItem => ({
              id: `article:${hit.entityId}`,
              label: hit.title,
              ...(hit.snippet ? { description: snippetText(hit.snippet) } : {}),
              icon: 'knowledge',
              href: articleHref(hit),
            }),
          ),
          { id: 'answers:all', label: `Search help articles for ‘${query.trim()}’`, icon: 'search', href: knowledgeSearchHref(query) },
        ];
      },
    });
  }

  if (can.readCatalogue) {
    let catalogue: Promise<readonly CatalogueItem[]> | null = null;
    providers.push({
      id: 'services',
      group: 'Services',
      minQuery: 2,
      debounceMs: 0,
      limit: 3,
      search: async (query) => {
        // One fetch per palette; a failed one is asked again next time.
        catalogue ??= deps.services().catch((error: unknown) => {
          catalogue = null;
          throw error;
        });
        const items = await catalogue;
        return items
          .filter((item) => serviceMatches(item, query))
          .slice(0, 3)
          .map(
            (item): CommandItem => ({
              id: `service:${item.key}`,
              label: item.name,
              ...(item.service ? { description: item.service } : {}),
              icon: serviceIcon(item.service, item.name, item.shortSummary),
              href: `/catalogue/${encodeURIComponent(item.key)}`,
            }),
          );
      },
    });
  }

  providers.push({
    id: 'requests',
    group: 'Your requests',
    minQuery: 2,
    debounceMs: 200,
    limit: 3,
    search: async (query, signal) => (await deps.searchRequests(query, signal)).slice(0, 3).map(requestItem),
  });

  if (can.createTickets) {
    providers.push({
      id: 'report',
      group: 'Still stuck?',
      minQuery: 1,
      debounceMs: 0,
      search: async (query) => [reportItem(query, deps.openHelp)],
    });
  }

  providers.push({ id: 'appearance', group: 'Appearance', items: preferenceItems(deps) });
  providers.push({
    id: 'account',
    group: 'Account',
    items: [{ id: 'account:sign-out', label: 'Sign out', icon: 'log-out', keywords: ['log out', 'leave'], run: deps.signOut }],
  });

  return providers;
}
