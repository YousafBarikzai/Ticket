import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hostsFor, readCatalogue, type Catalogue, type ServiceDefinition } from '../railway-deploy.js';
import {
  BUILT_IN_CLIENT_SCOPES,
  CLIENT_NAMES,
  PLACEHOLDER,
  THEME_KEYS,
  authHost,
  confidentialClients,
  demoModeOf,
  missingScopes,
  partialImportBody,
  permissionHint,
  realmBody,
  readRealm,
  realmSettings,
  resolveRealm,
  scopesToAttach,
  themeFlag,
  unresolvedPlaceholders,
  userProfileOf,
  type Realm,
  type RealmClient,
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
    expect(body.clientScopes.map((scope) => scope.name)).toContain('itsm-claims');
  });

  it('keeps each client secret it is given, so a deploy does not sign every application out of Keycloak', () => {
    // OVERWRITE deletes and recreates each client, and a confidential client
    // recreated without a secret gets a new one — which the three applications
    // do not have. Carrying the current secret back in is what keeps them valid.
    const body = partialImportBody(resolved, new Map([['itsm-admin', 'kept']])) as { clients: { clientId: string; secret?: string }[] };
    expect(body.clients.find((client) => client.clientId === 'itsm-admin')?.secret).toBe('kept');
    expect(body.clients.find((client) => client.clientId === 'itsm-portal')?.secret).toBeUndefined();
  });

  it('reads secrets for the three applications and not for the API, which has none', () => {
    expect(confidentialClients(resolved).sort()).toEqual(['itsm-admin', 'itsm-portal', 'itsm-workbench']);
  });

  it('declares every scope a client names, so a new realm is not created without them', () => {
    // A realm created from a file that names any scope gets only those scopes.
    // A client naming one that does not exist asks for a scope Keycloak then
    // refuses, and every sign-in fails as invalid_scope.
    const declared = new Set(((resolved as unknown as { clientScopes: { name: string }[] }).clientScopes).map((scope) => scope.name));
    for (const client of resolved.clients) {
      for (const scope of (client.defaultClientScopes as string[] | undefined) ?? []) expect(declared.has(scope), `${client.clientId}: ${scope}`).toBe(true);
    }
  });

  it('puts sub, a name and an email address in the tokens', () => {
    const mappers = ((resolved as unknown as { clientScopes: { protocolMappers: { protocolMapper: string; config: Record<string, string> }[] }[] }).clientScopes).flatMap(
      (scope) => scope.protocolMappers,
    );
    expect(mappers.some((mapper) => mapper.protocolMapper === 'oidc-sub-mapper')).toBe(true);
    const claims = mappers.map((mapper) => mapper.config['claim.name']);
    expect(claims).toEqual(expect.arrayContaining(['preferred_username', 'email', 'tenant_id']));
  });

  it('creates only the scopes an existing realm is missing', () => {
    expect(missingScopes(resolved, ['itsm-claims', 'profile', 'roles', 'web-origins', 'acr']).map((scope) => scope.name).sort()).toEqual(['basic', 'email']);
    expect(missingScopes(resolved, ['itsm-claims', 'basic', 'profile', 'email', 'roles', 'web-origins', 'acr'])).toEqual([]);
  });

  it('declares every scope Keycloak’s own clients are given, so the deploy can attach them', () => {
    const declared = new Set(((resolved as unknown as { clientScopes: { name: string }[] }).clientScopes).map((scope) => scope.name));
    for (const [clientId, scopes] of Object.entries(BUILT_IN_CLIENT_SCOPES)) {
      for (const scope of scopes) expect(declared.has(scope), `${clientId}: ${scope}`).toBe(true);
    }
  });

  it('gives the account page a subject and its roles, without which its API refuses it', () => {
    // The account page is Keycloak's own; its API wants the account client's
    // roles in resource_access and the account named in sub.
    const wanted = BUILT_IN_CLIENT_SCOPES['account-console'] ?? [];
    expect(wanted).toEqual(expect.arrayContaining(['basic', 'roles']));
    const roles = ((resolved as unknown as { clientScopes: { name: string; protocolMappers: { config: Record<string, string> }[] }[] }).clientScopes).find(
      (scope) => scope.name === 'roles',
    );
    expect(roles?.protocolMappers.map((mapper) => mapper.config['claim.name'])).toContain('resource_access.${client_id}.roles');
  });

  it('attaches only the scopes a client is missing', () => {
    expect(scopesToAttach(['basic', 'roles', 'profile'], [])).toEqual(['basic', 'roles', 'profile']);
    expect(scopesToAttach(['basic', 'roles', 'profile'], ['profile', 'basic'])).toEqual(['roles']);
    expect(scopesToAttach(['basic', 'roles'], ['roles', 'basic', 'offline_access'])).toEqual([]);
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

/*
 * Keycloak Step A (SPEC v3 §6.4, A5 §8): the realm half of the sign-in journey
 * fixes. Each of these is a dead end a real person met — a "Forgot password?"
 * that sends nothing, an error page with no way back, an account page showing
 * a tenant UUID — so each is pinned here, where the file that causes it lives.
 */

/** The three applications' clients, which are the ones a person ever sees. */
const APPLICATION_CLIENTS = ['itsm-portal', 'itsm-workbench', 'itsm-admin'] as const;

/** The application each client signs people in to, by the host its redirect URI names. */
const APPLICATION_OF: Readonly<Record<(typeof APPLICATION_CLIENTS)[number], keyof typeof CLIENT_NAMES>> = {
  'itsm-portal': 'portal',
  'itsm-workbench': 'workbench',
  'itsm-admin': 'admin',
};

interface ProfileAttribute {
  name: string;
  required?: { roles?: string[] };
  permissions?: { view?: string[]; edit?: string[] };
}

const clientOf = (one: Realm, clientId: string): RealmClient => {
  const client = one.clients.find((candidate) => candidate.clientId === clientId);
  if (!client) throw new Error(`no client ${clientId}`);
  return client;
};

const profileAttribute = (name: string): ProfileAttribute => {
  const found = (userProfileOf(readRealm())?.attributes as ProfileAttribute[]).find((attribute) => attribute.name === name);
  if (!found) throw new Error(`the profile declares no ${name}`);
  return found;
};

/** Every host but the site's, as a deployment without the public site would have. */
const withoutSite = (hosts: ReadonlyMap<string, string>): Map<string, string> => new Map([...hosts].filter(([name]) => name !== 'site'));

/** The hosts of a staging deploy, with the site at a known address whatever the catalogue holds today. */
const stagingHosts = (): Map<string, string> => new Map([...withoutSite(hostsFor(catalogue, 'example.com', 'staging')), ['site', 'www.staging.example.com']]);

describe('Step A: the realm as committed', () => {
  it('hides "Forgot password?", which with no SMTP server promises an email that never comes', () => {
    // Keycloak 26.7 answers "You should receive an email shortly" whether or
    // not anything was sent, so the link is a polite dead end until there is
    // a mail server behind it.
    expect(realm.resetPasswordAllowed).toBe(false);
    expect(realmSettings(realm).resetPasswordAllowed).toBe(false);
  });

  it('keeps a login page valid for exactly as long as the sign-in it belongs to', () => {
    // Longer on Keycloak's side and a person who left the page open signs in
    // and is told the sign-in did not finish, because the BFF forgot it first.
    expect(realm.accessCodeLifespanLogin).toBe(1800);
    expect(realmSettings(realm).accessCodeLifespanLogin).toBe(1800);
    const bff = readFileSync(resolve(import.meta.dirname, '..', '..', '..', 'packages', 'bff', 'src', 'bff.ts'), 'utf8');
    const pending = /PENDING_TTL_SECONDS\s*=\s*([\d_]+)/.exec(bff)?.[1];
    expect(pending, 'PENDING_TTL_SECONDS in packages/bff/src/bff.ts').toBeDefined();
    expect(Number(pending!.replaceAll('_', '')), 'realm.json accessCodeLifespanLogin against the BFF pending TTL').toBe(realm.accessCodeLifespanLogin);
  });

  it('leaves the session timeouts as they were', () => {
    // Raising them trades security for convenience, and no decision covers it.
    expect(realm.ssoSessionIdleTimeout).toBe(1800);
    expect(realm.ssoSessionMaxLifespan).toBe(36000);
  });

  it('names no theme, so a deploy cannot switch to a theme whose image never arrived', () => {
    for (const key of THEME_KEYS) expect(Object.keys(realm), key).not.toContain(key);
    expect(THEME_KEYS).toEqual(['loginTheme', 'accountTheme', 'emailTheme']);
  });

  it('declares the two attributes the login theme reads, empty until resolved', () => {
    expect(realm.attributes?.['itsm.homeUrl']).toBe('');
    expect(realm.attributes?.['itsm.demoUrl']).toBe('');
  });

  it('shows the tenant and user ids to administrators only', () => {
    for (const name of ['tenant_id', 'itsm_user_id']) {
      const { permissions } = profileAttribute(name);
      expect(permissions?.view, `${name} view`).toEqual(['admin']);
      expect(permissions?.edit, `${name} edit`).toEqual(['admin']);
    }
  });

  it('requires the tenant of administrators, never of the person signing in', () => {
    // A person cannot see tenant_id, so requiring it of them would stop their
    // sign-in on Keycloak's profile form asking for a value they cannot enter.
    const roles = profileAttribute('tenant_id').required?.roles ?? [];
    expect(roles).not.toContain('user');
    expect(roles).toEqual(['admin']);
  });

  it('requires of a person only what that person can see and change', () => {
    for (const attribute of userProfileOf(readRealm())?.attributes as ProfileAttribute[]) {
      if (!attribute.required?.roles?.includes('user')) continue;
      expect(attribute.permissions?.view, `${attribute.name} view`).toContain('user');
      expect(attribute.permissions?.edit, `${attribute.name} edit`).toContain('user');
    }
  });

  it('still lets people see and correct their own name and address', () => {
    for (const name of ['email', 'firstName', 'lastName']) {
      expect(profileAttribute(name).permissions?.view, name).toContain('user');
      expect(profileAttribute(name).permissions?.edit, name).toContain('user');
    }
  });

  it('shows the names the script sets, so the file and the account page agree', () => {
    for (const clientId of APPLICATION_CLIENTS) expect(clientOf(realm, clientId).name, clientId).toBe(CLIENT_NAMES[APPLICATION_OF[clientId]]);
  });

  it('gives every application a way back, still a placeholder in the file', () => {
    for (const clientId of APPLICATION_CLIENTS) {
      expect(clientOf(realm, clientId).baseUrl, clientId).toMatch(new RegExp(`^https://[a-z]+\\.${PLACEHOLDER}/$`));
    }
  });
});

describe('Step A: resolving the clients', () => {
  const staging = resolveRealm(realm, stagingHosts(), 'https://auth.staging.example.com');
  const production = resolveRealm(realm, hostsFor(catalogue, 'example.com', 'production'), 'https://auth.example.com');

  it('names each application by its area, which is what people call it', () => {
    // Literal until @itsm/contracts/areas exists; then AREAS[app].name.
    expect(CLIENT_NAMES).toEqual({ portal: 'Help Portal', workbench: 'Service Desk', admin: 'Administration' });
    expect(clientOf(staging, 'itsm-portal').name).toBe('Help Portal');
    expect(clientOf(staging, 'itsm-workbench').name).toBe('Service Desk');
    expect(clientOf(staging, 'itsm-admin').name).toBe('Administration');
  });

  it('sets the name whatever the file says, so a rename is one constant', () => {
    const stale: Realm = { ...realm, clients: realm.clients.map((client) => ({ ...client, name: 'Agent workbench' })) };
    const resolved = resolveRealm(stale, stagingHosts(), 'https://auth.staging.example.com');
    expect(clientOf(resolved, 'itsm-workbench').name).toBe('Service Desk');
    // The resource server is nobody's application and keeps what it has.
    expect(clientOf(resolved, 'itsm-api').name).toBe('Agent workbench');
  });

  it('points each way back at the host the application is served on', () => {
    for (const resolved of [staging, production]) {
      for (const clientId of APPLICATION_CLIENTS) {
        const client = clientOf(resolved, clientId);
        expect(client.baseUrl, clientId).toBe(`${new URL(client.redirectUris![0]!).origin}/`);
      }
    }
    expect(clientOf(staging, 'itsm-portal').baseUrl).toBe('https://help.staging.example.com/');
    expect(clientOf(production, 'itsm-admin').baseUrl).toBe('https://admin.example.com/');
  });

  it('leaves no placeholder in a way back', () => {
    expect(unresolvedPlaceholders(staging).filter((path) => path.endsWith('baseUrl'))).toEqual([]);
    expect(unresolvedPlaceholders(staging)).toEqual([]);
  });

  it('gives the API, which nobody visits, neither a way back nor a new name', () => {
    const api = clientOf(staging, 'itsm-api');
    expect(api.baseUrl).toBeUndefined();
    expect(api.name).toBe(clientOf(realm, 'itsm-api').name);
  });

  it('sends the names and the ways back with the clients, the only path a client reaches Keycloak by', () => {
    const body = partialImportBody(staging) as { clients: { clientId: string; name?: string; baseUrl?: string }[] };
    const workbench = body.clients.find((client) => client.clientId === 'itsm-workbench');
    expect(workbench?.name).toBe('Service Desk');
    expect(workbench?.baseUrl).toBe('https://desk.staging.example.com/');
  });
});

describe('Step A: the links the login theme draws (D18)', () => {
  const resolvedWith = (hosts: ReadonlyMap<string, string>, demo?: boolean): Record<string, string> =>
    resolveRealm(realm, hosts, 'https://auth.staging.example.com', demo === undefined ? {} : { demo }).attributes ?? {};

  it('links home and to the demo when the site is deployed and the demo is on', () => {
    const attributes = resolvedWith(stagingHosts(), true);
    expect(attributes['itsm.homeUrl']).toBe('https://www.staging.example.com/');
    expect(attributes['itsm.demoUrl']).toBe('https://www.staging.example.com/sign-in?start=demo');
  });

  it('links home but not to a demo that is off', () => {
    for (const attributes of [resolvedWith(stagingHosts(), false), resolvedWith(stagingHosts())]) {
      expect(attributes['itsm.homeUrl']).toBe('https://www.staging.example.com/');
      expect(attributes['itsm.demoUrl']).toBe('');
    }
  });

  it('links nowhere when there is no site to link to, demo or not', () => {
    for (const demo of [true, false]) {
      const attributes = resolvedWith(withoutSite(stagingHosts()), demo);
      expect(attributes['itsm.homeUrl'], `demo ${demo}`).toBe('');
      expect(attributes['itsm.demoUrl'], `demo ${demo}`).toBe('');
    }
  });

  it('signs people in without the site: it has no client, so its absence is not an error', () => {
    expect(() => resolvedWith(withoutSite(stagingHosts()), true)).not.toThrow();
  });

  it('sends an empty value rather than none, so turning the demo off clears a link the realm already has', () => {
    const attributes = realmSettings(resolveRealm(realm, stagingHosts(), 'https://auth.staging.example.com', { demo: false })).attributes as Record<string, string>;
    expect(Object.keys(attributes)).toEqual(expect.arrayContaining(['itsm.homeUrl', 'itsm.demoUrl']));
    expect(attributes['itsm.demoUrl']).toBe('');
  });

  it('follows the site to the bare domain in production', () => {
    const hosts = new Map([...withoutSite(hostsFor(catalogue, 'example.com', 'production')), ['site', 'example.com']]);
    const attributes = resolveRealm(realm, hosts, 'https://auth.example.com', { demo: true }).attributes ?? {};
    expect(attributes['itsm.homeUrl']).toBe('https://example.com/');
    expect(attributes['itsm.demoUrl']).toBe('https://example.com/sign-in?start=demo');
  });

  it('keeps the frontend URL and the commentary beside them', () => {
    const attributes = resolvedWith(stagingHosts(), true);
    expect(attributes.frontendUrl).toBe('https://auth.staging.example.com');
    expect(Object.keys(attributes)).toContain('comment.itsm');
  });
});

describe('Step A: the theme, only when the deploy says so', () => {
  const hosts = stagingHosts();
  const authUrl = 'https://auth.staging.example.com';
  const themeOf = (one: Realm): Record<string, unknown> =>
    Object.fromEntries(THEME_KEYS.filter((key) => key in one).map((key) => [key, (one as Record<string, unknown>)[key]]));

  it('sends no theme key at all when not told, so Keycloak keeps what it has', () => {
    expect(themeOf(resolveRealm(realm, hosts, authUrl))).toEqual({});
    expect(themeOf(realmSettings(resolveRealm(realm, hosts, authUrl)) as Realm)).toEqual({});
  });

  it('drops a theme that reached the realm some other way', () => {
    const themed = { ...realm, loginTheme: 'itsm', accountTheme: 'itsm', emailTheme: 'itsm' } as Realm;
    expect(themeOf(resolveRealm(themed, hosts, authUrl))).toEqual({});
  });

  it('switches the sign-in and account pages to the product theme once it is running', () => {
    const resolved = resolveRealm(realm, hosts, authUrl, { theme: 'itsm' });
    expect(themeOf(resolved)).toEqual({ loginTheme: 'itsm', accountTheme: 'itsm' });
    expect(themeOf(realmSettings(resolved) as Realm)).toEqual({ loginTheme: 'itsm', accountTheme: 'itsm' });
  });

  it('puts Keycloak’s own themes back when the owner opts out', () => {
    expect(themeOf(resolveRealm(realm, hosts, authUrl, { theme: 'default' }))).toEqual({ loginTheme: 'keycloak.v2', accountTheme: 'keycloak.v3' });
  });

  it('leaves the realm it was given alone', () => {
    const before = JSON.stringify(realm);
    resolveRealm({ ...realm, loginTheme: 'x' } as Realm, hosts, authUrl, { theme: 'itsm', demo: true });
    resolveRealm(realm, hosts, authUrl, { theme: 'itsm', demo: true });
    expect(JSON.stringify(realm)).toBe(before);
  });
});

describe('themeFlag', () => {
  it('is absent unless asked for', () => {
    expect(themeFlag(['--environment', 'production', '--apply'])).toBeUndefined();
  });

  it('reads the two themes it knows', () => {
    expect(themeFlag(['--apply', '--theme', 'itsm'])).toBe('itsm');
    expect(themeFlag(['--theme', 'default', '--apply'])).toBe('default');
  });

  /**
   * Ignoring a value it does not know would apply the realm unthemed and
   * report success, so a typo would look like a theme that did not take.
   */
  it('refuses anything else rather than applying the realm unthemed', () => {
    expect(() => themeFlag(['--theme', 'itms'])).toThrow(/itsm or default, not "itms"/);
    expect(() => themeFlag(['--theme', 'ITSM'])).toThrow(/"ITSM"/);
    expect(() => themeFlag(['--apply', '--theme'])).toThrow(/not nothing/);
  });
});

describe('demoModeOf', () => {
  const service = (name: string, variables?: Record<string, string>): ServiceDefinition => ({
    name,
    target: name,
    phase: 4,
    kind: 'service',
    public: true,
    replicas: 1,
    ...(variables ? { variables } : {}),
  });
  const catalogueWith = (...services: ServiceDefinition[]): Catalogue => ({ image: { registry: 'ghcr.io', repository: 'x/y' }, services });

  it('is on when the site says DEMO_MODE=on', () => {
    expect(demoModeOf(catalogueWith(service('api', { DEMO_MODE: 'on' }), service('site', { DEMO_MODE: 'on' })))).toBe(true);
  });

  it('is off when the site says anything else, or nothing', () => {
    expect(demoModeOf(catalogueWith(service('site', { DEMO_MODE: 'off' })))).toBe(false);
    expect(demoModeOf(catalogueWith(service('site', { DEMO_MODE: 'ON' })))).toBe(false);
    expect(demoModeOf(catalogueWith(service('site', { OTEL_SERVICE_NAME: 'itsm-site' })))).toBe(false);
    expect(demoModeOf(catalogueWith(service('site')))).toBe(false);
  });

  it('reads the site and nothing else: there is no demo link without a site to land on', () => {
    expect(demoModeOf(catalogueWith(service('api', { DEMO_MODE: 'on' }), service('portal', { DEMO_MODE: 'on' })))).toBe(false);
    expect(demoModeOf(catalogueWith(service('api', { DEMO_MODE: 'on' }), service('site', { DEMO_MODE: 'off' })))).toBe(false);
  });

  it('reads the committed catalogue', () => {
    expect(typeof demoModeOf(readCatalogue())).toBe('boolean');
  });
});
