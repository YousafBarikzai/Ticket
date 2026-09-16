import { createClient, workbench, type Workbench } from '@itsm/sdk';

/**
 * The API, from the browser.
 *
 * Base URL `/api/proxy`, never the API's own origin: the token lives in the
 * session store and the browser has only an opaque cookie, so a request that
 * went straight to the API would arrive unauthenticated. There is deliberately
 * no way to configure this to point elsewhere — a `NEXT_PUBLIC_API_URL` would
 * be exactly the escape hatch that undoes the token-handler pattern the first
 * time somebody is in a hurry.
 *
 * No `token` is passed, and that is the point: this client cannot hold one.
 */
export const api: Workbench = workbench(
  createClient({
    baseUrl: '/api/proxy',
    // Same-origin, so the session cookie rides along without `credentials`
    // being spelled out — and `no-store` because every one of these calls is
    // asking what is true *now*.
    fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
  }),
);
