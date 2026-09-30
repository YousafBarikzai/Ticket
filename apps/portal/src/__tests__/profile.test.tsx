// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, cloneElement, forwardRef, isValidElement, Suspense, type AnchorHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApprovalRequest, Me, NotificationPreference, NotificationPreferenceInput, SessionRow } from '@itsm/sdk';
import { ApiError } from '@itsm/sdk';
import { ItsmProvider } from '@itsm/ui';
import { structuralVariables, themeVariables } from '@itsm/ui/tokens';
import { cleanupDocument, clickAsync, render, type } from './support/render.js';

/**
 * Profile (SPEC §6.3 `/profile`, F40): who you are in words — never a
 * permission key, a count of teams or a raw locale — then the approvals row,
 * notifications that save themselves (the whole record, every time), the
 * appearance of this device, and the sessions you are signed in with.
 */

vi.mock('server-only', () => ({}));

const router = { refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() };
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/profile',
  useSearchParams: () => new URLSearchParams(),
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));

vi.mock('../app/AppLink.js', () => ({
  AppLink: forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: unknown }>(function AppLink({ prefetch, ...props }, ref) {
    void prefetch;
    return <a ref={ref} {...props} />;
  }),
}));

const browserApi = {
  setNotificationPreference: vi.fn(async (input: NotificationPreferenceInput): Promise<NotificationPreference> => ({
    channel: input.channel,
    enabled: input.enabled ?? true,
    digestMode: input.digestMode ?? 'immediate',
    quietHours: input.quietHours ?? null,
  })),
  endSession: vi.fn(async (_id: string) => undefined),
};
vi.mock('../client/api.js', () => ({ api: browserApi }));

const notify = vi.fn();
vi.mock('@itsm/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itsm/ui')>();
  return { ...actual, notify: Object.assign((...args: unknown[]) => notify(...args), { dismiss: vi.fn(), promise: vi.fn(), progress: vi.fn() }) };
});

/* ---- The server, as the page sees it ------------------------------------- */

let permissions: string[] = [];
let person: Partial<Me> = {};
let waiting: ApprovalRequest[] | null = [];
let directory: { email: string | null; teams: string[] | null } = { email: null, teams: null };
const serverApi = {
  notificationPreferences: vi.fn(async (): Promise<NotificationPreference[]> => []),
  sessions: vi.fn(async (): Promise<SessionRow[]> => []),
};

const me = (): Me => ({
  actor: { type: 'user', id: 'u1', displayName: 'Ada Lovelace' },
  tenant: { id: 't', name: 'Acme', slug: 'acme', region: 'eu' },
  permissions: permissions.map((key) => ({ key, scope: 'own' })),
  organisations: [],
  teamIds: [],
  locale: 'en-GB',
  timeZone: 'Europe/London',
  ...person,
});

vi.mock('../server/session.js', () => ({
  requireSession: async () => ({ id: 's1' }),
  currentMe: async () => me(),
  heldPermissions: (who: Me) => new Set(who.permissions.map((permission) => permission.key)),
  apiFor: () => serverApi,
  currentApprovals: async () => waiting,
}));

const readDirectoryEntry = vi.fn(async () => directory);
vi.mock('../profile/server.js', () => ({ readDirectoryEntry: () => readDirectoryEntry() }));

const page = await import('../app/(portal)/profile/page.js');
const model = await import('../profile/model.js');
// The confirmation's chunk, loaded once so that opening it in a test is a matter of promises.
await import('@itsm/ui/overlays');

beforeAll(() => {
  const scope = globalThis as Record<string, unknown>;
  class Observer {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): [] {
      return [];
    }
  }
  scope.ResizeObserver ??= Observer;
  scope.IntersectionObserver ??= Observer;
  scope.matchMedia ??= (query: string) => ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false });
});

beforeEach(() => {
  permissions = ['approval.read', 'notification.read', 'identity.session.manage', 'ticket.create'];
  person = {};
  waiting = [];
  directory = { email: 'ada@acme.test', teams: null };
  serverApi.notificationPreferences.mockReset();
  serverApi.notificationPreferences.mockResolvedValue([{ channel: 'email', enabled: true, digestMode: 'daily', quietHours: { start: '19:00', end: '07:00' } }]);
  serverApi.sessions.mockReset();
  serverApi.sessions.mockResolvedValue([]);
  browserApi.setNotificationPreference.mockClear();
  browserApi.endSession.mockReset();
  browserApi.endSession.mockResolvedValue(undefined);
  notify.mockClear();
  localStorage.clear();
  document.documentElement.removeAttribute('data-itsm-theme');
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
});

afterEach(() => cleanupDocument());

/* ---- Rendering --------------------------------------------------------------- */

async function resolveServer(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map((child) => resolveServer(child as ReactNode)));
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (element.type === Suspense) return resolveServer(element.props.children);
  if (typeof element.type === 'function' && element.type.constructor.name === 'AsyncFunction') {
    return resolveServer(await (element.type as (props: unknown) => Promise<ReactNode>)(element.props));
  }
  const { children } = element.props;
  if (children === undefined) return element;
  if (Array.isArray(children)) return cloneElement(element, undefined, ...((await resolveServer(children)) as ReactNode[]));
  return cloneElement(element, undefined, await resolveServer(children));
}

function Link({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }): ReactNode {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}

async function settle(rounds = 6): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await act(async () => {
      await new Promise((later) => setTimeout(later, 0));
    });
  }
}

async function openProfile(): Promise<void> {
  const tree = await resolveServer(await page.default());
  render(
    <ItsmProvider app="portal" Link={Link} router={router} usePathname={() => '/profile'} useSearchParams={() => new URLSearchParams()} locale="en-GB" timeZone="Europe/London" storageScope="u1">
      {tree}
    </ItsmProvider>,
  );
  await settle();
}

function text(): string {
  return document.body.textContent?.replace(/\s+/g, ' ') ?? '';
}

function section(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`no section #${id} in: ${text()}`);
  return found;
}

function switchNamed(name: string, within: ParentNode = document): HTMLButtonElement {
  const found = [...within.querySelectorAll<HTMLButtonElement>('button[role="switch"]')].find((node) => {
    const labelled = node.getAttribute('aria-labelledby');
    const label = labelled ? document.getElementById(labelled.split(' ')[0]!)?.textContent : node.textContent;
    return label?.trim() === name;
  });
  if (!found) throw new Error(`no switch “${name}”`);
  return found;
}

function channel(name: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[role="group"][aria-label="${name}"]`);
  if (!found) throw new Error(`no channel “${name}”`);
  return found;
}

/* ---- The rules --------------------------------------------------------------- */

describe('the rules', () => {
  it('names a language and a time zone in words, and leaves an unknown one as it is', () => {
    expect(model.languageName('en-GB')).toBe('British English');
    expect(model.languageName('fr-FR', 'fr-FR')).toMatch(/^Français/);
    expect(model.languageName('x-nonsense-!!')).toBe('x-nonsense-!!');

    const summer = new Date('2026-07-01T12:32:00Z');
    expect(model.zoneWords('Europe/London', summer, 'en-GB')).toEqual({ place: 'London (GMT+1)', now: '13:32 now', long: 'British Summer Time' });
    expect(model.zoneWords('Europe/London', new Date('2026-12-01T12:32:00Z'), 'en-GB').place).toBe('London (GMT)');
    expect(model.zoneWords('America/Argentina/Buenos_Aires', summer, 'en-GB').place).toBe('Buenos Aires (GMT-3)');
    expect(model.zoneWords('Not/A_Zone', summer, 'en-GB')).toEqual({ place: 'Not/A_Zone', now: null, long: null });
  });

  it('names organisations with the ones above them that the person also belongs to, never by code', () => {
    expect(
      model.organisationLines([
        { id: '1', name: 'Acme', code: 'acme', path: '/acme' },
        { id: '2', name: 'IT', code: 'it', path: '/acme/it' },
        { id: '3', name: 'Finance', code: 'fin', path: '/other/fin' },
      ]),
    ).toEqual(['Acme › IT', 'Finance']);
  });

  it('sends the whole record for a channel, every time', () => {
    const settings = model.settingsOf([{ channel: 'email', enabled: false, digestMode: 'daily', quietHours: null }, { channel: 'push', enabled: true, digestMode: 'immediate', quietHours: null }]);
    expect(settings.inapp).toEqual(model.DEFAULT_SETTING);
    expect(model.inputFor('email', { ...settings.email, quietHours: { start: '18:00', end: '08:00' } })).toEqual({
      channel: 'email',
      enabled: false,
      digestMode: 'daily',
      quietHours: { start: '18:00', end: '08:00' },
    });
    expect(model.otherChannels([{ channel: 'push', enabled: true, digestMode: 'immediate', quietHours: null }])).toEqual(['Push notifications']);
  });

  it('takes a quiet window only with two real, different ends', () => {
    expect(model.validQuietHours('18:00', '08:00')).toBe(true);
    expect(model.validQuietHours('18:00', null)).toBe(false);
    expect(model.validQuietHours('18:00', '18:00')).toBe(false);
    expect(model.validQuietHours('25:00', '08:00')).toBe(false);
  });

  it('describes a session by its device when there is one, and orders the most recent first', () => {
    expect(model.sessionLabel({ device: null })).toEqual({ label: 'A browser', icon: 'monitor' });
    expect(model.sessionLabel({ device: 'iPhone 16' })).toEqual({ label: 'iPhone 16', icon: 'smartphone' });
    const sessions = model.sessionsInOrder([
      { id: 'a', device: null, ip: null, lastSeenAt: '2026-09-01T00:00:00Z', expiresAt: '' },
      { id: 'b', device: null, ip: null, lastSeenAt: '2026-09-30T00:00:00Z', expiresAt: '' },
    ]);
    expect(sessions.map((session) => session.id)).toEqual(['b', 'a']);
  });
});

/* ---- The page ------------------------------------------------------------------- */

describe('the Profile page', () => {
  it('says who you are in words — no codes, no counts, no permission keys', async () => {
    person = {
      teamIds: ['t1', 't2'],
      organisations: [
        { id: 'o1', name: 'Acme', code: 'acme', path: '/acme' },
        { id: 'o2', name: 'Service desk', code: 'desk', path: '/acme/desk' },
      ],
    };
    directory = { email: 'ada@acme.test', teams: ['Network', 'Service desk'] };
    await openProfile();

    expect(document.querySelector('h1')?.textContent).toBe('Profile');
    const account = section('account');
    expect(account.textContent).toContain('Ada Lovelace');
    expect(account.textContent).toContain('ada@acme.test');
    expect(account.textContent).toContain('Acme › Service desk');
    expect(account.textContent).toContain('Network, Service desk');
    expect(account.textContent).toContain('British English');
    expect(account.textContent).toMatch(/London \(GMT(\+1)?\)/);
    expect(account.textContent).toMatch(/\d{2}:\d{2} now/);
    expect(account.textContent).toContain('organisation’s directory');
    for (const leak of ['en-GB', 'Europe/London', 'approval.read', 'ticket.create', 'Teams: 2', 't1']) expect(text()).not.toContain(leak);
  });

  it('leaves the teams out when their names cannot be read, rather than counting them', async () => {
    person = { teamIds: ['t1', 't2'] };
    directory = { email: null, teams: null };
    await openProfile();
    expect([...section('account').querySelectorAll('dt')].map((term) => term.textContent)).toEqual(['Organisation', 'Language', 'Time zone']);
    expect(section('account').textContent).not.toMatch(/Teams?\b/);
  });

  it('lists its sections beside them, and keeps a permanent row to Approvals with the count', async () => {
    waiting = [{ id: 'a' } as ApprovalRequest, { id: 'b' } as ApprovalRequest];
    serverApi.sessions.mockResolvedValue([]);
    await openProfile();
    expect([...document.querySelectorAll('.app-Profile__navLink')].map((link) => link.getAttribute('href'))).toEqual([
      '#account',
      '#approvals',
      '#notifications',
      '#appearance',
      '#devices',
    ]);
    const row = section('approvals').querySelector('a')!;
    expect(row.getAttribute('href')).toBe('/approvals');
    expect(row.textContent).toContain('2 approvals waiting');

    cleanupDocument();
    waiting = [];
    await openProfile();
    expect(section('approvals').textContent).toContain('Nothing waiting on you');
  });

  it('has no approvals row for somebody who does not approve', async () => {
    permissions = ['notification.read'];
    await openProfile();
    expect(document.getElementById('approvals')).toBeNull();
    expect(text()).not.toContain('Approvals');
  });

  it('keeps the rest of the page when one section cannot be read, and says which', async () => {
    serverApi.notificationPreferences.mockRejectedValue(new Error('down'));
    serverApi.sessions.mockRejectedValue(new ApiError(500, null, 'down'));
    await openProfile();
    expect(section('notifications').textContent).toContain('Couldn’t load your notification settings');
    expect(section('devices').textContent).toContain('Couldn’t load where you’re signed in');
    expect(section('account').textContent).toContain('Ada Lovelace');
  });

  it('leaves Devices out where the service does not list sessions', async () => {
    serverApi.sessions.mockRejectedValue(new ApiError(404, null, 'no'));
    await openProfile();
    expect(document.getElementById('devices')).toBeNull();
  });
});

/* ---- Notifications --------------------------------------------------------- */

describe('notifications', () => {
  it('saves a switch as it changes, sending the whole record, with one shared “Saved”', async () => {
    await openProfile();
    await clickAsync(switchNamed('Email', channel('Email')));
    await settle();
    expect(browserApi.setNotificationPreference).toHaveBeenLastCalledWith({
      channel: 'email',
      enabled: false,
      digestMode: 'daily',
      quietHours: { start: '19:00', end: '07:00' },
    });
    expect(notify).toHaveBeenLastCalledWith('Saved', expect.objectContaining({ tone: 'success', id: 'profile-saved' }));
    // Off: the rest of the channel's settings go with it.
    expect(channel('Email').querySelector('select')).toBeNull();
    expect(channel('Email').textContent).toContain('Sent to ada@acme.test.');
  });

  it('puts a change back when it did not save, and says so', async () => {
    browserApi.setNotificationPreference.mockRejectedValueOnce(new ApiError(503, null, 'down'));
    await openProfile();
    const select = channel('Email').querySelector('select')!;
    await act(async () => {
      select.value = 'hourly';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();
    expect(browserApi.setNotificationPreference).toHaveBeenLastCalledWith(expect.objectContaining({ channel: 'email', digestMode: 'hourly', enabled: true }));
    expect(channel('Email').querySelector('select')?.value).toBe('daily');
    expect(notify).toHaveBeenLastCalledWith('Couldn’t save that change', expect.objectContaining({ tone: 'danger' }));
  });

  it('saves quiet hours only once both ends make a window', async () => {
    await openProfile();
    const inapp = channel('In the portal');
    await clickAsync(switchNamed('Quiet hours', inapp));
    await settle();
    expect(browserApi.setNotificationPreference).toHaveBeenLastCalledWith(expect.objectContaining({ channel: 'inapp', quietHours: { start: '18:00', end: '08:00' } }));
    browserApi.setNotificationPreference.mockClear();

    const [from, until] = [...inapp.querySelectorAll<HTMLInputElement>('input[type="time"]')];
    type(until!, '18:00');
    await settle();
    expect(browserApi.setNotificationPreference).not.toHaveBeenCalled();
    expect(inapp.textContent).toContain('Choose two different times');

    type(from!, '22:30');
    await settle();
    expect(browserApi.setNotificationPreference).toHaveBeenLastCalledWith(expect.objectContaining({ channel: 'inapp', quietHours: { start: '22:30', end: '18:00' } }));
  });

  it('cannot be changed offline, and says so', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    await openProfile();
    expect(section('notifications').textContent).toContain('You’re offline');
    expect(switchNamed('Email', channel('Email')).disabled || switchNamed('Email', channel('Email')).getAttribute('aria-disabled') === 'true').toBe(true);
  });
});

/* ---- Appearance ------------------------------------------------------------ */

describe('appearance', () => {
  it('offers Automatic, Light and Dark as pictures, and applies a choice at once on this device', async () => {
    await openProfile();
    const radios = [...section('appearance').querySelectorAll<HTMLElement>('[role="radio"]')];
    expect(radios.map((radio) => radio.querySelector('.itsm-Choice__label')?.textContent)).toEqual(['Automatic', 'Light', 'Dark']);
    expect(radios.every((radio) => radio.querySelector('.app-Swatch'))).toBe(true);
    expect(radios[0]?.getAttribute('aria-checked')).toBe('true');

    await clickAsync(radios[2]!);
    await settle();
    expect(JSON.parse(localStorage.getItem('itsm-prefs') ?? '{}')).toMatchObject({ appearance: 'dark' });
    expect(document.documentElement.getAttribute('data-itsm-theme')).toBe('apple-dark');

    await clickAsync(switchNamed('Increase contrast', section('appearance')));
    await settle();
    expect(JSON.parse(localStorage.getItem('itsm-prefs') ?? '{}')).toMatchObject({ contrast: 'more' });
    // Nothing to save to the server, so no toast.
    expect(notify).not.toHaveBeenCalled();
  });
});

/* ---- Devices ------------------------------------------------------------------ */

describe('devices', () => {
  const sessions: SessionRow[] = [
    { id: 's-old', device: null, ip: '10.0.0.1', lastSeenAt: '2026-09-20T10:00:00Z', expiresAt: '2026-10-20T10:00:00Z' },
    { id: 's-new', device: 'iPhone 16', ip: '10.0.0.2', lastSeenAt: '2026-09-30T09:00:00Z', expiresAt: '2026-10-30T10:00:00Z' },
  ];

  it('lists where you are signed in, most recent first, and signs one out after asking', async () => {
    serverApi.sessions.mockResolvedValue(sessions);
    await openProfile();
    const names = [...section('devices').querySelectorAll('.app-Devices__name')].map((node) => node.textContent);
    expect(names).toEqual(['iPhone 16', 'A browser']);
    // The address a session was recorded from is not the person's business here (it is the service's own).
    expect(section('devices').textContent).not.toContain('10.0.0');

    const signOut = section('devices').querySelectorAll<HTMLButtonElement>('.app-Devices__row button')[1]!;
    await clickAsync(signOut);
    await settle();
    const confirm = document.querySelector('[role="alertdialog"]')!;
    expect(confirm.textContent).toContain('Sign out of this session?');
    expect(confirm.textContent).toContain('If it’s the browser you’re using now, that includes you.');
    expect(browserApi.endSession).not.toHaveBeenCalled();

    const go = [...confirm.querySelectorAll('button')].find((node) => node.textContent?.trim() === 'Sign out session')!;
    await clickAsync(go);
    await settle();
    expect(browserApi.endSession).toHaveBeenCalledWith('s-old');
    expect([...section('devices').querySelectorAll('.app-Devices__name')].map((node) => node.textContent)).toEqual(['iPhone 16']);
    expect(notify).toHaveBeenCalledWith('Signed out of that session', expect.objectContaining({ tone: 'success' }));
  });

  it('treats a session that is already over as signed out', async () => {
    serverApi.sessions.mockResolvedValue(sessions);
    browserApi.endSession.mockRejectedValue(new ApiError(404, null, 'gone'));
    await openProfile();
    await clickAsync(section('devices').querySelectorAll<HTMLButtonElement>('.app-Devices__row button')[0]!);
    await settle();
    const confirm = document.querySelector('[role="alertdialog"]')!;
    await clickAsync([...confirm.querySelectorAll('button')].find((node) => node.textContent?.trim() === 'Sign out session')!);
    await settle();
    expect([...section('devices').querySelectorAll('.app-Devices__name')].map((node) => node.textContent)).toEqual(['A browser']);
  });

  it('needs a connection to sign anything out', async () => {
    serverApi.sessions.mockResolvedValue(sessions);
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    await openProfile();
    const signOut = section('devices').querySelector<HTMLButtonElement>('.app-Devices__row button')!;
    expect(signOut.getAttribute('aria-disabled')).toBe('true');
  });
});

/* ---- Styles -------------------------------------------------------------------- */

describe('the styles for the profile', () => {
  it('reference no variable the design system does not emit, and never restyle a design-system part on its own', () => {
    const defined = new Set([...Object.keys(structuralVariables()), ...Object.keys(themeVariables('apple'))]);
    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../profile/profile.css'), 'utf8');
    const used = [...new Set([...css.matchAll(/var\((--itsm-[a-zA-Z0-9-]+)/g)].map((match) => match[1]!))];
    expect(used.length).toBeGreaterThan(10);
    expect(used.filter((variable) => !defined.has(variable))).toEqual([]);
    expect(css).not.toMatch(/^\s*\.itsm-/m);
  });
});
