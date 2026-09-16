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
import { hostFor, readCatalogue, type Catalogue } from './railway-deploy.js';

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

export function resolveRealm(realm: Realm, catalogue: Catalogue, domain: string, environment: string): Realm {
  const hostOf = (serviceName: string): string => {
    const service = catalogue.services.find((one) => one.name === serviceName);
    const host = service ? hostFor(service, domain, environment) : null;
    // Thrown rather than defaulted: a client whose application is not in the
    // catalogue would otherwise get a plausible hostname for an application
    // that is not deployed, and sign-in would fail at the redirect.
    if (!host) throw new Error(`the catalogue gives no public host for ${serviceName}, which client config needs`);
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
    attributes: { ...realm.attributes, frontendUrl: `https://${authHost(domain, environment)}` },
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

/** The realm's own settings, which a partial import does not carry. */
export function realmSettings(realm: Realm): Record<string, unknown> {
  const { clients: _clients, clientScopes: _scopes, ...rest } = realm as Record<string, unknown>;
  // The `$comment` and `comment.*` keys are for whoever opens the file; Keycloak
  // would either reject them or store them, and neither is wanted.
  return Object.fromEntries(Object.entries(rest).filter(([key]) => !key.startsWith('comment.') && key !== '$comment'));
}

async function adminToken(baseUrl: string, clientId: string, clientSecret: string): Promise<string> {
  const response = await fetch(`${baseUrl}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Keycloak refused the admin credentials: ${response.status}`);
  return ((await response.json()) as { access_token: string }).access_token;
}

async function apply(realm: Realm, baseUrl: string, token: string): Promise<void> {
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const exists = await fetch(`${baseUrl}/admin/realms/${realm.realm}`, { headers });

  if (exists.status === 404) {
    const created = await fetch(`${baseUrl}/admin/realms`, { method: 'POST', headers, body: JSON.stringify(realm) });
    if (!created.ok) throw new Error(`could not create the realm: ${created.status} ${await created.text()}`);
    console.log(`created realm ${realm.realm}`);
    return;
  }
  if (!exists.ok) throw new Error(`could not read the realm: ${exists.status}`);

  const updated = await fetch(`${baseUrl}/admin/realms/${realm.realm}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(realmSettings(realm)),
  });
  if (!updated.ok) throw new Error(`could not update the realm: ${updated.status} ${await updated.text()}`);

  const imported = await fetch(`${baseUrl}/admin/realms/${realm.realm}/partialImport`, {
    method: 'POST',
    headers,
    body: JSON.stringify(partialImportBody(realm)),
  });
  if (!imported.ok) throw new Error(`could not import the clients: ${imported.status} ${await imported.text()}`);
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
    throw new Error('usage: keycloak-realm.ts --environment <name> [--out <file>] [--apply]');
  }
  if (!domain) throw new Error('DEPLOY_DOMAIN is not set; every hostname in the realm is derived from it');

  const resolved = resolveRealm(readRealm(), readCatalogue(), domain, environment);
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
