'use client';

import { useMemo, useSyncExternalStore } from 'react';
import type { FlagRow, SettingRow } from '@itsm/sdk';
import { notify, type IconName } from '@itsm/ui';
import { setShortcutsDialogOpen, type CommandItem, type CommandProvider } from '@itsm/ui/shell';
import { useTheme } from '@itsm/ui/theme';
import { createCommandsFor, isPending, visibleNav, visibleTabs } from '../navigation.js';
import { holdsAny, type Grants } from '../permissions.js';
import { TAB_LABELS, flagEntry, hrefFor, sectionTitle, settingEntry, tabOfFlag, tabOfSetting } from '../settings/catalogue.js';
import { api } from './api.js';
import { signOut } from './sign-out.js';

/**
 * The console's command palette: ⌘K / Ctrl K from anywhere, inside text
 * fields too (SPEC §5.5, D14).
 *
 * Four groups, in the order people reach for them:
 *
 *   - **Go to** — every page this person may open, and each page's tabs, by
 *     name or by the words people use for them ("queues" finds Workforce,
 *     "flags" finds Settings › Features, "SLA" finds Service levels). Built
 *     from `navigation.ts`, so the palette cannot offer a page the sidebar
 *     hides.
 *   - **Create** — "New rule", "Add person"…, each only for people who hold
 *     the write permission, opening the right page with `?new=…`.
 *   - **Find** — tickets, people, rules, workflows, fields, forms, services,
 *     request types and settings, searched as the person types (200 ms). Lists
 *     are fetched once and kept for a minute, so typing does not become a
 *     request per keystroke.
 *   - **Actions** — appearance, contrast, density, technical keys, the
 *     sidebar, copy link, the setup checklist, keyboard shortcuts, sign out.
 *
 * Nothing typed matches → "Search tickets for 'vpn'", never a dead end.
 */

/* -------------------------------------------------------------------------
 * Open and closed, from anywhere (⌘K, the search field, a 404's "Search")
 * ---------------------------------------------------------------------- */

let paletteOpen = false;
const listeners = new Set<() => void>();

export function setCommandPaletteOpen(open: boolean): void {
  if (paletteOpen === open) return;
  paletteOpen = open;
  for (const listener of [...listeners]) listener();
}

/** Opens the palette from anywhere in the frame — a not-found page's *Search*, for one. */
export function openCommandPalette(): void {
  setCommandPaletteOpen(true);
}

export function useCommandPaletteOpen(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => paletteOpen,
    () => false,
  );
}

/* -------------------------------------------------------------------------
 * Lists fetched once per minute
 * ---------------------------------------------------------------------- */

const LIST_TTL_MS = 60_000;
const lists = new Map<string, { readonly at: number; readonly value: Promise<readonly unknown[]> }>();

/** A list for type-ahead, fetched at most once a minute; a failure is forgotten so the next keystroke tries again. */
function cachedList<T>(name: string, load: () => Promise<readonly T[]>): Promise<readonly T[]> {
  const hit = lists.get(name);
  if (hit && Date.now() - hit.at < LIST_TTL_MS) return hit.value as Promise<readonly T[]>;
  const value = load().catch((error: unknown) => {
    lists.delete(name);
    throw error;
  });
  lists.set(name, { at: Date.now(), value });
  return value;
}

/** Forget the cached lists — after a write, say, or in a test. */
export function forgetPaletteLists(): void {
  lists.clear();
}

/** Case- and accent-insensitive, the way people type. */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/** Rows whose name, key or description holds every word of `query`, best (name starts with it) first. */
export function findIn<T>(rows: readonly T[], query: string, fields: (row: T) => readonly (string | null | undefined)[], limit = 5): T[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const scored: { row: T; score: number }[] = [];
  for (const row of rows) {
    const values = fields(row).filter((value): value is string => typeof value === 'string' && value !== '').map(fold);
    const haystack = values.join(' ');
    if (!words.every((word) => haystack.includes(word))) continue;
    const first = values[0] ?? '';
    scored.push({ row, score: first.startsWith(words.join(' ')) ? 0 : first.includes(words[0]!) ? 1 : 2 });
  }
  return scored.sort((a, b) => a.score - b.score).slice(0, limit).map((entry) => entry.row);
}

/** A detail page when it exists, otherwise its list with the drawer open. */
function detailHref(pattern: string, key: string, listHref: string, kind: string): string {
  const encoded = encodeURIComponent(key);
  return isPending(pattern) ? `${listHref}?open=${kind}:${encoded}` : pattern.replace(/\[[^\]]+\]/, encoded);
}

/**
 * Settings and features matching `query`, named and placed as Settings names
 * them: the catalogue's label ("Default priority", not the module's note),
 * the tab that lists it, and a link that opens that tab filtered by the same
 * words with the row as the fragment (it scrolls to the row and focuses its
 * control). Pure, and tested.
 */
export function findSettings(
  settings: readonly Pick<SettingRow, 'key' | 'description'>[],
  flags: readonly Pick<FlagRow, 'key' | 'module' | 'description' | 'value'>[],
  query: string,
): CommandItem[] {
  const settingHits = findIn(settings, query, (setting) => {
    const entry = settingEntry(setting.key);
    return [entry.label, setting.key, entry.description ?? setting.description, sectionTitle(entry.group)];
  }).map((setting) => {
    const tab = tabOfSetting(setting.key);
    return {
      id: `setting-${setting.key}`,
      label: settingEntry(setting.key).label,
      description: `Setting · ${TAB_LABELS[tab]}`,
      icon: 'settings' as const,
      href: hrefFor({ kind: 'setting', key: setting.key, tab }, query),
    };
  });
  const flagHits = findIn(flags, query, (flag) => {
    const entry = flagEntry(flag.key, flag.module);
    return [entry.label, flag.key, entry.description ?? flag.description];
  }).map((flag) => ({
    id: `flag-${flag.key}`,
    label: flagEntry(flag.key, flag.module).label,
    description: `Feature · ${flag.value ? 'On' : 'Off'}`,
    icon: 'settings' as const,
    href: hrefFor({ kind: 'flag', key: flag.key, tab: tabOfFlag() }, query),
  }));
  return [...settingHits, ...flagHits].slice(0, 6);
}

interface FindSource {
  readonly id: string;
  readonly read: readonly string[];
  readonly icon: IconName;
  search(query: string): Promise<CommandItem[]>;
}

const FIND_SOURCES: readonly FindSource[] = [
  {
    id: 'tickets',
    read: ['ticket.read'],
    icon: 'ticket',
    async search(query) {
      const page = await api.observe.tickets({ q: query, limit: 5 });
      return page.data.map((ticket) => ({
        id: `ticket-${ticket.id}`,
        label: `${ticket.number} · ${ticket.title}`,
        icon: 'ticket',
        meta: ticket.status.replace(/_/g, ' '),
        href: `/tickets?open=ticket:${encodeURIComponent(ticket.number)}`,
      }));
    },
  },
  {
    id: 'people',
    read: ['identity.user.read', 'identity.user.manage'],
    icon: 'user',
    async search(query) {
      const people = await api.tenant.users({ q: query, limit: 5 });
      return people.map((person) => ({
        id: `person-${person.id}`,
        label: person.displayName,
        description: person.email,
        icon: 'user',
        href: `/people?open=person:${encodeURIComponent(person.id)}`,
      }));
    },
  },
  {
    id: 'rules',
    read: ['rules.rule.read', 'rules.rule.manage', 'rules.rule.publish'],
    icon: 'automation',
    async search(query) {
      const rules = await cachedList('rules', () => api.configure.rules.list());
      return findIn(rules, query, (rule) => [rule.name, rule.key, rule.description]).map((rule) => ({
        id: `rule-${rule.id}`,
        label: rule.name,
        description: 'Rule',
        icon: 'automation',
        href: detailHref('/rules/[key]', rule.key, '/rules', 'rule'),
      }));
    },
  },
  {
    id: 'workflows',
    read: ['workflow.read', 'workflow.manage'],
    icon: 'workflow',
    async search(query) {
      const workflows = await cachedList('workflows', () => api.configure.workflows.list());
      return findIn(workflows, query, (flow) => [flow.name, flow.key, flow.description]).map((flow) => ({
        id: `workflow-${flow.id}`,
        label: flow.name,
        description: 'Workflow',
        icon: 'workflow',
        href: detailHref('/workflows/[key]', flow.key, '/workflows', 'workflow'),
      }));
    },
  },
  {
    id: 'fields',
    read: ['ticket.config.manage'],
    icon: 'fields',
    async search(query) {
      const fields = await cachedList('fields', () => api.tenant.fields());
      return findIn(fields, query, (field) => [field.label, field.key]).map((field) => ({
        id: `field-${field.id}`,
        label: field.label,
        description: 'Ticket field',
        icon: 'fields',
        href: `/fields?open=field:${encodeURIComponent(field.key)}`,
      }));
    },
  },
  {
    id: 'forms',
    read: ['catalogue.form.read', 'catalogue.form.manage'],
    icon: 'forms',
    async search(query) {
      const forms = await cachedList('forms', () => api.configure.catalogue.forms());
      return findIn(forms, query, (form) => [form.name, form.key, form.description]).map((form) => ({
        id: `form-${form.id}`,
        label: form.name,
        description: 'Form',
        icon: 'forms',
        href: detailHref('/catalogue/forms/[key]', form.key, '/catalogue', 'form'),
      }));
    },
  },
  {
    id: 'services',
    read: ['catalogue.manage'],
    icon: 'catalogue',
    async search(query) {
      const [services, types] = await Promise.all([
        cachedList('services', () => api.configure.catalogue.services()),
        cachedList('request-types', () => api.configure.catalogue.requestTypes()),
      ]);
      const serviceHits = findIn(services, query, (service) => [service.name, service.key, service.description]).map((service) => ({
        id: `service-${service.id}`,
        label: service.name,
        description: 'Service',
        icon: 'catalogue' as const,
        href: `/catalogue?open=service:${encodeURIComponent(service.key)}`,
      }));
      const typeHits = findIn(types, query, (type) => [type.name, type.key, type.description, type.shortSummary]).map((type) => ({
        id: `request-type-${type.id}`,
        label: type.name,
        description: 'Request type',
        icon: 'catalogue' as const,
        href: `/catalogue?open=request-type:${encodeURIComponent(type.key)}`,
      }));
      return [...serviceHits, ...typeHits].slice(0, 6);
    },
  },
  {
    id: 'settings',
    read: ['admin.setting.read'],
    icon: 'settings',
    async search(query) {
      // MOD-13-E1-S1: an administrator finds a setting — or a feature — by its name, its key or what it
      // does, read the way Settings reads it (the catalogue's label, its section), and lands on the tab
      // that lists it with the words kept and the row as the fragment, so AI settings open on AI and a
      // feature on Features. Flags are asked for on their own: a refusal there leaves the settings.
      const [settings, flags] = await Promise.all([
        cachedList('settings', () => api.tenant.settings()),
        cachedList('flags', () => api.tenant.flags()).catch(() => []),
      ]);
      return findSettings(settings, flags, query);
    },
  },
];

/* -------------------------------------------------------------------------
 * The registry
 * ---------------------------------------------------------------------- */

/** The static part: Go to and Create for this person. Pure, and tested. */
export function goToCommands(grants: Grants): CommandItem[] {
  const items: CommandItem[] = [];
  for (const item of visibleNav(grants)) {
    items.push({
      id: `go-${item.id}`,
      label: item.label,
      description: item.description,
      icon: item.icon,
      href: item.href,
      ...(item.keywords ? { keywords: item.keywords } : {}),
      ...(item.shortcut ? { shortcut: item.shortcut } : {}),
    });
    const tabs = visibleTabs(grants, item);
    for (const entry of tabs.slice(1)) {
      items.push({
        id: `go-${item.id}-${entry.id}`,
        label: `${item.label} › ${entry.label}`,
        icon: item.icon,
        href: entry.href,
        keywords: [entry.label, ...(entry.keywords ?? [])],
      });
    }
  }
  return items;
}

export function createCommands(grants: Grants): CommandItem[] {
  return createCommandsFor(grants).map((command) => ({
    id: command.id,
    label: command.label,
    icon: command.icon,
    href: command.href,
    ...(command.keywords ? { keywords: [...command.keywords, 'create', 'add', 'new'] } : { keywords: ['create', 'add', 'new'] }),
  }));
}

async function copyLink(): Promise<void> {
  try {
    await navigator.clipboard.writeText(window.location.href);
    notify('Link copied', { tone: 'success' });
  } catch {
    notify('Couldn’t copy the link', { tone: 'warning', description: 'Copy it from the address bar instead.' });
  }
}

export interface AdminPalette {
  readonly providers: readonly CommandProvider[];
  fallback(query: string): CommandItem | null;
}

/** The palette's providers for this person, rebuilt when their permissions or preferences change. */
export function useAdminPalette(grants: Grants): AdminPalette {
  const { prefs, setPrefs, resolvedTheme } = useTheme();
  const permissionsKey = grants.permissions.map((permission) => permission.key).join(',');

  return useMemo<AdminPalette>(() => {
    const contrastOn = prefs.contrast === 'more' || (prefs.contrast === 'system' && resolvedTheme.startsWith('high-contrast'));
    const actions: CommandItem[] = [
      {
        id: 'appearance',
        label: 'Appearance…',
        icon: 'sun',
        keywords: ['theme', 'dark mode', 'light mode'],
        children: () => [
          { id: 'appearance-system', label: 'Appearance: Automatic', icon: 'monitor', run: () => setPrefs({ appearance: 'system' }) },
          { id: 'appearance-light', label: 'Appearance: Light', icon: 'sun', run: () => setPrefs({ appearance: 'light' }) },
          { id: 'appearance-dark', label: 'Appearance: Dark', icon: 'moon', run: () => setPrefs({ appearance: 'dark' }) },
        ],
      },
      {
        id: 'contrast',
        label: contrastOn ? 'Turn off increased contrast' : 'Increase contrast',
        icon: 'contrast',
        keywords: ['accessibility', 'high contrast'],
        run: () => setPrefs({ contrast: contrastOn ? 'standard' : 'more' }),
      },
      {
        id: 'density',
        label: prefs.density === 'compact' ? 'Density: Comfortable' : 'Density: Compact',
        icon: 'rows-3',
        keywords: ['spacing', 'rows'],
        run: () => setPrefs({ density: prefs.density === 'compact' ? 'comfortable' : 'compact' }),
      },
      {
        id: 'technical-keys',
        label: prefs.showKeys ? 'Hide technical keys' : 'Show technical keys',
        icon: 'key',
        keywords: ['permission keys', 'setting keys', 'developer'],
        run: () => setPrefs({ showKeys: !prefs.showKeys }),
      },
      {
        id: 'sidebar',
        label: prefs.nav === 'rail' ? 'Expand sidebar' : 'Collapse sidebar',
        icon: 'panel-left',
        shortcut: '[',
        run: () => setPrefs({ nav: prefs.nav === 'rail' ? 'auto' : 'rail' }),
      },
      { id: 'copy-link', label: 'Copy link to this page', icon: 'link', run: copyLink },
      { id: 'setup', label: 'Setup checklist', icon: 'circle-check', keywords: ['getting started', 'first run'], href: '/?setup=1' },
      {
        id: 'shortcuts',
        label: 'Keyboard shortcuts',
        icon: 'keyboard',
        shortcut: '?',
        run: () => {
          setShortcutsDialogOpen(true);
        },
      },
      { id: 'sign-out', label: 'Sign out', icon: 'log-out', keywords: ['log out'], run: signOut },
    ];

    const providers: CommandProvider[] = [
      { id: 'go', group: 'Go to', items: goToCommands(grants) },
      { id: 'create', group: 'Create', items: createCommands(grants) },
      ...FIND_SOURCES.filter((source) => holdsAny(grants, source.read)).map<CommandProvider>((source) => ({
        id: `find-${source.id}`,
        group: 'Find',
        minQuery: 2,
        debounceMs: 200,
        limit: 6,
        ...(source.id === 'tickets' ? { match: /^[a-z]{2,5}-?\d{1,9}$/i } : {}),
        search: (query) => source.search(query),
      })),
      { id: 'actions', group: 'Actions', items: actions },
    ];

    const canSearchTickets = holdsAny(grants, ['ticket.read']);
    return {
      providers,
      fallback: (query) =>
        canSearchTickets && query.trim() !== ''
          ? { id: 'search-tickets', label: `Search tickets for “${query.trim()}”`, icon: 'search', href: `/tickets?q=${encodeURIComponent(query.trim())}` }
          : null,
    };
    // Rebuilt on the permission *content*, not the array's identity.
  }, [permissionsKey, prefs, resolvedTheme, setPrefs]);
}
