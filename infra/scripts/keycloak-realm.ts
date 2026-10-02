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
 *   tsx infra/scripts/keycloak-realm.ts --environment staging --apply --theme itsm
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AREAS, type AreaId } from '@itsm/contracts/areas';
import { hostsFor, readCatalogue, type Catalogue } from './railway-deploy.js';

export const PLACEHOLDER = '__DOMAIN__';

/** The three applications a person signs in to, by their service name, which is the area's id. */
export type ClientApplication = AreaId;

/** Which application each confidential client signs people in to. */
const CLIENT_SERVICE: Readonly<Record<string, ClientApplication>> = {
  'itsm-portal': 'portal',
  'itsm-workbench': 'workbench',
  'itsm-admin': 'admin',
};

/**
 * The name each application's client shows people.
 *
 * Keycloak puts it in front of them twice: the account page lists the
 * applications a person has used by it, and the product's login theme says
 * "Signing in to Service Desk" with it. So it is the area's name, the one the
 * applications call themselves, rather than a description written for whoever
 * administers Keycloak — read from `AREAS` (`@itsm/contracts/areas`), the one
 * place every area's name is written, so the identity provider cannot drift
 * from the switcher. Set here, at resolve time, rather than only in
 * `realm.json`, so a rename is one constant.
 */
export const CLIENT_NAMES: Readonly<Record<ClientApplication, string>> = {
  portal: AREAS.portal.name,
  workbench: AREAS.workbench.name,
  admin: AREAS.admin.name,
};

/**
 * The realm's theme, when the deploy says which.
 *
 * `itsm` only once the deploy has confirmed the image carrying that theme is
 * the one running; `default` is the owner's opt-out back to Keycloak's own.
 * Absent means the realm is sent with no theme key at all, and Keycloak keeps
 * whatever it already has — which is what every outcome short of a verified
 * image switch must do.
 */
export type RealmTheme = 'itsm' | 'default';

/** The keys that name a theme. `realm.json` carries none of them; see `resolveRealm`. */
export const THEME_KEYS = ['loginTheme', 'accountTheme', 'emailTheme'] as const;

/** What each `--theme` value sets. The account page has its own built-in theme, a version ahead of the login one. */
const THEME_SETTINGS: Readonly<Record<RealmTheme, Readonly<Record<string, string>>>> = {
  itsm: { loginTheme: 'itsm', accountTheme: 'itsm' },
  default: { loginTheme: 'keycloak.v2', accountTheme: 'keycloak.v3' },
};

export interface ResolveOptions {
  /** The demo is on, so the sign-in pages may offer it (D18). From `demoModeOf`. */
  readonly demo?: boolean;
  readonly theme?: RealmTheme;
}

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
export function resolveRealm(realm: Realm, hosts: ReadonlyMap<string, string>, authUrl: string, options: ResolveOptions = {}): Realm {
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
      name: CLIENT_NAMES[serviceName],
      // From the same host as the redirect URI, so the way back from one of
      // Keycloak's own pages cannot lead somewhere the sign-in would not.
      baseUrl: `https://${host}/`,
      redirectUris: [`https://${host}/api/session/callback`],
      attributes: { ...client.attributes, 'post.logout.redirect.uris': `https://${host}/*` },
    };
  });

  /*
   * The public site, for the login theme's footer (D18). Unlike a client's
   * host, a missing site is not an error: the site has no Keycloak client, so
   * a deployment without one signs people in perfectly well and the footer
   * simply draws no link to a home that does not exist. Empty rather than
   * absent, so that turning the demo off clears a link the realm already has.
   */
  const site = hosts.get('site');
  const homeUrl = site ? `https://${site}/` : '';
  const demoUrl = site && options.demo ? `https://${site}/sign-in?start=demo` : '';

  // No theme unless told, whatever the file says: every deploy PUTs these
  // settings, so a theme key that arrived by any other route would switch the
  // realm to a theme whose image may never have been deployed.
  const unthemed = Object.fromEntries(Object.entries(realm).filter(([key]) => !(THEME_KEYS as readonly string[]).includes(key))) as Realm;

  return {
    ...unthemed,
    ...(options.theme ? THEME_SETTINGS[options.theme] : {}),
    attributes: {
      ...realm.attributes,
      frontendUrl: authUrl.replace(/\/$/, ''),
      'itsm.homeUrl': homeUrl,
      'itsm.demoUrl': demoUrl,
    },
    clients,
  };
}

/**
 * Whether the deployment runs the demo, from the one place that decides it:
 * the site's `DEMO_MODE` in `services.json`.
 *
 * Read from the catalogue rather than passed in by the workflow, so the realm
 * and the services it links to cannot disagree about whether there is a demo
 * to link to, and the deploy gains no input for somebody to forget.
 */
export function demoModeOf(catalogue: Catalogue): boolean {
  return catalogue.services.find((service) => service.name === 'site')?.variables?.DEMO_MODE === 'on';
}

/**
 * The `--theme` flag, or undefined when it is not given.
 *
 * A value it does not know is refused rather than ignored. Ignoring it would
 * apply the realm with no theme key, which reports success and changes
 * nothing — the failure mode this script exists to avoid.
 */
export function themeFlag(argv: readonly string[]): RealmTheme | undefined {
  const index = argv.indexOf('--theme');
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (value === 'itsm' || value === 'default') return value;
  throw new Error(`--theme takes itsm or default, not ${value === undefined ? 'nothing' : JSON.stringify(value)}`);
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
 *
 * `OVERWRITE` deletes each client and creates it again, and a confidential
 * client created without a `secret` is given a new random one. So `secrets`
 * carries each client's current secret back in: without it every deploy
 * rotates the secret the portal, workbench and console sign in with, and all
 * three stop being able to sign anybody in until a person copies the new ones
 * across.
 */
export function partialImportBody(realm: Realm, secrets: ReadonlyMap<string, string> = new Map()): Record<string, unknown> {
  return {
    ifResourceExists: 'OVERWRITE',
    clients: realm.clients.map((client) => {
      const secret = secrets.get(client.clientId);
      return secret ? { ...client, secret } : client;
    }),
    clientScopes: (realm as { clientScopes?: unknown[] }).clientScopes ?? [],
  };
}

/**
 * The scopes the realm declares that Keycloak does not have yet.
 *
 * A partial import does not carry client scopes at all — it takes clients,
 * roles, groups, users and identity providers — so a scope added to the file
 * after the realm was created reaches Keycloak only if something creates it.
 * Existing scopes are left as they are.
 */
export function missingScopes(realm: Realm, existing: readonly string[]): Record<string, unknown>[] {
  const have = new Set(existing);
  const declared = ((realm as { clientScopes?: { name: string }[] }).clientScopes ?? []) as ({ name: string } & Record<string, unknown>)[];
  return declared.filter((scope) => !have.has(scope.name));
}

/**
 * Keycloak's own clients, and the default scopes each has to have.
 *
 * Keycloak creates these with every realm, linked to whichever scopes exist at
 * that moment — and a realm created from a file that names any scope starts
 * with only those. This one began with `itsm-claims` alone, so its account page
 * (`/realms/<realm>/account`) signed people in with a token naming nobody and
 * holding no roles, and its API refused every request: "Something went wrong".
 * They are not in `realm.json` because the partial import would delete and
 * recreate them, losing what Keycloak set up on them; this is attached instead.
 */
export const BUILT_IN_CLIENT_SCOPES: Readonly<Record<string, readonly string[]>> = {
  'account-console': ['basic', 'roles', 'profile', 'email', 'web-origins', 'acr'],
};

/** The scopes a client should have and does not, in the order they are wanted. */
export function scopesToAttach(wanted: readonly string[], attached: readonly string[]): string[] {
  const have = new Set(attached);
  return wanted.filter((scope) => !have.has(scope));
}

/** The clients that sign people in with a secret: not public, and not a resource server. */
export function confidentialClients(realm: Realm): string[] {
  return realm.clients.filter((client) => client.publicClient === false && client.bearerOnly !== true).map((client) => client.clientId);
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

/**
 * Each existing confidential client's secret, so the import can keep it.
 *
 * A client that does not exist yet has no secret to keep, and Keycloak makes
 * one when the import creates it.
 */
async function currentSecrets(realm: Realm, baseUrl: string, headers: Record<string, string>): Promise<Map<string, string>> {
  const secrets = new Map<string, string>();
  for (const clientId of confidentialClients(realm)) {
    const listed = await fetch(`${baseUrl}/admin/realms/${realm.realm}/clients?clientId=${encodeURIComponent(clientId)}`, { headers });
    if (!listed.ok) throw new Error(`could not read client ${clientId}: ${listed.status}${permissionHint(listed.status)}`);
    const [client] = (await listed.json()) as { id: string }[];
    if (!client) continue;

    const secret = await fetch(`${baseUrl}/admin/realms/${realm.realm}/clients/${client.id}/client-secret`, { headers });
    if (!secret.ok) throw new Error(`could not read the secret of ${clientId}: ${secret.status}${permissionHint(secret.status)}`);
    const { value } = (await secret.json()) as { value?: string };
    if (value) secrets.set(clientId, value);
  }
  return secrets;
}

/**
 * Creates the declared scopes an existing realm is missing, before the clients
 * that name them are imported — a client is linked only to scopes that exist
 * when it is created.
 */
async function createMissingScopes(realm: Realm, baseUrl: string, headers: Record<string, string>): Promise<void> {
  const listed = await fetch(`${baseUrl}/admin/realms/${realm.realm}/client-scopes`, { headers });
  if (!listed.ok) throw new Error(`could not read the client scopes: ${listed.status}${permissionHint(listed.status)}`);
  const existing = ((await listed.json()) as { name: string }[]).map((scope) => scope.name);

  for (const scope of missingScopes(realm, existing)) {
    const created = await fetch(`${baseUrl}/admin/realms/${realm.realm}/client-scopes`, {
      method: 'POST',
      headers,
      body: JSON.stringify(scope),
    });
    if (!created.ok) {
      throw new Error(`could not create client scope ${String(scope.name)}: ${created.status}${permissionHint(created.status)} ${await created.text()}`);
    }
    console.log(`created client scope ${String(scope.name)}`);
  }
}

/** Gives Keycloak's own clients the default scopes `BUILT_IN_CLIENT_SCOPES` names. */
async function attachBuiltInClientScopes(realm: Realm, baseUrl: string, headers: Record<string, string>): Promise<void> {
  const admin = `${baseUrl}/admin/realms/${realm.realm}`;
  const listed = await fetch(`${admin}/client-scopes`, { headers });
  if (!listed.ok) throw new Error(`could not read the client scopes: ${listed.status}${permissionHint(listed.status)}`);
  const scopeIds = new Map(((await listed.json()) as { id: string; name: string }[]).map((scope) => [scope.name, scope.id]));

  for (const [clientId, wanted] of Object.entries(BUILT_IN_CLIENT_SCOPES)) {
    const found = await fetch(`${admin}/clients?clientId=${encodeURIComponent(clientId)}`, { headers });
    if (!found.ok) throw new Error(`could not read the client ${clientId}: ${found.status}${permissionHint(found.status)}`);
    const [client] = (await found.json()) as { id: string }[];
    if (!client) throw new Error(`the realm has no ${clientId} client, which Keycloak creates with every realm`);

    const current = await fetch(`${admin}/clients/${client.id}/default-client-scopes`, { headers });
    if (!current.ok) throw new Error(`could not read the scopes of ${clientId}: ${current.status}${permissionHint(current.status)}`);
    const attached = ((await current.json()) as { name: string }[]).map((scope) => scope.name);

    for (const name of scopesToAttach(wanted, attached)) {
      const scopeId = scopeIds.get(name);
      if (!scopeId) throw new Error(`${clientId} needs the client scope ${name}, which the realm does not have`);
      const linked = await fetch(`${admin}/clients/${client.id}/default-client-scopes/${scopeId}`, { method: 'PUT', headers });
      if (!linked.ok) {
        throw new Error(`could not give ${clientId} the ${name} scope: ${linked.status}${permissionHint(linked.status)} ${await linked.text()}`);
      }
      console.log(`gave ${clientId} the ${name} scope`);
    }
  }
}

async function apply(realm: Realm, baseUrl: string, token: string): Promise<void> {
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const exists = await fetch(`${baseUrl}/admin/realms/${realm.realm}`, { headers });

  if (exists.status === 404) {
    const created = await fetch(`${baseUrl}/admin/realms`, { method: 'POST', headers, body: JSON.stringify(realmBody(realm)) });
    if (!created.ok) throw new Error(`could not create the realm: ${created.status}${permissionHint(created.status)} ${await created.text()}`);
    console.log(`created realm ${realm.realm}`);
    await attachBuiltInClientScopes(realm, baseUrl, headers);
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

  await createMissingScopes(realm, baseUrl, headers);
  const secrets = await currentSecrets(realm, baseUrl, headers);
  const imported = await fetch(`${baseUrl}/admin/realms/${realm.realm}/partialImport`, {
    method: 'POST',
    headers,
    body: JSON.stringify(partialImportBody(realm, secrets)),
  });
  if (!imported.ok) throw new Error(`could not import the clients: ${imported.status}${permissionHint(imported.status)} ${await imported.text()}`);

  await attachBuiltInClientScopes(realm, baseUrl, headers);
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
  const theme = themeFlag(argv);
  const domain = process.env.DEPLOY_DOMAIN;
  if (!environment || (!out && !shouldApply)) {
    throw new Error('usage: keycloak-realm.ts --environment <name> [--hosts <json>] [--out <file>] [--apply] [--theme itsm|default]');
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

  const resolved = resolveRealm(readRealm(), hosts, authUrl, { demo: demoModeOf(readCatalogue()), theme });
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
