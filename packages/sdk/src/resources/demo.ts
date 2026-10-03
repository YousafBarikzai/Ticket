import type { DemoStatus } from '@itsm/contracts/demo';
import { ApiError, type Client } from '../client.js';

/**
 * The one-click demo's public state, as the API answers it (ADR-0054).
 *
 * **Server-only**, like `portal().publicStatus`. The route sits under
 * `/api/demo/v1`, outside `/api/v1`, because it is the only demo route that
 * answers without a session; a browser's client points at its app's BFF,
 * which forwards `/api/v1` and nothing else, so from a browser this can only
 * fail. In a browser, each app's own `/api/demo/status` answers the same
 * shape from Redis.
 *
 * The answer names no tenant, user or token: the state, the reset clock and
 * the persona strings are the whole of it. It is not parsed here — the SDK
 * carries no schemas, so a browser bundle never pays for them — and a server
 * that must not trust the wire parses it with `demoStatusSchema` from
 * `@itsm/contracts/demo/schemas`.
 */

export interface Demo {
  /**
   * The demo's state (`ready`, `building`, `preparing`, `paused`) and its
   * reset clock, or null where this deployment runs no demo: the route
   * answers 404 when `DEMO_MODE` is off, and so does an API that predates it.
   * Anything else that goes wrong — a demo that is misconfigured answers 503
   * `demo_unavailable` — is an `ApiError`, for the caller to show as such.
   */
  status(): Promise<DemoStatus | null>;
}

export function demo(client: Client): Demo {
  return {
    status: async () => {
      try {
        return await client.request<DemoStatus>('/api/demo/v1/status');
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
  };
}
