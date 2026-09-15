import { admin, createClient, type Admin } from '@itsm/sdk';

/**
 * The API, from the browser.
 *
 * Base URL `/api/proxy`, never the API's own origin: the token lives in the
 * session store and the browser holds only an opaque cookie, so a request
 * straight to the API would arrive unauthenticated. There is deliberately no
 * way to point this elsewhere.
 */
export const api: Admin = admin(
  createClient({
    baseUrl: '/api/proxy',
    // `no-store` because every one of these calls is asking what is configured
    // *now*, and a console showing a cached policy is showing the wrong one.
    fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
  }),
);
