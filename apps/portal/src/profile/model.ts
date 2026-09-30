import type { Me, NotificationPreference, NotificationPreferenceInput, SessionRow } from '@itsm/sdk';
import type { IconName } from '@itsm/ui';

/**
 * The rules behind the Profile page (SPEC §6.3 `/profile`, F40), as data:
 * who this person is in words — a language's name rather than `en-GB`, a
 * place and an offset rather than `Europe/London`, organisations by name —
 * how they are told about things, and the sessions they are signed in with.
 * Pure, so each rule is tested without rendering; free of components, so the
 * server page pays nothing for it in the browser.
 *
 * Nothing here shows a permission key. What a person may do is the product's
 * business to express through what it offers them, not a list of codes.
 */

/* ---------------------------------------------------------------- Account */

/** "British English" for `en-GB`, in the person's own language; the code itself only when the platform cannot name it. */
export function languageName(locale: string, displayLocale: string = locale): string {
  try {
    const name = new Intl.DisplayNames([displayLocale, 'en-GB'], { type: 'language' }).of(locale);
    if (name && name !== locale) return name.charAt(0).toLocaleUpperCase(displayLocale) + name.slice(1);
  } catch {
    // An identifier the platform cannot read: say what it is rather than nothing.
  }
  return locale;
}

/** "London" for `Europe/London`, "Buenos Aires" for `America/Argentina/Buenos_Aires`, "UTC" for `UTC`. */
export function zonePlace(timeZone: string): string {
  const last = timeZone.split('/').at(-1) ?? timeZone;
  return last.replace(/_/g, ' ').trim() || timeZone;
}

function zonePart(timeZone: string, at: Date, locale: string, style: 'shortOffset' | 'long'): string | null {
  try {
    const parts = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: style }).formatToParts(at);
    return parts.find((part) => part.type === 'timeZoneName')?.value ?? null;
  } catch {
    return null;
  }
}

/** "GMT+1", "GMT−5:30" — the offset now, which moves with summer time. */
export function zoneOffset(timeZone: string, at: Date, locale = 'en-GB'): string | null {
  const offset = zonePart(timeZone, at, locale, 'shortOffset');
  // Some platforms write Greenwich itself as "GMT+0"; people write "GMT".
  return offset ? offset.replace(/^(GMT|UTC)[+\u2212-]0(?::00)?$/, '$1') : null;
}

/** The time there now, as the person's locale writes it. */
export function zoneTime(timeZone: string, at: Date, locale: string): string | null {
  try {
    return new Intl.DateTimeFormat(locale, { timeZone, hour: 'numeric', minute: '2-digit' }).format(at);
  } catch {
    return null;
  }
}

/**
 * "London (GMT+1)" and "14:32 now" (SPEC §6.3): the zone as a place and an
 * offset, never an identifier, and the time there so a mismatch is obvious.
 * An identifier the platform does not know is shown as it is.
 */
export function zoneWords(timeZone: string, at: Date, locale: string): { readonly place: string; readonly now: string | null; readonly long: string | null } {
  const offset = zoneOffset(timeZone, at, locale);
  if (offset === null) return { place: timeZone, now: null, long: null };
  const place = zonePlace(timeZone);
  const time = zoneTime(timeZone, at, locale);
  const long = zonePart(timeZone, at, locale, 'long');
  return { place: `${place} (${offset})`, now: time ? `${time} now` : null, long: long && long !== offset ? long : null };
}

/**
 * Each organisation by name, with the ones above it that the person also
 * belongs to ("Acme › IT › Service desk"). Paths are materialised codes
 * (`/acme/it/desk`), so an ancestor's name is only known when it is one of
 * theirs; a code is never shown in its place.
 */
export function organisationLines(organisations: Me['organisations']): string[] {
  const byPath = new Map(organisations.map((organisation) => [organisation.path, organisation.name]));
  // The deepest first would read backwards; the list keeps the API's order, leaves only.
  const leaves = organisations.filter(
    (organisation) => !organisations.some((other) => other !== organisation && other.path.startsWith(`${organisation.path}/`)),
  );
  return leaves.map((organisation) => {
    const segments = organisation.path.split('/').filter(Boolean);
    const names: string[] = [];
    for (let depth = 1; depth < segments.length; depth += 1) {
      const name = byPath.get(`/${segments.slice(0, depth).join('/')}`);
      if (name) names.push(name);
    }
    names.push(organisation.name);
    return names.join(' › ');
  });
}

/* ---------------------------------------------------------- Notifications */

export type Channel = 'inapp' | 'email';
export type DigestMode = 'immediate' | 'hourly' | 'daily';

export interface ChannelSetting {
  readonly enabled: boolean;
  readonly digestMode: DigestMode;
  readonly quietHours: { readonly start: string; readonly end: string } | null;
}

/**
 * The channels a person can switch, and only those: the worker has a
 * transport for the bell and for email and none for push or SMS, so a switch
 * for those would save, answer 200 and deliver nothing.
 */
export const CHANNELS: readonly { readonly channel: Channel; readonly label: string; readonly description: string; readonly icon: IconName }[] = [
  { channel: 'inapp', label: 'In the portal', description: 'Shows in the bell at the top.', icon: 'bell' },
  { channel: 'email', label: 'Email', description: 'Sent to the address your organisation holds for you.', icon: 'mail' },
];

export const DIGEST_OPTIONS: readonly { readonly value: DigestMode; readonly label: string }[] = [
  { value: 'immediate', label: 'As it happens' },
  { value: 'hourly', label: 'Once an hour, together' },
  { value: 'daily', label: 'Once a day, together' },
];

/** The schema's own defaults, for a channel the person has never set. */
export const DEFAULT_SETTING: ChannelSetting = { enabled: true, digestMode: 'immediate', quietHours: null };

/** A new quiet window starts as an evening and a night. */
export const DEFAULT_QUIET = { start: '18:00', end: '08:00' } as const;

function digestOf(value: string): DigestMode {
  return value === 'hourly' || value === 'daily' ? value : 'immediate';
}

export function settingsOf(preferences: readonly NotificationPreference[]): Record<Channel, ChannelSetting> {
  const out: Record<Channel, ChannelSetting> = { inapp: DEFAULT_SETTING, email: DEFAULT_SETTING };
  for (const preference of preferences) {
    if (preference.channel !== 'inapp' && preference.channel !== 'email') continue;
    out[preference.channel] = {
      enabled: preference.enabled,
      digestMode: digestOf(preference.digestMode),
      quietHours: preference.quietHours,
    };
  }
  return out;
}

/**
 * The whole record, every time. The API defaults whatever is missing
 * (`enabled` true, `digestMode` immediate), so a body carrying only the quiet
 * hours would switch a muted channel back on and flatten a daily summary —
 * and answer 200.
 */
export function inputFor(channel: Channel, setting: ChannelSetting): NotificationPreferenceInput {
  return { channel, enabled: setting.enabled, digestMode: setting.digestMode, quietHours: setting.quietHours };
}

/** Channels set on the account that this deployment cannot send on: kept, and said so, never switched here. */
export function otherChannels(preferences: readonly NotificationPreference[]): string[] {
  const names: Record<string, string> = { push: 'Push notifications', sms: 'Text messages' };
  return preferences
    .filter((preference) => preference.channel !== 'inapp' && preference.channel !== 'email')
    .map((preference) => names[preference.channel] ?? preference.channel);
}

const TIME = /^([01]?\d|2[0-3]):[0-5]\d$/;

/** Both ends, each a real time of day, and not the same: half a window, or none, is not a window. */
export function validQuietHours(start: string | null, end: string | null): boolean {
  return start !== null && end !== null && TIME.test(start) && TIME.test(end) && start !== end;
}

/* ---------------------------------------------------------------- Devices */

/**
 * A session as a person recognises it. The API records a device name only
 * when there is one to record, and the browser's own description is not
 * passed on, so most read simply "A browser"; which is which is told by
 * when it was last used.
 */
export function sessionLabel(session: Pick<SessionRow, 'device'>): { readonly label: string; readonly icon: IconName } {
  const device = session.device?.trim();
  if (!device) return { label: 'A browser', icon: 'monitor' };
  const phone = /iphone|android|mobile|ipad|phone|tablet/i.test(device);
  return { label: device, icon: phone ? 'smartphone' : 'monitor' };
}

/** Most recently used first. */
export function sessionsInOrder(sessions: readonly SessionRow[]): SessionRow[] {
  return [...sessions].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}

/* ---------------------------------------------------------------- Sections */

export interface ProfileSection {
  readonly id: string;
  readonly label: string;
}

/** The page's sections, in order, for the anchor list beside them on a wide screen. */
export function sectionsFor(options: { readonly approvals: boolean; readonly devices: boolean }): ProfileSection[] {
  return [
    { id: 'account', label: 'Account' },
    ...(options.approvals ? [{ id: 'approvals', label: 'Approvals' }] : []),
    { id: 'notifications', label: 'Notifications' },
    { id: 'appearance', label: 'Appearance' },
    ...(options.devices ? [{ id: 'devices', label: 'Devices' }] : []),
  ];
}
