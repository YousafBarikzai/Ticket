import { ScimError } from './errors.js';

/**
 * The shapes SCIM 2.0 exchanges (RFC 7643), and how they map onto a user and
 * a team.
 *
 * A SCIM user's `userName` is the login name; here it is the email, which is
 * also how an account is found on first login (JIT) and by an import, so
 * the three sources agree on who somebody is. `externalId` is the
 * provider's own identifier and is stored as such, never confused with the
 * OIDC subject: Entra sends a different value in each.
 */

export const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
export const GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group';
export const LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
export const PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

export interface ScimUserInput {
  userName: string;
  externalId: string | null;
  displayName: string;
  active: boolean;
  locale: string | null;
  timeZone: string | null;
}

export interface UserLike {
  id: string;
  email: string;
  displayName: string;
  status: string;
  scimExternalId: string | null;
  locale: string;
  timeZone: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TeamLike {
  id: string;
  name: string;
  scimExternalId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/**
 * Reads what a provider posted. The display name is taken from
 * `displayName`, then `name.formatted`, then given and family names, then
 * the login name: providers differ on which they fill in, and a person
 * called by their email address is the last resort, not the first.
 */
export function fromScimUser(body: unknown): ScimUserInput {
  const resource = (body ?? {}) as Record<string, unknown>;
  const name = (resource.name ?? {}) as Record<string, unknown>;
  const emails = Array.isArray(resource.emails) ? (resource.emails as { value?: unknown; primary?: unknown }[]) : [];
  const primaryEmail = text(emails.find((email) => email.primary === true)?.value) ?? text(emails[0]?.value);

  const userName = text(resource.userName) ?? primaryEmail;
  if (!userName) throw new ScimError(400, 'userName is required', 'invalidValue');
  const email = primaryEmail && primaryEmail.includes('@') ? primaryEmail : userName;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ScimError(400, 'userName or a primary email must be an email address; this platform signs people in by it', 'invalidValue');
  }

  const displayName =
    text(resource.displayName) ??
    text(name.formatted) ??
    [text(name.givenName), text(name.familyName)].filter(Boolean).join(' ') ??
    undefined;

  const active = resource.active === undefined ? true : typeof resource.active === 'boolean' ? resource.active : String(resource.active).toLowerCase() === 'true';

  return {
    userName: email.toLowerCase(),
    externalId: text(resource.externalId) ?? null,
    displayName: displayName && displayName !== '' ? displayName : email,
    active,
    locale: text(resource.locale) ?? null,
    timeZone: text(resource.timezone) ?? null,
  };
}

export function toScimUser(user: UserLike, groups: { id: string; name: string }[], location: (path: string) => string) {
  const [givenName, ...rest] = user.displayName.split(' ');
  return {
    schemas: [USER_SCHEMA],
    id: user.id,
    externalId: user.scimExternalId,
    userName: user.email,
    displayName: user.displayName,
    name: { formatted: user.displayName, givenName: givenName ?? user.displayName, familyName: rest.join(' ') },
    emails: [{ value: user.email, type: 'work', primary: true }],
    active: user.status === 'active',
    locale: user.locale,
    timezone: user.timeZone,
    groups: groups.map((group) => ({ value: group.id, display: group.name, $ref: location(`/Groups/${group.id}`) })),
    meta: {
      resourceType: 'User',
      created: user.createdAt.toISOString(),
      lastModified: user.updatedAt.toISOString(),
      location: location(`/Users/${user.id}`),
    },
  };
}

export interface ScimGroupInput {
  displayName: string;
  externalId: string | null;
  memberIds: string[];
}

export function fromScimGroup(body: unknown): ScimGroupInput {
  const resource = (body ?? {}) as Record<string, unknown>;
  const displayName = text(resource.displayName);
  if (!displayName) throw new ScimError(400, 'displayName is required', 'invalidValue');
  const members = Array.isArray(resource.members) ? (resource.members as { value?: unknown }[]) : [];
  return {
    displayName,
    externalId: text(resource.externalId) ?? null,
    memberIds: members.map((member) => text(member.value)).filter((id): id is string => Boolean(id)),
  };
}

export function toScimGroup(team: TeamLike, members: { id: string; displayName: string }[], location: (path: string) => string) {
  return {
    schemas: [GROUP_SCHEMA],
    id: team.id,
    externalId: team.scimExternalId,
    displayName: team.name,
    members: members.map((member) => ({ value: member.id, display: member.displayName, $ref: location(`/Users/${member.id}`) })),
    meta: {
      resourceType: 'Group',
      created: team.createdAt.toISOString(),
      lastModified: team.updatedAt.toISOString(),
      location: location(`/Groups/${team.id}`),
    },
  };
}

export function listResponse<T>(resources: T[], totalResults: number, startIndex: number) {
  return { schemas: [LIST_SCHEMA], totalResults, startIndex, itemsPerPage: resources.length, Resources: resources };
}

/** What the server tells a provider it can do. Honest, which is the point. */
export function serviceProviderConfig(location: (path: string) => string) {
  return {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
    documentationUri: 'https://docs.itsm.example/scim',
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: 'oauthbearertoken',
        name: 'Bearer token',
        description: 'A per-tenant token issued by an administrator and rotated through the API.',
        primary: true,
      },
    ],
    meta: { resourceType: 'ServiceProviderConfig', location: location('/ServiceProviderConfig') },
  };
}

export function resourceTypes(location: (path: string) => string) {
  return listResponse(
    [
      { schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'], id: 'User', name: 'User', endpoint: '/Users', schema: USER_SCHEMA, meta: { resourceType: 'ResourceType', location: location('/ResourceTypes/User') } },
      { schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'], id: 'Group', name: 'Group', endpoint: '/Groups', schema: GROUP_SCHEMA, meta: { resourceType: 'ResourceType', location: location('/ResourceTypes/Group') } },
    ],
    2,
    1,
  );
}
