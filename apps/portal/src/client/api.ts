import { createClient, portal, type Portal } from '@itsm/sdk';

/**
 * The API, from the browser.
 *
 * Base URL `/api/proxy`, never the API's own origin: the token lives in the
 * session store and the browser has only an opaque cookie, so a request that
 * went straight to the API would arrive unauthenticated. No `token` is passed,
 * and that is the point — this client cannot hold one.
 */
export const api: Portal = portal(
  createClient({
    baseUrl: '/api/proxy',
    fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
  }),
);
