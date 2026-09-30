import 'server-only';
import { ApiError, type ArticleSummary, type Portal } from '@itsm/sdk';
import { settle, type Settled } from '../../../home/settle.js';
import { CATEGORIES, type KnowledgeCategory } from './categories.js';

/**
 * The knowledge reads the pages share (SPEC §6.3). Every list asks for
 * published articles only; the audience rule is the API's, applied per row,
 * so what comes back is what this person may read.
 */

const LIMIT = 200;

/**
 * Published articles, all of them or one category's. A category this tenant
 * does not have answers 404 from the API; for a reader that is an empty
 * shelf, not an error.
 */
export function readArticles(api: Portal, category: KnowledgeCategory | null = null): Promise<Settled<readonly ArticleSummary[]>> {
  return settle(
    api.knowledge({ status: 'published', ...(category ? { category: category.key } : {}), limit: LIMIT }).catch((error: unknown) => {
      if (category && error instanceof ApiError && error.status === 404) return [];
      throw error;
    }),
  );
}

export interface Shelf {
  readonly category: KnowledgeCategory;
  readonly articles: readonly ArticleSummary[];
}

/**
 * Every browse category's articles, read side by side — the only way to tell
 * which category an article is in, since the article itself does not say.
 * A shelf that could not be read is left out, so a breadcrumb or "More in"
 * is missing rather than wrong.
 */
export async function readShelves(api: Portal): Promise<Shelf[]> {
  const reads = await Promise.all(CATEGORIES.map((category) => readArticles(api, category)));
  return CATEGORIES.flatMap((category, index) => {
    const read = reads[index]!;
    return read.ok ? [{ category, articles: read.value }] : [];
  });
}

/** The shelf an article sits on, if any. */
export function shelfWith(shelves: readonly Shelf[], articleKey: string): Shelf | null {
  return shelves.find((shelf) => shelf.articles.some((article) => article.key === articleKey)) ?? null;
}
