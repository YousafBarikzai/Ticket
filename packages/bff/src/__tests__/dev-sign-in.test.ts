import { describe, expect, it, vi } from 'vitest';
import type { BffConfig } from '../config.js';
import { devSignIn, DevSignInFailed } from '../dev-sign-in.js';

describe('the development sign-in, from the BFF', () => {
  const config = { apiBaseUrl: 'http://api.test' } as BffConfig;

  function respond(status: number, body: unknown): typeof fetch {
    return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
  }

  it('returns the token set the API minted', async () => {
    const tokens = await devSignIn(
      config,
      { tenantSlug: 'acme', email: 'agent@acme.test' },
      respond(201, { accessToken: 'at', expiresInSeconds: 3600, tenantId: 't', userId: 'u', displayName: 'Agent' }),
    );
    expect(tokens).toEqual({ accessToken: 'at', expiresInSeconds: 3600, tenantId: 't', userId: 'u', displayName: 'Agent' });
  });

  it('says plainly when the API has no development sign-in at all', async () => {
    await expect(devSignIn(config, { tenantSlug: 'a', email: 'b@c.test' }, respond(404, {}))).rejects.toThrow(
      /no development sign-in/,
    );
  });

  it('gives one message for an unknown tenant and an unknown user', async () => {
    await expect(devSignIn(config, { tenantSlug: 'a', email: 'b@c.test' }, respond(401, {}))).rejects.toBeInstanceOf(
      DevSignInFailed,
    );
  });

  it('refuses a response with no tenant rather than storing an unusable session', async () => {
    await expect(
      devSignIn(config, { tenantSlug: 'a', email: 'b@c.test' }, respond(201, { accessToken: 'at' })),
    ).rejects.toThrow(/unusable token/);
  });
});
