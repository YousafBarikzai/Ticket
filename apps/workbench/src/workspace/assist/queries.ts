import type { AiCapability, SearchHit, Suggestion } from '@itsm/sdk';
import { api } from '../../client/api.js';
import { unlessRefused } from '../inspector/queries.js';

/**
 * What Assist reads (SPEC §6.2 "Assist"): the tenant's AI capabilities and
 * why any are withheld, the suggestions already made on this ticket, and
 * published articles that look like they answer it. Each `null` when the
 * reader may not see it, so the panel says so rather than failing.
 */

export const assistKeys = {
  capabilities: () => ['ai', 'capabilities'] as const,
  suggestions: (ticketId: string) => ['ai', ticketId, 'suggestions'] as const,
  articles: (number: string, query: string) => ['knowledge-suggest', number, query] as const,
} as const;

export interface Capabilities {
  readonly provider: string | null;
  readonly capabilities: readonly AiCapability[];
}

export function capabilitiesQuery(enabled: boolean) {
  return {
    queryKey: assistKeys.capabilities(),
    queryFn: (): Promise<Capabilities | null> => unlessRefused(api.capabilities()),
    staleTime: 10 * 60_000,
    enabled,
  } as const;
}

/** Newest first: the one just asked for leads. */
export function suggestionsQuery(ticketId: string, enabled: boolean) {
  return {
    queryKey: assistKeys.suggestions(ticketId),
    queryFn: async (): Promise<Suggestion[] | null> => {
      const answer = await unlessRefused(api.suggestions(ticketId));
      return answer ? [...answer.data].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)) : null;
    },
    staleTime: 30_000,
    enabled,
  } as const;
}

/** An article found by search, as the panel lists it. */
export interface ArticleHit {
  readonly key: string;
  readonly title: string;
  readonly snippet: string;
}

/**
 * The search's snippet as plain text. The fallback engine marks matched
 * words with literal `<b>` and `</b>`; they are dropped here rather than
 * ever becoming markup (nothing from an article is rendered as HTML).
 */
export function snippetText(snippet: string): string {
  return snippet.replace(/<\/?b>/gi, '').replace(/\s+/g, ' ').trim();
}

export function toArticleHits(hits: readonly SearchHit[]): ArticleHit[] {
  const seen = new Set<string>();
  const out: ArticleHit[] = [];
  for (const hit of hits) {
    if (hit.entityType !== 'knowledge') continue;
    const key = typeof hit.facets.key === 'string' && hit.facets.key !== '' ? hit.facets.key : hit.entityId;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, title: hit.title, snippet: snippetText(hit.snippet ?? '') });
  }
  return out;
}

/** Up to three published articles that match the ticket's title (the index holds published articles only). */
export function articlesQuery(number: string, query: string, enabled: boolean) {
  return {
    queryKey: assistKeys.articles(number, query),
    queryFn: async (): Promise<ArticleHit[] | null> => {
      const answer = await unlessRefused(api.search(query, { types: 'knowledge', limit: 3 }));
      return answer ? toArticleHits(answer.data) : null;
    },
    staleTime: 5 * 60_000,
    enabled: enabled && query.trim().length > 0,
  } as const;
}
