import type { IconName } from '@itsm/ui';

/**
 * A glyph for a service, and the Home page's guided tiles, from the words the
 * tenant used to name its services (SPEC §6.3, C §3.3, §3.5).
 *
 * The catalogue carries no icons — "per-item icons from data" is out of scope
 * this release (§7.5) — and a grid of identical squares reads as a list
 * somebody forgot to finish. The service's own name is the best evidence
 * there is: "Access & accounts" is about keys whatever the tenant is. A name
 * nothing here recognises gets the neutral grid, never a guess that could be
 * wrong in an embarrassing way.
 *
 * Matching is on whole words, case- and accent-insensitive, so "Apps" matches
 * *app* but "Happiness survey" does not, and "Équipement" matches
 * *equipement*.
 */

export interface ServiceTopic {
  readonly id: string;
  /** The Home tile's heading. */
  readonly label: string;
  readonly icon: IconName;
  /** Whole words (singular; a trailing "s" is also accepted). */
  readonly keywords: readonly string[];
}

/**
 * In priority order: the first topic with a matching word wins. The first two
 * are the Home page's guided tiles (Access & accounts · Devices & equipment).
 */
export const SERVICE_TOPICS: readonly ServiceTopic[] = [
  {
    id: 'access',
    label: 'Access & accounts',
    icon: 'key',
    keywords: ['access', 'account', 'login', 'log-in', 'password', 'permission', 'identity', 'sso', 'mfa', 'role'],
  },
  {
    id: 'devices',
    label: 'Devices & equipment',
    icon: 'assets',
    keywords: ['device', 'equipment', 'hardware', 'laptop', 'computer', 'desktop', 'monitor', 'peripheral', 'keyboard', 'mouse', 'headset', 'equipement'],
  },
  { id: 'mobile', label: 'Phones & mobile', icon: 'smartphone', keywords: ['phone', 'mobile', 'smartphone', 'sim', 'tablet'] },
  { id: 'software', label: 'Software & apps', icon: 'monitor', keywords: ['software', 'app', 'application', 'licence', 'license', 'install', 'subscription'] },
  { id: 'email', label: 'Email & calendar', icon: 'mail', keywords: ['email', 'e-mail', 'mail', 'mailbox', 'calendar', 'outlook'] },
  { id: 'network', label: 'Network & connectivity', icon: 'globe', keywords: ['network', 'vpn', 'wifi', 'wi-fi', 'internet', 'connectivity', 'remote'] },
  { id: 'security', label: 'Security', icon: 'security', keywords: ['security', 'phishing', 'virus', 'malware'] },
  { id: 'people', label: 'People & HR', icon: 'people', keywords: ['hr', 'people', 'onboarding', 'offboarding', 'joiner', 'leaver', 'starter', 'employee'] },
  { id: 'learning', label: 'Training', icon: 'knowledge', keywords: ['training', 'learning', 'course'] },
  { id: 'files', label: 'Files & printing', icon: 'file', keywords: ['file', 'storage', 'drive', 'share', 'print', 'printer', 'printing', 'document'] },
];

/** The glyph for a service nothing above recognises. */
export const DEFAULT_SERVICE_ICON: IconName = 'catalogue';

/** Lower case, accents folded, split into words. */
function wordsOf(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter(Boolean);
}

function mentions(words: readonly string[], keyword: string): boolean {
  return words.some((word) => word === keyword || word === `${keyword}s` || word === `${keyword}es`);
}

/** The first topic any of the texts is about (service name first, then summary), or null. */
export function topicFor(...texts: readonly (string | null | undefined)[]): ServiceTopic | null {
  for (const text of texts) {
    if (!text) continue;
    const words = wordsOf(text);
    const topic = SERVICE_TOPICS.find((candidate) => candidate.keywords.some((keyword) => mentions(words, keyword)));
    if (topic) return topic;
  }
  return null;
}

/** A service's (or item's) glyph: from its service name, then its own name and summary. */
export function serviceIcon(...texts: readonly (string | null | undefined)[]): IconName {
  return topicFor(...texts)?.icon ?? DEFAULT_SERVICE_ICON;
}

export interface ServiceRef {
  readonly key: string | null;
  readonly name: string;
}

/**
 * Where a Home tile for `topicId` leads: the first service about that topic
 * (`/catalogue#<serviceKey>`), or — when no service is — the catalogue
 * filtered by the topic's first word, so the tile is never a dead end.
 */
export function topicHref(topicId: string, services: readonly ServiceRef[]): string {
  const topic = SERVICE_TOPICS.find((candidate) => candidate.id === topicId);
  if (!topic) return '/catalogue';
  const service = services.find((candidate) => topicFor(candidate.name)?.id === topic.id && candidate.key);
  if (service?.key) return `/catalogue#${encodeURIComponent(service.key)}`;
  return `/catalogue?q=${encodeURIComponent(topic.keywords[0]!)}`;
}
