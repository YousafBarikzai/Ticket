import 'server-only';
import type { Admin, FlagRow, Me, ModuleRow, SettingRow } from '@itsm/sdk';
import type { Problem } from '@itsm/ui';
import { formatDateTime } from '@itsm/ui/format';
import { isPending, mayOpen, routeFor, tabsFor } from '../../../../navigation.js';
import { holds } from '../../../../permissions.js';
import { read } from '../../../../server/read.js';
import { resolvePeople } from '../../../../server/people.js';
import {
  TAB_HREFS,
  expiryText,
  flagEntry,
  isChanged,
  ownerText,
  searchIndex,
  settingEntry,
  type SearchEntry,
  type SettingsTabId,
} from '../../../../settings/catalogue.js';
import type { FlagItem, SettingItem, SettingsSearchState, TriageSummary } from '../../../../components/settings/types.js';
import type { ModuleView } from '../../../../components/settings/ModulesView.js';
import { AI_FLAG } from '../../../../settings/catalogue.js';
import { MODE_LABELS, MODE_SENTENCES, asMode } from '../../../../triage.js';

/**
 * What the Settings tabs share (SPEC §6.1 `/settings/**`): the tabs, the one
 * read of settings and flags every searchable tab makes, the rows as plain
 * JSON for the client views, and the search's starting state from the URL.
 *
 * Dates are written here, on the server, in the reader's locale and zone, and
 * sent as text: a date formatted again in the browser can differ from the
 * server's by a comma (ICU versions), which React reports as a mismatch.
 */

export function settingsTabs(me: Me) {
  return tabsFor(me, 'settings');
}

/** A link to a page this person may open and that exists, or undefined. */
export function reachable(me: Me, href: string): string | undefined {
  const route = routeFor(href);
  return route !== null && !isPending(route) && mayOpen(me, route) ? href : undefined;
}

/** The searchable tabs this person may open, for "Also on other tabs". */
export function searchableTabs(me: Me): SettingsTabId[] {
  return (['general', 'features', 'ai'] as const).filter((tab) => reachable(me, TAB_HREFS[tab]) !== undefined);
}

export function searchState(params: Record<string, string | string[] | undefined>): SettingsSearchState {
  const q = typeof params.q === 'string' ? params.q.slice(0, 200) : '';
  return { query: q, changedOnly: params.changed === '1' };
}

function changedNote(row: SettingRow, people: ReadonlyMap<string, { readonly name: string | null }>, me: Me): string | null {
  if (!isChanged(row.value, row.default)) return null;
  if (row.source === 'organisation') return 'Set for your organisation';
  if (!row.publishedAt) return null;
  const when = formatDateTime(row.publishedAt, { locale: me.locale, timeZone: me.timeZone, style: 'date' });
  const who = row.publishedBy ? people.get(row.publishedBy)?.name : null;
  return who ? `Changed by ${who} · ${when}` : `Changed ${when}`;
}

export function settingItem(row: SettingRow, people: ReadonlyMap<string, { readonly name: string | null }>, me: Me): SettingItem {
  const entry = settingEntry(row.key);
  return {
    key: row.key,
    label: entry.label,
    description: entry.description ?? row.description ?? '',
    group: entry.group,
    type: row.type ?? { kind: 'json' },
    value: row.value,
    default: row.default,
    changed: isChanged(row.value, row.default),
    note: changedNote(row, people, me),
    // A value set for one of the person's organisations shadows the desk's:
    // a change here would not change what they see, so the row says so and
    // offers no control (organisation scopes are out of scope, SPEC §7.5).
    locked: row.source === 'organisation',
  };
}

export function flagItem(row: FlagRow): FlagItem {
  const entry = flagEntry(row.key, row.module);
  return {
    key: row.key,
    label: entry.label,
    description: entry.description ?? row.description ?? '',
    group: entry.group,
    value: row.value,
    default: row.default,
    owner: ownerText(row.owner),
    expiry: expiryText(row.expires),
    changed: row.value !== row.default,
  };
}

export interface SettingsData {
  readonly settings: readonly SettingItem[] | null;
  readonly flags: readonly FlagItem[] | null;
  readonly settingsProblem?: Problem;
  readonly flagsProblem?: Problem;
  /** Every setting and flag in words, for the search across tabs. */
  readonly index: readonly SearchEntry[];
}

/**
 * Settings and flags in one go, with the names of the people who last changed
 * a setting. Each read fails on its own: a page that could not read flags
 * still shows the settings.
 */
export async function loadSettings(me: Me, api: Admin, want: { readonly settings: boolean; readonly flags: boolean }): Promise<SettingsData> {
  const [settings, flags] = await Promise.all([
    want.settings ? read(() => api.tenant.settings()) : Promise.resolve(null),
    want.flags ? read(() => api.tenant.flags()) : Promise.resolve(null),
  ]);
  const settingRows = settings?.ok ? settings.value : [];
  const flagRows = flags?.ok ? flags.value : [];
  const publishers = settingRows.filter((row) => isChanged(row.value, row.default)).map((row) => row.publishedBy);
  const people = publishers.some(Boolean) && holds(me, 'identity.user.read') ? await resolvePeople(api, publishers) : new Map();
  return {
    settings: settings?.ok ? settingRows.map((row) => settingItem(row, people, me)) : null,
    flags: flags?.ok ? flagRows.map(flagItem) : null,
    ...(settings && !settings.ok ? { settingsProblem: settings.problem } : {}),
    ...(flags && !flags.ok ? { flagsProblem: flags.problem } : {}),
    index: searchIndex(settingRows, flagRows),
  };
}

const TRIAGE_FLAG = 'ai.decision.triage';
const MODE_SETTING = 'ai.decision.triage.mode';

/**
 * Where triage is, in words: what the three switches behind it add up to
 * (the workspace's AI, the triage switch and the mode), with the sentence
 * that says what that means for agents.
 */
export function triageSummary(flags: readonly FlagItem[] | null, settings: readonly SettingItem[] | null, href: string | undefined): TriageSummary | null {
  const mode = settings?.find((item) => item.key === MODE_SETTING);
  if (!mode) return null;
  const aiOn = flags?.find((flag) => flag.key === AI_FLAG)?.value !== false;
  const triageOn = flags?.find((flag) => flag.key === TRIAGE_FLAG)?.value !== false;
  const link = href ? { href } : {};
  if (!aiOn) return { label: 'Off', tone: 'neutral', sentence: 'AI is off for this workspace, so triage sends nothing anywhere.', ...link };
  const stored = asMode(mode.value);
  if (!triageOn || stored === 'off') return { label: MODE_LABELS.off, tone: 'neutral', sentence: MODE_SENTENCES.off, ...link };
  return { label: MODE_LABELS[stored], tone: stored === 'shadow' ? 'info' : 'success', sentence: MODE_SENTENCES[stored], ...link };
}


/** Installed modules as rows: which others are built on each, and which it needs that are off. */
export function moduleViews(rows: readonly ModuleRow[]): ModuleView[] {
  const byId = new Map(rows.map((row) => [row.moduleId, row]));
  const name = (id: string): string => byId.get(id)?.name ?? id;
  return [...rows]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((row) => ({
      id: row.moduleId,
      name: row.name,
      enabled: row.enabled,
      optional: row.optional,
      // The API refuses to turn a module off while any installed module is built on it, on or off.
      neededBy: rows.filter((other) => other.dependsOn.includes(row.moduleId)).map((other) => other.name),
      needsOff: row.dependsOn.filter((id) => byId.get(id)?.enabled === false).map(name),
    }));
}
