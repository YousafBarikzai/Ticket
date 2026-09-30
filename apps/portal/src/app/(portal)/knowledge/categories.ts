import type { ArticleSummary } from '@itsm/sdk';
import { asRichBlocks } from '@itsm/ui';
import { formatDateTime } from '@itsm/ui/format';

/**
 * Knowledge, as the portal arranges it (SPEC §6.3 `/knowledge`): pure rules,
 * no data access, so the pages and their tests share them.
 */

/* ------------------------------------------------------------- Categories */

export interface KnowledgeCategory {
  /** The key the API filters by (`?category=how-to`). */
  readonly key: string;
  /** What a chip and a breadcrumb say. */
  readonly label: string;
}

/**
 * The categories a requester browses by, in order. The keys are the ones
 * every tenant's knowledge base starts with (MOD-09 seed); the labels are
 * short enough for a chip. `runbooks` is left out: it is the service desk's
 * own shelf, not somewhere a requester goes looking.
 */
export const CATEGORIES: readonly KnowledgeCategory[] = [
  { key: 'how-to', label: 'How-to' },
  { key: 'troubleshooting', label: 'Troubleshooting' },
  { key: 'policies', label: 'Policies' },
];

/** The category a `?category=` names, or null for anything else (a runbook, a typo, an old link). */
export function categoryFor(key: string | string[] | undefined): KnowledgeCategory | null {
  const value = Array.isArray(key) ? key[0] : key;
  return CATEGORIES.find((category) => category.key === value) ?? null;
}

export function categoryHref(category: KnowledgeCategory): string {
  return `/knowledge?category=${encodeURIComponent(category.key)}`;
}

/** The words searched for, tidied: one value, trimmed, at most 200 characters (the API's limit). */
export function queryOf(raw: string | string[] | undefined): string {
  return (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, 200) ?? '';
}

/* ------------------------------------------------------------------ Lists */

/** How many a browse list shows, and the fewest that make "Popular" worth a heading. */
export const LIST_LIMIT = 6;
export const POPULAR_MINIMUM = 3;

/** Most read first; hidden (empty) below three, where "popular" would be a stretch. Articles nobody has read are not popular. */
export function popularOf(articles: readonly ArticleSummary[]): ArticleSummary[] {
  const read = articles.filter((article) => article.viewCount > 0);
  if (read.length < POPULAR_MINIMUM) return [];
  return [...read].sort((a, b) => b.viewCount - a.viewCount || a.title.localeCompare(b.title, 'en-GB')).slice(0, LIST_LIMIT);
}

/**
 * When an article came out, for a reader. `publishedAt`, not `updatedAt`:
 * the API moves `updatedAt` whenever the row is touched — every read counts
 * a view, every rating counts a vote — so "updated" would mean "read".
 * `publishedAt` is when it was first published, which is at least true.
 */
export function publishedOf(article: Pick<ArticleSummary, 'publishedAt' | 'updatedAt'>): string {
  return article.publishedAt ?? article.updatedAt;
}

/** Newest first (by publication; see `publishedOf`). */
export function recentOf(articles: readonly ArticleSummary[]): ArticleSummary[] {
  return [...articles].sort((a, b) => Date.parse(publishedOf(b)) - Date.parse(publishedOf(a))).slice(0, LIST_LIMIT);
}

/** A category's shelf: most read first, then by title, all of them. */
export function shelfOf(articles: readonly ArticleSummary[]): ArticleSummary[] {
  return [...articles].sort((a, b) => b.viewCount - a.viewCount || a.title.localeCompare(b.title, 'en-GB'));
}

/** "More in How-to": up to three others from the article's category, most read first. */
export function moreIn(articles: readonly ArticleSummary[], currentKey: string): ArticleSummary[] {
  return shelfOf(articles.filter((article) => article.key !== currentKey)).slice(0, 3);
}

export function articleHrefFor(key: string): string {
  return `/knowledge/${encodeURIComponent(key)}`;
}

/* --------------------------------------------------------------- Reading */

/** The article's words, as a reader meets them (the rich blocks' text; anything else is not read). */
export function plainTextOf(body: unknown): string {
  const runs: string[] = [];
  for (const block of asRichBlocks(body)) {
    if (block.type === 'paragraph') runs.push(block.content.map((run) => run.text).join(''));
    else runs.push(...block.items.map((item) => item.map((run) => run.text).join('')));
  }
  return runs.join(' ');
}

/** Words a person reads in a minute, for "4 min read" — a common, conservative figure for on-screen reading. */
const WORDS_PER_MINUTE = 200;

/** "4 min read", never less than a minute. */
export function readingTime(body: unknown): string {
  const words = plainTextOf(body).split(/\s+/).filter(Boolean).length;
  return `${Math.max(1, Math.round(words / WORDS_PER_MINUTE))} min read`;
}

/**
 * A day as a reader wants it: "3 Sept" within this year, "3 Sept 2025"
 * before it — in their own zone and locale.
 */
export function dayOf(iso: string, reader: { readonly locale: string; readonly timeZone: string }, now: Date = new Date()): string {
  if (Number.isNaN(Date.parse(iso))) return '';
  const year = (value: string | Date): string => formatDateTime(value, { locale: 'en-GB', timeZone: reader.timeZone, style: 'date' }).slice(-4);
  return formatDateTime(iso, { ...reader, style: year(iso) === year(now) ? 'monthDay' : 'date' });
}
