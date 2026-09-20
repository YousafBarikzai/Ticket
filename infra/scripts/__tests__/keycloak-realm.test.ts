import { describe, expect, it } from 'vitest';
import { hostsFor, readCatalogue } from '../railway-deploy.js';
import {
  PLACEHOLDER,
  authHost,
  partialImportBody,
  permissionHint,
  realmBody,
  readRealm,
  realmSettings,
  resolveRealm,
  unresolvedPlaceholders,
  userProfileOf,
  type Realm,
} from '../keycloak-realm.js';

/**
 * The realm, checked against the thing it has to agree with.
 *
 * A Keycloak realm is configuration, and configuration is not usually worth a
 * test. This part is, because it is one of the few places in the system where
 * being wrong produces no error anywhere: a redirect URI that does not match
 * the application's origin fails at the identity provider, in a browser, to a
 * person who cannot sign in and has nothing to read. The API's own token
 * checks are the other half — `verify.ts` refuses a token with no `tenant_id`
 * and one whose `aud` is not `itsm-api`, and neither claim arrives unless a
 * mapper here puts it there.
 */

const catalogue = readCatalogue();
const realm = readRealm();

describe('the realm as committed', () => {
  it('names no real hostname, so no environment is the special one', () => {
    const hosts = unresolvedPlaceholders(realm);
    expect(hosts.length).toBeGreaterThan(0);
    for (const client of realm.clients) {
      for (const uri of client.redirectUris ?? []) expect(uri).toContain(PLACEHOLDER);
    }
  });

  it('carries the three claims the API refuses a token without', () => {
    const scope = (realm as unknown as { clientScopes: { name: string; protocolMappers: { name: string; config: Record<string, string> }[] }[] })
      .clientScopes.find((one) => one.name === 'itsm-claims');
    const mappers = new Map(scope!.protocolMappers.map((mapper) => [mapper.name, mapper.config]));

    // verify.ts: 'this token names no tenant' is thrown before anything else
    // is looked at, so a missing tenant_id mapper is every sign-in failing.
    expect(mappers.get('tenant-id')?.['claim.name']).toBe('tenant_id');
    expect(mappers.get('tenant-id')?.['access.token.claim']).toBe('true');
    expect(mappers.get('itsm-user-id')?.['claim.name']).toBe('itsm_user_id');
    // jwtVerify checks `aud` against OIDC_AUDIENCE, whose default is itsm-api.
    // Without this mapper the audience is the front-end client and every token
    // is refused with nothing in it looking wrong.
    expect(mappers.get('audience-itsm-api')?.['included.client.audience']).toBe('itsm-api');
    expect(mappers.get('audience-itsm-api')?.['access.token.claim']).toBe('true');
  });

  it('gives every application its own client, so one compromised origin is not all three', () => {
    const ids = realm.clients.map((client) => client.clientId);
    expect(ids).toEqual(['itsm-api', 'itsm-portal', 'itsm-workbench', 'itsm-admin']);
  });

  it('makes the API bearer-only: a resource server that could start a flow is a second front door', () => {
    const api = realm.clients.find((client) => client.clientId === 'itsm-api')!;
    expect(api.bearerOnly).toBe(true);
    expect(api.standardFlowEnabled).toBe(false);
    expect(api.directAccessGrantsEnabled).toBe(false);
  });

  it('refuses the implicit flow and the password grant on every application', () => {
    for (const client of realm.clients.filter((one) => one.clientId !== 'itsm-api')) {
      expect(client.implicitFlowEnabled, client.clientId).toBe(false);
      expect(client.directAccessGrantsEnabled, client.clientId).toBe(false);
      expect(client.publicClient, client.clientId).toBe(false);
      expect(client.attributes?.['pkce.code.challenge.method'], client.clientId).toBe('S256');
    }
  });
});

describe('resolving it for an environment', () => {
  const resolved = resolveRealm(realm, hostsFor(catalogue, 'example.com', 'staging'), 'https://auth.staging.example.com');

  it('leaves no placeholder anywhere', () => {
    expect(unresolvedPlaceholders(resolved)).toEqual([]);
  });

  it('points each client at the host its application is actually served on', () => {
    const uriOf = (clientId: string): string | undefined =>
      resolved.clients.find((client) => client.clientId === clientId)?.redirectUris?.[0];

    // The pairing this file exists for: these come from the same catalogue the
    // deploy reads, so the URI Keycloak accepts is the origin the app runs on.
    expect(uriOf('itsm-portal')).toBe('https://help.staging.example.com/api/session/callback');
    expect(uriOf('itsm-workbench')).toBe('https://desk.staging.example.com/api/session/callback');
    expect(uriOf('itsm-admin')).toBe('https://admin.staging.example.com/api/session/callback');
  });

  it('matches the callback route each application actually serves', () => {
    // apps/*/src/app/api/session/callback/route.ts. If that path ever moves,
    // this fails here rather than at somebody's sign-in.
    for (const client of resolved.clients.filter((one) => one.clientId !== 'itsm-api')) {
      expect(client.redirectUris?.[0], client.clientId).toMatch(/\/api\/session\/callback$/);
    }
  });

  it('sets the logout redirect to the same host as the login redirect', () => {
    for (const client of resolved.clients.filter((one) => one.clientId !== 'itsm-api')) {
      const origin = new URL(client.redirectUris![0]!).origin;
      expect(client.attributes?.['post.logout.redirect.uris'], client.clientId).toBe(`${origin}/*`);
    }
  });

  it('puts production on the bare domain', () => {
    const production = resolveRealm(realm, hostsFor(catalogue, 'example.com', 'production'), 'https://auth.example.com');
    expect(production.clients.find((client) => client.clientId === 'itsm-admin')?.redirectUris?.[0]).toBe(
      'https://admin.example.com/api/session/callback',
    );
    expect(authHost('example.com', 'production')).toBe('auth.example.com');
    expect(authHost('example.com', 'pr-42')).toBe('auth.pr-42.example.com');
  });

  it('leaves the API client alone, because it never receives a redirect', () => {
    const api = resolved.clients.find((client) => client.clientId === 'itsm-api')!;
    expect(api.redirectUris).toBeUndefined();
  });

  it('refuses a client whose application is not in the catalogue', () => {
    const stray: Realm = { ...realm, clients: [...realm.clients, { clientId: 'itsm-portal', redirectUris: [] }] };
    const withoutPortal = { ...catalogue, services: catalogue.services.filter((one) => one.name !== 'portal') };
    expect(() => resolveRealm(stray, hostsFor(withoutPortal, 'example.com', 'staging'), 'https://auth.staging.example.com')).toThrow(/no public host for portal/);
  });
});

describe('what Keycloak is actually sent', () => {
  const resolved = resolveRealm(realm, hostsFor(catalogue, 'example.com', 'staging'), 'https://auth.staging.example.com');

  it('overwrites on a second deploy, rather than reporting success and changing nothing', () => {
    // Keycloak's default is FAIL, which makes every deploy after the first a
    // no-op: the clients already exist, so a changed redirect URI is accepted,
    // ignored and reported as applied.
    expect(partialImportBody(resolved).ifResourceExists).toBe('OVERWRITE');
  });

  it('imports the clients and the scope that carries the claims', () => {
    const body = partialImportBody(resolved) as { clients: { clientId: string }[]; clientScopes: { name: string }[] };
    expect(body.clients.map((client) => client.clientId)).toContain('itsm-admin');
    expect(body.clientScopes.map((scope) => scope.name)).toEqual(['itsm-claims']);
  });

  it('keeps the realm settings out of the import and the clients out of the settings', () => {
    // Two calls because Keycloak takes them two ways: PUT /realms/{realm}
    // replaces settings and ignores clients, partialImport takes clients and
    // ignores settings. Sending each the other's half silently does nothing.
    const settings = realmSettings(resolved);
    expect(settings.clients).toBeUndefined();
    expect(settings.clientScopes).toBeUndefined();
    expect(settings.realm).toBe('itsm');
    expect(settings.sslRequired).toBe('all');
    expect(settings.bruteForceProtected).toBe(true);
  });

  it('strips the commentary, which is for whoever opens the file rather than for Keycloak', () => {
    const settings = realmSettings(resolved);
    for (const key of Object.keys(settings)) {
      expect(key.startsWith('comment.'), key).toBe(false);
      expect(key).not.toBe('$comment');
    }
  });

  it('carries the resolved frontend URL, so Keycloak builds its own links on the right host', () => {
    expect((realmSettings(resolved).attributes as Record<string, string>).frontendUrl).toBe('https://auth.staging.example.com');
  });
});

describe('permissionHint', () => {
  /**
   * The point of the hint is that it names the role. A message saying only
   * "403" sends someone to look at the realm, the URL or Keycloak's own
   * health, and the answer is in none of those places.
   */
  it('names the role a refused call actually needs', () => {
    for (const status of [401, 403]) {
      const hint = permissionHint(status);
      expect(hint).toContain('`admin`');
      expect(hint).toContain('master');
      expect(hint).toContain('Service accounts roles');
    }
  });

  /**
   * And it says the wrong one is wrong, because the wrong one is the one the
   * name suggests and the one this project's runbook asked for until now.
   */
  it('says why realm-admin is not it', () => {
    expect(permissionHint(403)).toContain('realm-admin');
  });

  /**
   * Everything else that can fail here is about the realm rather than the
   * caller, so it must not carry a permissions hint.
   */
  it('adds nothing to a failure that is not about permission', () => {
    for (const status of [400, 404, 409, 500, 502]) expect(permissionHint(status)).toBe('');
  });
});

describe('realmBody', () => {
  /**
   * The create path posts this straight to `POST /admin/realms`, and Keycloak
   * deserialises a RealmRepresentation strictly. A key it does not know is a
   * 400 reading "unable to read contents from stream" — a message that names
   * neither the key nor the fact that a key is the problem, on the one deploy
   * where there is no working realm to compare against.
   */
  it('sends Keycloak nothing Keycloak does not know', () => {
    const body = realmBody(readRealm());
    for (const key of Object.keys(body)) {
      expect(key.startsWith('comment.'), `comment key survived: ${key}`).toBe(false);
      expect(key).not.toBe('$comment');
      expect(key).not.toBe('userProfile');
    }
  });

  /** Everything that is a realm setting is still there. */
  it('keeps the realm itself', () => {
    const body = realmBody(readRealm());
    expect(body.realm).toBe('itsm');
    expect(body.enabled).toBe(true);
    expect(Array.isArray(body.clients)).toBe(true);
  });

  /** The update path strips the same keys, and the clients on top. */
  it('agrees with realmSettings on what is not a realm setting', () => {
    const settings = realmSettings(readRealm());
    expect(settings.clients).toBeUndefined();
    expect(settings.clientScopes).toBeUndefined();
    expect(settings.userProfile).toBeUndefined();
    expect(Object.keys(settings).some((key) => key.startsWith('comment.'))).toBe(false);
  });
});

describe('userProfileOf', () => {
  /**
   * `tenant_id` is declared here, a mapper copies it into the access token, and
   * `apps/api/src/auth/verify.ts` refuses any token whose payload lacks it.
   * Lose the profile and every sign-in fails closed — so this asserts the
   * attribute survives being taken out of the realm body, not merely that
   * something was returned.
   */
  it('carries the attribute the API refuses tokens without', () => {
    const profile = userProfileOf(readRealm());
    expect(profile).not.toBeNull();
    const names = (profile?.attributes as { name: string }[]).map((attribute) => attribute.name);
    expect(names).toContain('tenant_id');
    expect(names).toContain('itsm_user_id');
  });

  /** A realm that declares none is not an error; it just has nothing to send. */
  it('is null when there is no profile to apply', () => {
    expect(userProfileOf({ realm: 'x', clients: [] } as unknown as Realm)).toBeNull();
    expect(userProfileOf({ realm: 'x', clients: [], userProfile: {} } as unknown as Realm)).toBeNull();
  });
});
