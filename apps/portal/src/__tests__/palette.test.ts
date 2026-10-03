import { describe, expect, it, vi } from 'vitest';
import type { CatalogueItem, SearchHit, Ticket } from '@itsm/sdk';
import type { CommandItem, CommandProvider } from '@itsm/ui';
import { defaultPrefs } from '@itsm/ui/theme';
import {
  REQUEST_NUMBER_PATTERN,
  articleHref,
  knowledgeSearchHref,
  paletteFallback,
  portalCommandProviders,
  requestNumbersFor,
  serviceMatches,
  type PortalPaletteDeps,
} from '../client/palette.js';
import { buildAreaModel } from '@itsm/contracts/areas';
import { areaItems, paletteProviders } from '../components/PortalPalette.js';
import { portalFrame, type PortalCan } from '../navigation.js';

/**
 * The portal's palette (SPEC §5.5): the Home search panel wherever the
 * person is, plus the few things people open the portal to do — and a
 * search that never ends in nothing.
 */

const everyone: PortalCan = { readCatalogue: true, readKnowledge: true, readApprovals: true, createTickets: true, search: true };

function ticket(number: string, title: string, status = 'in_progress'): Ticket {
  return { number, title, status, type: number.startsWith('REQ') ? 'request' : 'incident' } as Ticket;
}

function deps(overrides: Partial<PortalPaletteDeps> = {}): PortalPaletteDeps {
  const can = overrides.can ?? everyone;
  return {
    can,
    nav: portalFrame(can, 0).nav.sections.flatMap((section) => section.items),
    approvalsWaiting: 0,
    prefs: defaultPrefs,
    setPrefs: vi.fn(),
    openHelp: vi.fn(),
    signOut: vi.fn(),
    searchAnswers: vi.fn(async (): Promise<SearchHit[]> => [
      { entityType: 'knowledge', entityId: 'a1', title: 'Set up the VPN', snippet: 'Install the <b>VPN</b> client', rank: 1, facets: { key: 'set-up-vpn' } },
    ]),
    searchRequests: vi.fn(async () => [ticket('INC-000123', 'VPN drops every hour', 'pending_requester')]),
    services: vi.fn(async (): Promise<CatalogueItem[]> => [
      { key: 'vpn-access', name: 'VPN access', description: null, shortSummary: 'Work from home', formKey: null, service: 'Access & accounts', serviceKey: 'access' },
      { key: 'laptop', name: 'New laptop', description: null, shortSummary: null, formKey: null, service: 'Devices', serviceKey: 'devices' },
    ]),
    ...overrides,
  };
}

function provider(providers: CommandProvider[], id: string): CommandProvider | undefined {
  return providers.find((candidate) => candidate.id === id);
}

async function search(providers: CommandProvider[], id: string, query: string): Promise<readonly CommandItem[]> {
  const found = provider(providers, id);
  if (!found?.search) throw new Error(`no search provider ${id}`);
  return found.search(query, new AbortController().signal);
}

describe('Go to', () => {
  it('lists the pills, then Approvals with its count, then Profile', () => {
    const items = provider(portalCommandProviders(deps({ approvalsWaiting: 2 })), 'go')!.items!;
    expect(items.map((item) => item.label)).toEqual(['Home', 'My requests', 'Services', 'Knowledge', 'Approvals', 'Profile']);
    expect(items.find((item) => item.label === 'Approvals')).toMatchObject({ href: '/approvals', description: '2 approvals waiting' });
  });

  it('leaves out what the person cannot open', () => {
    const can = { ...everyone, readApprovals: false, readCatalogue: false };
    const items = provider(portalCommandProviders(deps({ can })), 'go')!.items!;
    expect(items.map((item) => item.label)).toEqual(['Home', 'My requests', 'Knowledge', 'Profile']);
  });

  it('pins a request number as "Open INC-000123", guessing the type from a bare number', async () => {
    expect(requestNumbersFor('inc-123')).toEqual(['INC-000123']);
    expect(requestNumbersFor('REQ 46')).toEqual(['REQ-000046']);
    expect(requestNumbersFor('#7')).toEqual(['INC-000007', 'REQ-000007', 'QNA-000007']);
    expect(requestNumbersFor('vpn 2')).toEqual([]);
    expect(REQUEST_NUMBER_PATTERN.test('INC123')).toBe(true);
    const items = await search(portalCommandProviders(deps()), 'number', 'inc 123');
    expect(items).toEqual([{ id: 'open:INC-000123', label: 'Open INC-000123', icon: 'ticket', href: '/tickets/INC-000123' }]);
  });
});

describe('Get help', () => {
  it('opens "How can we help?" at the start, or at the details for Report an issue', () => {
    const d = deps();
    const items = provider(portalCommandProviders(d), 'actions')!.items!;
    items.find((item) => item.label === 'New request')!.run!();
    expect(d.openHelp).toHaveBeenLastCalledWith();
    items.find((item) => item.label === 'Report an issue')!.run!();
    expect(d.openHelp).toHaveBeenLastCalledWith({ step: 'details' });
  });

  it('is not offered without ticket.create', () => {
    const providers = portalCommandProviders(deps({ can: { ...everyone, createTickets: false } }));
    expect(provider(providers, 'actions')).toBeUndefined();
    expect(provider(providers, 'report')).toBeUndefined();
  });
});

describe('as the person types', () => {
  it('finds answers, as plain text, linking to the article by key', async () => {
    const d = deps();
    const items = await search(portalCommandProviders(d), 'answers', 'vpn');
    expect(d.searchAnswers).toHaveBeenCalledWith('vpn', expect.any(AbortSignal));
    expect(items[0]).toMatchObject({ label: 'Set up the VPN', description: 'Install the VPN client', href: '/knowledge/set-up-vpn' });
    expect(items.at(-1)).toMatchObject({ label: 'Search help articles for ‘vpn’', href: '/knowledge?q=vpn' });
  });

  it('asks for answers only with both search.query and knowledge.read', () => {
    expect(provider(portalCommandProviders(deps({ can: { ...everyone, search: false } })), 'answers')).toBeUndefined();
    expect(provider(portalCommandProviders(deps({ can: { ...everyone, readKnowledge: false } })), 'answers')).toBeUndefined();
  });

  it('filters the catalogue it fetched once, by every word', async () => {
    const d = deps();
    const providers = portalCommandProviders(d);
    expect((await search(providers, 'services', 'vpn')).map((item) => item.label)).toEqual(['VPN access']);
    expect((await search(providers, 'services', 'new lap')).map((item) => item.href)).toEqual(['/catalogue/laptop']);
    expect(await search(providers, 'services', 'printer')).toEqual([]);
    expect(d.services).toHaveBeenCalledTimes(1);
    expect((await search(providers, 'services', 'vpn'))[0]).toMatchObject({ icon: 'key', description: 'Access & accounts' });
  });

  it('asks for the catalogue again after a failure', async () => {
    const services = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue([]);
    const providers = portalCommandProviders(deps({ services }));
    await expect(search(providers, 'services', 'vpn')).rejects.toThrow('offline');
    await expect(search(providers, 'services', 'vpn')).resolves.toEqual([]);
    expect(services).toHaveBeenCalledTimes(2);
  });

  it('finds the person’s own requests, with their state in the requester’s words', async () => {
    const items = await search(portalCommandProviders(deps()), 'requests', 'vpn');
    expect(items).toEqual([
      { id: 'request:INC-000123', label: 'VPN drops every hour', description: 'INC-000123 · Issue', meta: 'Waiting for you', icon: 'ticket', href: '/tickets/INC-000123' },
    ]);
  });

  it('always ends with "Report ‘vpn’ as an issue", which opens the details step with the words', async () => {
    const d = deps();
    const providers = portalCommandProviders(d);
    const searches = providers.filter((candidate) => candidate.search).map((candidate) => candidate.id);
    expect(searches.at(-1)).toBe('report');
    const [item] = await search(providers, 'report', '  vpn keeps dropping ');
    expect(item!.label).toBe('Report ‘vpn keeps dropping’ as an issue');
    item!.run!();
    expect(d.openHelp).toHaveBeenCalledWith({ step: 'details', text: 'vpn keeps dropping' });
  });
});

describe('when nothing matches', () => {
  it('offers to report it, or — without ticket.create — to search the articles for it', () => {
    const d = deps();
    expect(paletteFallback('printer on fire', d)).toMatchObject({ label: 'Report ‘printer on fire’ as an issue' });
    expect(paletteFallback('printer', { ...d, can: { ...everyone, createTickets: false } })).toMatchObject({ href: '/knowledge?q=printer' });
    expect(paletteFallback('printer', { ...d, can: { ...everyone, createTickets: false, readKnowledge: false } })).toBeNull();
    expect(paletteFallback('   ', d)).toBeNull();
  });
});

describe('Appearance and Account', () => {
  it('switches the appearance and contrast, marking the current choice', () => {
    const d = deps();
    const items = provider(portalCommandProviders(d), 'appearance')!.items!;
    expect(items.map((item) => item.label)).toEqual(['Appearance: Automatic', 'Appearance: Light', 'Appearance: Dark', 'Increase contrast']);
    expect(items[0]!.meta).toBe('Current');
    items[2]!.run!();
    expect(d.setPrefs).toHaveBeenCalledWith({ appearance: 'dark' });
    items[3]!.run!();
    expect(d.setPrefs).toHaveBeenCalledWith({ contrast: 'more' });
  });

  it('signs out through the frame (which clears this device first)', () => {
    const d = deps();
    provider(portalCommandProviders(d), 'account')!.items![0]!.run!();
    expect(d.signOut).toHaveBeenCalledTimes(1);
  });

  it('has no single-key shortcuts (D14)', () => {
    const items = portalCommandProviders(deps()).flatMap((candidate) => candidate.items ?? []);
    expect(items.filter((item) => item.shortcut)).toEqual([]);
  });
});

describe('links', () => {
  it('uses the article’s key, else its id', () => {
    expect(articleHref({ entityId: 'uuid-1', facets: { key: 'vpn guide' } })).toBe('/knowledge/vpn%20guide');
    expect(articleHref({ entityId: 'uuid-1', facets: {} })).toBe('/knowledge/uuid-1');
    expect(knowledgeSearchHref(` ${'x'.repeat(300)}`)).toBe(`/knowledge?q=${'x'.repeat(200)}`);
  });

  it('matches a service on its name, summary, description or service', () => {
    const item = { key: 'k', name: 'Monitor', description: 'A second screen', shortSummary: null, formKey: null, service: 'Devices', serviceKey: 'd' };
    expect(serviceMatches(item, 'second DEVICES')).toBe(true);
    expect(serviceMatches(item, 'monitor keyboard')).toBe(false);
  });
});

describe('Switch area (v3 §3.9, A2 §10.3)', () => {
  const ORIGINS = { workbench: 'https://desk.example', admin: 'https://admin.example', site: 'https://itsm.example' };
  const staff = buildAreaModel({ app: 'portal', held: ['ticket.update', 'audit.read'], session: { kind: 'oidc' }, origins: ORIGINS });
  const requester = buildAreaModel({ app: 'portal', held: ['ticket.create'], session: { kind: 'oidc' }, origins: ORIGINS });
  const demo = buildAreaModel({ app: 'portal', held: [], session: { kind: 'demo', persona: 'employee' }, origins: ORIGINS });

  it('comes straight after Go to, offering the other areas (never this one) at their /resume, with their keywords', () => {
    const providers = paletteProviders(deps({ areas: staff, areaKeywords: { workbench: ['ticketing'], admin: ['settings'] } }));
    const ids = providers.map((candidate) => candidate.id);
    expect(ids.indexOf('areas')).toBe(ids.lastIndexOf('go') + 1);
    const items = provider(providers, 'areas')!.items!;
    expect(provider(providers, 'areas')!.group).toBe('Switch area');
    expect(items.map((item) => [item.label, item.href])).toEqual([
      ['Switch to Service Desk', 'https://desk.example/resume'],
      ['Switch to Administration', 'https://admin.example/resume'],
    ]);
    expect(items[0]!.keywords).toContain('ticketing');
    expect(items[0]!.description).toBe('Work tickets, queues and SLAs');
    expect(items[0]!.icon).toBe('inbox');
  });

  it('is not there for a requester with one area, and keeps Sign out', () => {
    const providers = paletteProviders(deps({ areas: requester }));
    expect(provider(providers, 'areas')).toBeUndefined();
    expect(areaItems(requester)).toEqual([]);
    expect(areaItems(undefined)).toEqual([]);
    expect(provider(providers, 'account')!.items![0]!.label).toBe('Sign out');
  });

  it('in a demo visit names who the visitor continues as, adds the public site, and ends the demo instead of signing out', () => {
    const d = deps({ areas: demo });
    const providers = paletteProviders(d);
    const items = provider(providers, 'areas')!.items!;
    expect(items.map((item) => item.label)).toEqual(['Switch to Service Desk', 'Switch to Administration', 'IT Service Management home']);
    expect(items[0]!.description).toBe("You'll continue as Alex Morgan, Service Desk team lead");
    expect(items[0]!.href).toBe('https://desk.example/demo?persona=agent&demo=1&redirectTo=%2Fresume');
    expect(items[2]!.href).toBe('https://itsm.example/');
    const end = provider(providers, 'account')!.items![0]!;
    expect(end.label).toBe('End demo');
    end.run!();
    expect(d.signOut).toHaveBeenCalledTimes(1);
  });
});
