import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@itsm/sdk';

/**
 * The workbench's query cache (SPEC D16, §2).
 *
 * One client per tab, created in `DeskProviders`. The keys are named here so
 * that everything that invalidates — the live stream, a mutation, the sidebar
 * — invalidates the same thing the reader cached: a typo in a key is a list
 * that never updates, and nothing fails.
 */
export const deskKeys = {
  /** Sidebar counts. */
  counts: () => ['desk', 'counts'] as const,
  /** One view's list: `['view', 'mine', …filters]`, seeded by the server render. */
  views: () => ['view'] as const,
  view: (key: string, ...rest: readonly unknown[]) => ['view', key, ...rest] as const,
  /** One ticket's bundle, by number. */
  ticket: (number: string) => ['ticket', number] as const,
  /** The bell. */
  notifications: () => ['notifications'] as const,
  /** Someone's availability. */
  availability: (userId: string) => ['availability', userId] as const,
} as const;

/** A request worth repeating: the network, a 429 or a 5xx — never a 4xx, whose answer will not change. */
export function shouldRetry(failures: number, error: unknown): boolean {
  if (failures >= 2) return false;
  if (error instanceof ApiError) return error.status === 0 || error.retryable;
  return true;
}

export function createDeskQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Seeded data is fresh for half a minute; after that the live stream
        // or a refocus decides, rather than a refetch on every mount.
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: shouldRetry,
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
    },
  });
}
