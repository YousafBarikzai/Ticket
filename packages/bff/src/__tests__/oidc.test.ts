import { describe, expect, it, vi } from 'vitest';
import { authorisationUrl, challengeFor, createVerifier, endSessionUrl, exchangeCode, readClaims } from '../oidc.js';
import { ConfigurationError, developmentSignInAvailable, readConfig } from '../config.js';

const settings = { issuer: 'https://id.example.test/realms/itsm', clientId: 'workbench', clientSecret: 'shhh' };

describe('PKCE', () => {
  it('derives the challenge as the RFC does', () => {
    // The worked example from RFC 7636 appendix B: if this ever changes, every
    // exchange against a conforming provider fails, and the error the provider
    // returns says only "invalid grant".
    expect(challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('mints a verifier of a legal length, and a different one each time', () => {
    const verifier = createVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(createVerifier()).not.toBe(verifier);
  });
});

describe('the authorisation request', () => {
  const url = new URL(
    authorisationUrl('https://id.example.test/auth', settings, {
      state: 'st-1',
      challenge: 'ch-1',
      redirectUri: 'https://desk.example.test/api/session/callback',
      idpHint: 'acme-saml',
    }),
  );

  it('asks for a code with S256, never plain', () => {
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe('ch-1');
  });

  it('carries the state and the fixed redirect URI', () => {
    expect(url.searchParams.get('state')).toBe('st-1');
    expect(url.searchParams.get('redirect_uri')).toBe('https://desk.example.test/api/session/callback');
  });

  it('never carries the client secret through the browser', () => {
    expect(url.toString()).not.toContain('shhh');
    expect(url.searchParams.get('client_secret')).toBeNull();
  });

  it('passes the tenant’s provider hint, so nobody picks from a list of other tenants', () => {
    expect(url.searchParams.get('kc_idp_hint')).toBe('acme-saml');
  });
});

describe('the code exchange', () => {
  function stub(responses: Record<string, { status: number; body: unknown }>): typeof fetch {
    return vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const match = responses[url];
      if (!match) throw new Error(`unexpected fetch of ${url}`);
      return new Response(JSON.stringify(match.body), {
        status: match.status,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
  }

  const discovery = {
    authorization_endpoint: 'https://id.example.test/auth',
    token_endpoint: 'https://id.example.test/token',
    end_session_endpoint: 'https://id.example.test/logout',
  };

  it('returns the token set', async () => {
    const doFetch = stub({
      // A unique issuer per test: discovery is cached per issuer for the life
      // of the process, and a shared one would make these tests order-dependent.
      'https://id.example.test/realms/exchange/.well-known/openid-configuration': { status: 200, body: discovery },
      'https://id.example.test/token': {
        status: 200,
        body: { access_token: 'at', refresh_token: 'rt', expires_in: 300, id_token: 'it' },
      },
    });

    const tokens = await exchangeCode(
      { ...settings, issuer: 'https://id.example.test/realms/exchange' },
      { code: 'c', verifier: 'v', redirectUri: 'https://desk.example.test/api/session/callback' },
      doFetch,
    );

    expect(tokens).toEqual({ accessToken: 'at', refreshToken: 'rt', expiresInSeconds: 300, idToken: 'it' });
  });

  it('treats a provider that omits expires_in as short-lived, not eternal', async () => {
    const doFetch = stub({
      'https://id.example.test/realms/nolife/.well-known/openid-configuration': { status: 200, body: discovery },
      'https://id.example.test/token': { status: 200, body: { access_token: 'at' } },
    });

    const tokens = await exchangeCode(
      { ...settings, issuer: 'https://id.example.test/realms/nolife' },
      { code: 'c', verifier: 'v', redirectUri: 'r' },
      doFetch,
    );

    expect(tokens.expiresInSeconds).toBe(300);
    expect(tokens.refreshToken).toBeNull();
  });

  it('does not put the provider’s own error prose in front of the user', async () => {
    const doFetch = stub({
      'https://id.example.test/realms/refused/.well-known/openid-configuration': { status: 200, body: discovery },
      'https://id.example.test/token': {
        status: 400,
        body: { error: 'invalid_client', error_description: 'client secret for workbench is wrong' },
      },
    });

    await expect(
      exchangeCode(
        { ...settings, issuer: 'https://id.example.test/realms/refused' },
        { code: 'c', verifier: 'v', redirectUri: 'r' },
        doFetch,
      ),
    ).rejects.toThrow(/refused the exchange \(400\)/);
  });

  it('builds an end-session URL when the provider publishes one', () => {
    expect(endSessionUrl(discovery, 'id-token', 'https://desk.example.test/signed-out')).toContain('id_token_hint=id-token');
    expect(endSessionUrl({ authorization_endpoint: 'a', token_endpoint: 't' }, null, 'x')).toBeNull();
  });
});

describe('reading claims', () => {
  function token(claims: Record<string, unknown>): string {
    return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
  }

  it('prefers the platform user id over the provider subject', () => {
    expect(readClaims(token({ sub: 'kc-1', itsm_user_id: 'u-1', tenant_id: 't-1', name: 'A Person' }))).toEqual({
      tenantId: 't-1',
      userId: 'u-1',
      displayName: 'A Person',
    });
  });

  it('returns nothing rather than throwing on a token it cannot read', () => {
    // It is never used for a decision, so a malformed token is a missing name
    // badge, not a failed sign-in.
    expect(readClaims('rubbish')).toEqual({ tenantId: null, userId: null, displayName: null });
    expect(readClaims('a.!!!.c')).toEqual({ tenantId: null, userId: null, displayName: null });
  });
});

const APP = {
  appName: 'workbench',
  originEnvVar: 'WORKBENCH_ORIGIN',
  defaultOrigin: 'http://localhost:3100',
  defaultLanding: '/queue',
  signInPath: '/sign-in',
  signedOutPath: '/signed-out',
};

describe('configuration', () => {
  it('refuses to run in production without an identity provider', () => {
    expect(() => readConfig(APP, { NODE_ENV: 'production' })).toThrow(ConfigurationError);
  });

  it('names the missing setting rather than failing on the first request', () => {
    expect(() =>
      readConfig(APP, { NODE_ENV: 'production', OIDC_ISSUER: 'https://id.example.test' }),
    ).toThrow(/OIDC_CLIENT_ID/);
  });

  it('reads each application\u2019s own origin variable', () => {
    const portal = { ...APP, appName: 'portal', originEnvVar: 'PORTAL_ORIGIN', defaultOrigin: 'http://localhost:3200' };
    expect(readConfig(portal, { PORTAL_ORIGIN: 'https://help.test' }).appOrigin).toBe('https://help.test');
    // The workbench's variable must not be read by the portal, or two apps
    // deployed side by side would share one origin and one redirect URI.
    expect(readConfig(portal, { WORKBENCH_ORIGIN: 'https://desk.test' }).appOrigin).toBe('http://localhost:3200');
  });

  it('offers the development sign-in only with no provider and outside production', () => {
    expect(developmentSignInAvailable(readConfig(APP, { NODE_ENV: 'development' }))).toBe(true);
    expect(
      developmentSignInAvailable(
        readConfig(APP, {
          NODE_ENV: 'development',
          OIDC_ISSUER: 'https://id.example.test',
          OIDC_CLIENT_ID: 'w',
          OIDC_CLIENT_SECRET: 's',
        }),
      ),
    ).toBe(false);
  });

  it('trims a trailing slash so two configurations do not produce two URLs', () => {
    const config = readConfig(APP, { API_BASE_URL: 'http://api.test/', WORKBENCH_ORIGIN: 'https://desk.test/' });
    expect(config.apiBaseUrl).toBe('http://api.test');
    expect(config.appOrigin).toBe('https://desk.test');
  });
});
