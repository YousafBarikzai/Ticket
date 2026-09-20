/**
 * Resolves the committed realm for one environment (docs/architecture/16 §4).
 *
 * `infra/keycloak/realm.json` carries `__DOMAIN__` where a hostname belongs,
 * because a realm file with one environment's hostname in it is a realm file
 * that is wrong in the other two — and the way that fault presents is a
 * successful sign-in that redirects to staging from production.
 *
 * The hostnames are not substituted textually. They are derived from the same
 * `hostFor` the deploy uses, off the same service catalogue, so the redirect
 * URI Keycloak will accept and the origin the application will be served on
 * cannot disagree. That pairing is the whole reason this file exists: every
 * other approach leaves two lists to keep in step, and the one that goes stale
 * is always the redirect URI, discovered by a person who cannot sign in.
 *
 * Applying it is part of this script rather than a step somebody remembers.
 * Doc 16 §4 says realm changes are code applied by a job on deploy, and a realm
 * file that nothing applies is a mechanism nobody consults — which is a bug
 * this codebase has now found in four separate registers, and one worth not
 * adding a fifth of.
 *
 * Usage:
 *   tsx infra/scripts/keycloak-realm.ts --environment staging --out realm.resolved.json
 *   tsx infra/scripts/keycloak-realm.ts --environment staging --apply
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hostsFor, readCatalogue } from './railway-deploy.js';

export const PLACEHOLDER = '__DOMAIN__';

/** Which application each confidential client signs people in to. */
const CLIENT_SERVICE: Readonly<Record<string, string>> = {
  'itsm-portal': 'portal',
  'itsm-workbench': 'workbench',
  'itsm-admin': 'admin',
};

export interface RealmClient {
  clientId: string;
  redirectUris?: string[];
  attributes?: Record<string, string>;
  [key: string]: unknown;
}

export interface Realm {
  realm: string;
  attributes?: Record<string, string>;
  clients: RealmClient[];
  [key: string]: unknown;
}

export function readRealm(path = resolve(import.meta.dirname, '..', 'keycloak', 'realm.json')): Realm {
  return JSON.parse(readFileSync(path, 'utf8')) as Realm;
}

/**
 * Where Keycloak itself answers. Same derivation as every other host, so an
 * environment label that is wrong is wrong everywhere at once and visibly,
 * rather than in the one place that only matters during a redirect.
 */
export function authHost(domain: string, environment: string): string {
  return environment === 'production' ? `auth.${domain}` : `auth.${environment}.${domain}`;
}

/**
 * The realm, with every redirect URI pointed at a host that actually exists.
 *
 * Takes the hostnames rather than a domain to derive them from, because with
 * no domain of our own there is nothing to derive: Railway names each service
 * and the deploy discovers those names as it runs. One function for both
 * cases, because a second one would be a second chance for the realm and the
 * deploy to disagree — and they disagree silently, in a redirect nobody tests
 * until somebody cannot sign in.
 */
export function resolveRealm(realm: Realm, hosts: ReadonlyMap<string, string>, authUrl: string): Realm {
  const hostOf = (serviceName: string): string => {
    const host = hosts.get(serviceName);
    // Thrown rather than defaulted: a client whose application has no host
    // would otherwise get a plausible hostname for an application that is not
    // deployed, and sign-in would fail at the redirect.
    if (!host) throw new Error(`no public host for ${serviceName}, which client config needs`);
    return host;
  };

  const clients = realm.clients.map((client) => {
    const serviceName = CLIENT_SERVICE[client.clientId];
    if (!serviceName) return client;
    const host = hostOf(serviceName);
    return {
      ...client,
      redirectUris: [`https://${host}/api/session/callback`],
      attributes: { ...client.attributes, 'post.logout.redirect.uris': `https://${host}/*` },
    };
  });

  return {
    ...realm,
    attributes: { ...realm.attributes, frontendUrl: authUrl.replace(/\/$/, '') },
    clients,
  };
}

/** Every place a placeholder survived, so the check below can name them. */
export function unresolvedPlaceholders(realm: Realm): string[] {
  const found: string[] = [];
  const walk = (value: unknown, path: string): void => {
    if (typeof value === 'string') {
      if (value.includes(PLACEHOLDER)) found.push(path);
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`));
    } else if (value && typeof value === 'object') {
      for (const [key, inner] of Object.entries(value)) walk(inner, path ? `${path}.${key}` : key);
    }
  };
  walk(realm, '');
  return found;
}

/**
 * What Keycloak is sent to update an existing realm's clients and scopes.
 *
 * A partial import rather than a full realm import: a full one replaces the
 * realm, and the realm holds the users. `OVERWRITE` so a changed redirect URI
 * actually changes — the default, `FAIL`, makes the second deploy of any
 * environment a no-op that reports success.
 */
export function partialImportBody(realm: Realm): Record<string, unknown> {
  return {
    ifResourceExists: 'OVERWRITE',
    clients: realm.clients,
    clientScopes: (realm as { clientScopes?: unknown[] }).clientScopes ?? [],
  };
}

/**
 * Keys that exist for whoever opens `realm.json`, not for Keycloak.
 *
 * Keycloak deserialises a `RealmRepresentation` strictly: a key it does not
 * know is not ignored, it is a 400 reading
 * `{"errorMessage":"unable to read contents from stream"}` — which names
 * neither the key nor the fact that a key is the problem.
 */
function isComment(key: string): boolean {
  return key === '$comment' || key.startsWith('comment.');
}

/**
 * The realm as a `RealmRepresentation`, which is less than `realm.json` holds.
 *
 * Two things in that file are not part of the representation and have to come
 * out before it is sent. The `comment.*` keys, which are prose. And
 * `userProfile`, which is real configuration Keycloak accepts only at
 * `/admin/realms/{realm}/users/profile` — it is a `UPConfig`, a different
 * document with a different endpoint, and it is kept beside the realm here
 * because that is where it is legible, not because Keycloak takes it there.
 *
 * Both of them used to go out on the create path, which is the one path that
 * did not filter. That path only runs when the realm does not exist yet, so
 * the fault was invisible until the very first deploy of a new environment —
 * the one occasion where nobody has a working realm to compare against.
 */
export function realmBody(realm: Realm): Record<string, unknown> {
  const { userProfile: _profile, ...rest } = realm as Record<string, unknown>;
  return Object.fromEntries(Object.entries(rest).filter(([key]) => !isComment(key)));
}

/**
 * The declarative user profile, or null when the realm does not declare one.
 *
 * It is not decoration. `tenant_id` is declared here, the mapper copies it into
 * the access token, and `apps/api/src/auth/verify.ts` refuses any token whose
 * payload lacks it. Drop this and every sign-in fails closed.
 */
export function userProfileOf(realm: Realm): Record<string, unknown> | null {
  const profile = (realm as { userProfile?: Record<string, unknown> }).userProfile;
  return profile && Object.keys(profile).length > 0 ? profile : null;
}

/** The realm's own settings, which a partial import does not carry. */
export function realmSettings(realm: Realm): Record<string, unknown> {
  const { clients: _clients, clientScopes: _scopes, ...rest } = realmBody(realm);
  return rest;
}

/**
 * What a 401 or 403 from the admin API actually means here.
 *
 * Every other failure in `apply` is about the realm — it is missing, it is
 * malformed, Keycloak is down. These two are about the caller: the service
 * account authenticated fine and then was not allowed to do the thing. That is
 * a different fix, in a different place, and the bare status code names
 * neither. It is also the failure a first-time deploy is most likely to hit,
 * because the role this needs is not the one the name suggests.
 */
export function permissionHint(status: number): string {
  if (status !== 401 && status !== 403) return '';
  return (
    ' — the service account is authenticated but not authorised.' +
    ' It needs the realm role `admin` in the `master` realm' +
    ' (Clients → your pipeline client → Service accounts roles → Assign role → Realm roles).' +
    ' `realm-admin` is the wrong one: it is a client role on `<realm>-realm`,' +
    ' which Keycloak does not create until the realm exists.'
  );
}

async function adminToken(baseUrl: string, clientId: string, clientSecret: string): Promise<string> {
  const response = await fetch(`${baseUrl}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Keycloak refused the admin credentials: ${response.status}${permissionHint(response.status)}`);
  return ((await response.json()) as { access_token: string }).access_token;
}

/**
 * The user profile, sent to the endpoint that owns it.
 *
 * After the realm either way: creating a realm does not carry it, and a
 * partial import does not carry it either, so it is the one piece of this
 * configuration that has to be written on both paths or it is never written
 * at all.
 */
async function applyUserProfile(realm: Realm, baseUrl: string, headers: Record<string, string>): Promise<void> {
  const profile = userProfileOf(realm);
  if (!profile) return;

  const response = await fetch(`${baseUrl}/admin/realms/${realm.realm}/users/profile`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(profile),
  });
  if (!response.ok) {
    throw new Error(`could not apply the user profile: ${response.status}${permissionHint(response.status)} ${await response.text()}`);
  }
  console.log(`applied the user profile for ${realm.realm}`);
}

async function apply(realm: Realm, baseUrl: string, token: string): Promise<void> {
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const exists = await fetch(`${baseUrl}/admin/realms/${realm.realm}`, { headers });

  if (exists.status === 404) {
    const created = await fetch(`${baseUrl}/admin/realms`, { method: 'POST', headers, body: JSON.stringify(realmBody(realm)) });
    if (!created.ok) throw new Error(`could not create the realm: ${created.status}${permissionHint(created.status)} ${await created.text()}`);
    console.log(`created realm ${realm.realm}`);
    await applyUserProfile(realm, baseUrl, headers);
    return;
  }
  if (!exists.ok) throw new Error(`could not read the realm: ${exists.status}${permissionHint(exists.status)}`);

  const updated = await fetch(`${baseUrl}/admin/realms/${realm.realm}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(realmSettings(realm)),
  });
  if (!updated.ok) throw new Error(`could not update the realm: ${updated.status}${permissionHint(updated.status)} ${await updated.text()}`);

  const imported = await fetch(`${baseUrl}/admin/realms/${realm.realm}/partialImport`, {
    method: 'POST',
    headers,
    body: JSON.stringify(partialImportBody(realm)),
  });
  if (!imported.ok) throw new Error(`could not import the clients: ${imported.status}${permissionHint(imported.status)} ${await imported.text()}`);

  await applyUserProfile(realm, baseUrl, headers);
  console.log(`updated realm ${realm.realm}`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const value = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const environment = value('--environment');
  const out = value('--out');
  const shouldApply = argv.includes('--apply');
  const domain = process.env.DEPLOY_DOMAIN;
  if (!environment || (!out && !shouldApply)) {
    throw new Error('usage: keycloak-realm.ts --environment <name> [--hosts <json>] [--out <file>] [--apply]');
  }

  /*
   * Two ways to know where the applications live, and only two.
   *
   * With a domain they are derived, as they always were. Without one they are
   * whatever Railway named them, which only the deploy knows — so it prints
   * them and passes them here. `--hosts` rather than an environment variable
   * because it is data produced by the step before, not configuration.
   */
  const supplied = value('--hosts');
  const hosts = supplied
    ? new Map<string, string>(
        Object.entries(JSON.parse(supplied) as Record<string, string>).map(([name, url]) => [
          name,
          url.replace(/^https?:\/\//, '').replace(/\/$/, ''),
        ]),
      )
    : domain
      ? hostsFor(readCatalogue(), domain, environment)
      : null;
  if (!hosts) {
    throw new Error('neither DEPLOY_DOMAIN nor --hosts is set; the realm has no hostnames to point its redirect URIs at');
  }

  // Keycloak's own public URL. Derived alongside the rest when there is a
  // domain; read from KEYCLOAK_URL when Railway named it, since Keycloak is a
  // managed service this pipeline does not deploy and cannot discover.
  const authUrl = domain ? `https://${authHost(domain, environment)}` : process.env.KEYCLOAK_URL;
  if (!authUrl) throw new Error('KEYCLOAK_URL is not set, and without DEPLOY_DOMAIN there is nothing to derive it from');

  const resolved = resolveRealm(readRealm(), hosts, authUrl);
  const left = unresolvedPlaceholders(resolved);
  // A realm applied with `__DOMAIN__` still in it is a realm whose redirect
  // URIs match nothing, so this refuses rather than warns.
  if (left.length > 0) throw new Error(`the realm still has ${PLACEHOLDER} at: ${left.join(', ')}`);

  if (out) {
    writeFileSync(out, `${JSON.stringify(resolved, null, 2)}\n`);
    console.log(`realm for ${environment} written to ${out}`);
  }

  if (shouldApply) {
    const baseUrl = process.env.KEYCLOAK_URL?.replace(/\/$/, '');
    const clientId = process.env.KEYCLOAK_ADMIN_CLIENT_ID;
    const clientSecret = process.env.KEYCLOAK_ADMIN_CLIENT_SECRET;
    if (!baseUrl || !clientId || !clientSecret) {
      throw new Error('KEYCLOAK_URL, KEYCLOAK_ADMIN_CLIENT_ID and KEYCLOAK_ADMIN_CLIENT_SECRET must all be set to --apply');
    }
    await apply(resolved, baseUrl, await adminToken(baseUrl, clientId, clientSecret));
  }
}

if (process.argv[1]?.endsWith('keycloak-realm.ts')) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
