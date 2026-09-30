import type { Client } from '../client.js';
import type { Me, NotificationInbox, TeamListRow, TeamMemberRow, UserQuery, UserRow } from './types.js';
import { builders, type Builders } from './builders.js';
import { getUser, listTeamMembers, listTeams, listUsers, markNotificationRead, notificationInbox } from './common.js';
import { operations, type Operations } from './operations.js';

export type { UserRow } from './types.js';

/**
 * The administration console's view of the API.
 *
 * Two audiences in one surface, and the split is deliberate rather than
 * cosmetic. `tenant.*` is what an administrator of one desk may do;
 * `platform.*` is what an operator of the whole deployment may do, and every
 * one of those calls answers 403 to anybody without `platform.tenant.manage`
 * — no role in the shipped role seed has it.
 *
 * Keeping them in separate objects means a screen has to reach across the
 * split deliberately. It is not a security boundary — the API is — but it is
 * the difference between calling a platform endpoint on purpose and calling
 * one because it was the next property along.
 */

export interface TeamRow {
  id: string;
  key: string;
  name: string;
  orgId: string | null;
}

export interface OrganisationRow {
  id: string;
  name: string;
  code: string | null;
  path: string;
  parentId: string | null;
}

/** A role and exactly what it grants, for choosing what to give somebody. */
export interface RoleRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  /** Shipped with the platform: listed first, least access to most. */
  isSystem: boolean;
  permissions: { key: string; scope: string }[];
}

/**
 * One grant of a role to a person. `id` is what `removeRoleAssignment`
 * takes; `viaScim` means the identity provider granted it, and removing it by
 * hand lasts only until the next sync.
 */
export interface RoleAssignmentRow {
  id: string;
  roleKey: string;
  roleName: string;
  scopeType: string | null;
  scopeId: string | null;
  validFrom: string;
  /** Expired assignments are listed too: one still occupies its slot. */
  validTo: string | null;
  viaScim: boolean;
}

export interface PermissionRow {
  key: string;
  module: string;
  scopes: string[];
  description: string | null;
}

/**
 * What kind of value a setting takes, described from the declaring module's
 * schema so a form can offer the right control.
 *
 * `object`, `record` and `json` are for the few structured settings; a console
 * shows those — and any kind it does not recognise — as read-only JSON rather
 * than guessing at a form for them.
 */
export type SettingType =
  | { kind: 'enum'; options: string[] }
  | { kind: 'number'; int: boolean; min?: number; max?: number; minExclusive?: true; maxExclusive?: true }
  | { kind: 'boolean' }
  /** `min` and `max` are lengths, in characters. */
  | { kind: 'string'; min?: number; max?: number }
  | { kind: 'object'; fields: Record<string, SettingType> }
  | { kind: 'record'; keys?: string[]; value: SettingType }
  | { kind: 'json' };

/** Where a setting's value came from: the caller's organisation, the tenant, or the module's default. */
export type SettingSource = 'organisation' | 'tenant' | 'platform-default';

/**
 * A declared setting with the value that applies to the caller.
 *
 * `version`, `publishedAt` and `publishedBy` belong to the version in force
 * and are null for a default, so a page can say "Changed by Alex · 3 Sep"
 * without asking for the history.
 */
export interface SettingRow {
  key: string;
  module: string;
  scopes: ('platform' | 'tenant' | 'organisation')[];
  default: unknown;
  description: string | null;
  value: unknown;
  source: SettingSource;
  scopeId: string | null;
  version: number | null;
  publishedAt: string | null;
  publishedBy: string | null;
  type: SettingType;
}

/** One setting resolved for the caller, as `GET /settings/:key` answers. */
export interface ResolvedSetting {
  key: string;
  value: unknown;
  source: SettingSource;
  scopeId: string | null;
  version: number | null;
}

export interface SettingVersionRow {
  version: number;
  value: unknown;
  reason: string | null;
  publishedAt: string;
  publishedBy: string | null;
}

/**
 * A declared feature flag with the tenant's own state.
 *
 * `tenantValue` is the tenant-wide override (null when there is none) and
 * `value` is what the tenant gets: the override, or else the default. It is
 * the tenant's value on purpose, not the caller's, because the switch that
 * shows it sets the tenant's value.
 */
export interface FlagRow {
  key: string;
  module: string;
  default: boolean;
  owner: string;
  /** The phase by which the flag must be removed, or `permanent`. */
  expires: string;
  description: string | null;
  tenantValue: boolean | null;
  value: boolean;
  /**
   * `value`, under the name an earlier version of this type used. The API has
   * never sent `enabled`; `flags()` copies `value` into it so a page written
   * against the old type shows the real state while it moves to `value`.
   * @deprecated read `value`.
   */
  enabled: boolean;
}

/** A module installed for the tenant, with what its manifest says about it. */
export interface ModuleRow {
  id: string;
  moduleId: string;
  version: string;
  enabled: boolean;
  seededAt: string | null;
  installedAt: string;
  updatedAt: string;
  name: string;
  phase: string | null;
  /** False for a foundation module, which cannot be turned off. */
  optional: boolean;
  dependsOn: string[];
}

/** The configuration part of the audit trail: settings, flags, modules, roles, webhooks. */
export interface ActivityRow {
  id: string;
  action: string;
  actorType: string;
  actorId: string | null;
  targetType: string;
  targetId: string;
  occurredAt: string;
}

export type UsageMeterKey = 'agents' | 'tickets' | 'storage' | 'api_calls';

export interface UsageMeter {
  meter: UsageMeterKey;
  description: string;
  unit: 'people' | 'tickets' | 'bytes' | 'calls';
  /** `live` is a level now (agents); `counted` accumulates over `period`. */
  shape: 'live' | 'counted';
  period: string;
  value: number;
  /** The value in words: "50 GB", not 53687091200. */
  display: string;
  state: 'ok' | 'warned' | 'blocked';
  /** The warning line, which the tenant may move; null where there is none. */
  soft: number | null;
  /** The plan's refusal line; null where the plan sets none. */
  hard: number | null;
}

export interface UsageReport {
  plan: { key: string; name: string; description: string | null } | null;
  meters: UsageMeter[];
}

export interface WebhookRow {
  id: string;
  name: string;
  url: string;
  eventTypes: string[];
  status: string;
  failureCount: number;
}

export interface FieldRow {
  id: string;
  key: string;
  label: string;
  type: string;
  options: { value: string; label: string }[];
  appliesTo: { types: string[] };
  requiredWhen: unknown;
  visibleTo: string[];
  classification: string;
  order: number;
  isActive: boolean;
}

export interface TenantRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  region: string;
  createdAt: string;
  /** The plan the tenant is sold on; null when it has none. Absent from an API that predates it. */
  planKey?: string | null;
  /** Where the tenant's prompts may be processed; empty means "where its data lives". */
  aiAllowedRegions?: string[];
  suspendedAt?: string | null;
}

/** One tenant's meters, as the platform sees them (`GET /api/platform/v1/tenants/:id/usage`). */
export interface PlatformTenantUsage {
  /** `none` when the tenant is on no plan. */
  planKey: string;
  meters: {
    meter: UsageMeterKey;
    value: number;
    display: string;
    state: 'ok' | 'warned' | 'blocked';
    period: string;
    soft: number | null;
    hard: number | null;
  }[];
}

export interface PlanRow {
  key: string;
  name: string;
  description: string | null;
  features: string[];
  /** Micro-pence per agent per month, as a string. Null when not sold at list. */
  pricePerAgentMicros: string | null;
  currency: string;
  isRetired: boolean;
  sortOrder: number;
  limits: { meter: string; soft: string | null; hard: string | null }[];
}

export interface Admin {
  me(): Promise<Me>;

  /**
   * How this desk behaves: rules, SLAs, the catalogue and workflows.
   *
   * A third namespace rather than more of `tenant` because it answers a
   * different question. `tenant.*` is who may use the desk and what it
   * collects; `configure.*` is what it does on its own. Both are tenant-scoped
   * and neither is the platform surface below.
   */
  readonly configure: Builders;

  /**
   * What the desk is doing: its queues, its tickets, its estate, its numbers,
   * its integrations and its audit trail.
   *
   * A fourth namespace because it answers the fourth question. `tenant.*` is
   * who may use the desk, `configure.*` is what it does on its own, and this is
   * what has actually happened — mostly reads, with the writes that act on
   * what it shows, and tenant-scoped like the other two.
   */
  readonly observe: Operations;

  /** What an administrator of one desk may do. */
  readonly tenant: {
    /**
     * People. A string is a search, the original signature; the object form
     * adds a page size, a status and a lookup by ids.
     */
    users(query?: string | UserQuery): Promise<UserRow[]>;
    user(id: string): Promise<UserRow>;
    createUser(input: { email: string; displayName: string; primaryOrgId?: string }): Promise<UserRow>;
    deactivateUser(id: string, reason?: string): Promise<unknown>;
    /** Roles are not restored — deactivating removed them — so offer "Add a role" next. */
    reactivateUser(id: string, reason?: string): Promise<{ id: string; status: 'active' }>;
    roles(): Promise<RoleRow[]>;
    roleAssignments(userId: string): Promise<RoleAssignmentRow[]>;
    assignRole(
      userId: string,
      roleKey: string,
      scope?: { scopeType: 'organisation' | 'team' | 'service'; scopeId: string },
    ): Promise<unknown>;
    removeRoleAssignment(id: string): Promise<unknown>;
    organisations(): Promise<OrganisationRow[]>;
    createOrganisation(input: { name: string; code: string; parentId?: string; type?: string }): Promise<Omit<OrganisationRow, 'parentId'>>;
    teams(): Promise<TeamListRow[]>;
    teamMembers(teamId: string): Promise<TeamMemberRow[]>;
    createTeam(input: { key: string; name: string; orgId: string }): Promise<TeamRow>;
    addTeamMember(teamId: string, userId: string, isLead?: boolean): Promise<unknown>;
    permissions(): Promise<PermissionRow[]>;
    settings(): Promise<SettingRow[]>;
    setting(key: string): Promise<ResolvedSetting>;
    settingVersions(key: string): Promise<SettingVersionRow[]>;
    setSetting(
      key: string,
      value: unknown,
      options?: { reason?: string; scopeType?: 'tenant' | 'organisation'; scopeId?: string },
    ): Promise<{ settingId: string; version: number }>;
    /** Publishes the old value as a new version, so the history stays in one line. */
    rollbackSetting(key: string, toVersion: number, reason?: string): Promise<{ version: number; restoredFrom: number }>;
    flags(): Promise<FlagRow[]>;
    setFlag(
      key: string,
      value: boolean,
      options?: { reason?: string; scopeType?: 'tenant' | 'organisation'; scopeId?: string },
    ): Promise<{ key: string; value: boolean; scopeType: string }>;
    modules(): Promise<ModuleRow[]>;
    setModuleEnabled(moduleId: string, enabled: boolean): Promise<{ moduleId: string; enabled: boolean }>;
    activity(limit?: number): Promise<ActivityRow[]>;
    usage(): Promise<UsageReport>;
    /** Moves the warning line; refused above the plan's hard line. Null removes it. */
    setSoftLimit(
      meter: UsageMeterKey,
      soft: number | null,
    ): Promise<{ meter: UsageMeterKey; planKey: string; soft: number | null; hard: number | null }>;
    notifications(options?: { unread?: boolean; limit?: number }): Promise<NotificationInbox>;
    markNotificationRead(id: string | 'all'): Promise<{ marked: number }>;
    webhooks(): Promise<WebhookRow[]>;
    /** The signing secret comes back once, here, and never again. */
    createWebhook(input: { name: string; url: string; eventTypes: string[]; filters?: unknown }): Promise<{
      id: string;
      name: string;
      url: string;
      secret: string;
    }>;
    deleteWebhook(id: string): Promise<void>;
    fields(includeInactive?: boolean): Promise<FieldRow[]>;
    saveField(key: string, input: Record<string, unknown>): Promise<FieldRow>;
    deactivateField(key: string): Promise<FieldRow>;
    /** The undo for `deactivateField`. An active field comes back as it is. */
    reactivateField(key: string): Promise<FieldRow>;
  };

  /** What an operator of the deployment may do. 403 for everybody else. */
  readonly platform: {
    tenants(): Promise<TenantRow[]>;
    plans(): Promise<PlanRow[]>;
    setAiRegions(tenantId: string, regions: string[]): Promise<{ id: string; aiAllowedRegions: string[] }>;
    tenantUsage(tenantId: string): Promise<PlatformTenantUsage>;
    /** Every call for the tenant is refused until it is resumed. The reason is kept on the audit trail. */
    suspendTenant(tenantId: string, reason?: string): Promise<{ id: string; status: 'suspended' }>;
    resumeTenant(tenantId: string): Promise<{ id: string; status: 'active' }>;
    /** Refused (409) for a retired plan the tenant is not already on. */
    assignPlan(tenantId: string, planKey: string): Promise<{ id: string; planKey: string | null }>;
  };
}

const unwrap = <T>(body: { data: T }): T => body.data;

export function admin(client: Client): Admin {
  return {
    me: () => client.request<Me>('/api/v1/me'),

    configure: builders(client),

    observe: operations(client),

    tenant: {
      users: (query) => listUsers(client, typeof query === 'string' ? { q: query } : (query ?? {})),
      user: (id) => getUser(client, id),
      createUser: (input) => client.request<UserRow>('/api/v1/users', { method: 'POST', body: input }),
      deactivateUser: (id, reason) =>
        client.request(`/api/v1/users/${encodeURIComponent(id)}/deactivate`, {
          method: 'POST',
          body: reason ? { reason } : {},
        }),
      reactivateUser: (id, reason) =>
        client.request<{ id: string; status: 'active' }>(`/api/v1/users/${encodeURIComponent(id)}/reactivate`, {
          method: 'POST',
          body: reason ? { reason } : {},
        }),
      roles: () => client.request<{ data: RoleRow[] }>('/api/v1/roles').then(unwrap),
      roleAssignments: (userId) =>
        client
          .request<{ data: RoleAssignmentRow[] }>(`/api/v1/users/${encodeURIComponent(userId)}/role-assignments`)
          .then(unwrap),
      assignRole: (userId, roleKey, scope) =>
        client.request('/api/v1/role-assignments', { method: 'POST', body: { userId, roleKey, ...(scope ?? {}) } }),
      removeRoleAssignment: (id) =>
        client.request(`/api/v1/role-assignments/${encodeURIComponent(id)}`, { method: 'DELETE' }),
      organisations: () => client.request<{ data: OrganisationRow[] }>('/api/v1/organisations').then(unwrap),
      createOrganisation: (input) =>
        client.request<Omit<OrganisationRow, 'parentId'>>('/api/v1/organisations', { method: 'POST', body: input }),
      teams: () => listTeams(client),
      teamMembers: (teamId) => listTeamMembers(client, teamId),
      createTeam: (input) => client.request<TeamRow>('/api/v1/teams', { method: 'POST', body: input }),
      addTeamMember: (teamId, userId, isLead = false) =>
        client.request(`/api/v1/teams/${encodeURIComponent(teamId)}/members`, {
          method: 'POST',
          body: { userId, isLead },
        }),
      permissions: () => client.request<{ data: PermissionRow[] }>('/api/v1/permissions').then(unwrap),
      settings: () => client.request<{ data: SettingRow[] }>('/api/v1/settings').then(unwrap),
      setting: (key) => client.request<ResolvedSetting>(`/api/v1/settings/${encodeURIComponent(key)}`),
      settingVersions: (key) =>
        client.request<{ data: SettingVersionRow[] }>(`/api/v1/settings/${encodeURIComponent(key)}/versions`).then(unwrap),
      setSetting: (key, value, options = {}) =>
        client.request<{ settingId: string; version: number }>(`/api/v1/settings/${encodeURIComponent(key)}`, {
          method: 'PUT',
          body: { value, ...options },
        }),
      rollbackSetting: (key, toVersion, reason) =>
        client.request<{ version: number; restoredFrom: number }>(`/api/v1/settings/${encodeURIComponent(key)}/rollback`, {
          method: 'POST',
          body: { toVersion, ...(reason ? { reason } : {}) },
        }),
      flags: () =>
        client
          .request<{ data: Omit<FlagRow, 'enabled'>[] }>('/api/v1/feature-flags')
          .then(unwrap)
          .then((rows) => rows.map((row) => ({ ...row, enabled: row.value }))),
      // `{ value }`, not `{ enabled }`: the route's body is strict, and every
      // switch on the old settings page answered 422 because of this one word.
      setFlag: (key, value, options = {}) =>
        client.request<{ key: string; value: boolean; scopeType: string }>(`/api/v1/feature-flags/${encodeURIComponent(key)}`, {
          method: 'PUT',
          body: { value, ...options },
        }),
      modules: () => client.request<{ data: ModuleRow[] }>('/api/v1/modules').then(unwrap),
      setModuleEnabled: (moduleId, enabled) => {
        const action = enabled ? 'enable' : 'disable';
        return client.request<{ moduleId: string; enabled: boolean }>(`/api/v1/modules/${encodeURIComponent(moduleId)}/${action}`, {
          method: 'POST',
          body: {},
        });
      },
      activity: (limit) =>
        client.request<{ data: ActivityRow[] }>('/api/v1/admin/activity', { query: { limit } }).then(unwrap),
      usage: () => client.request<UsageReport>('/api/v1/usage'),
      setSoftLimit: (meter, soft) =>
        client.request(`/api/v1/usage/limits/${encodeURIComponent(meter)}`, { method: 'PUT', body: { soft } }),
      notifications: (options = {}) => notificationInbox(client, options),
      markNotificationRead: (id) => markNotificationRead(client, id),
      webhooks: () => client.request<{ data: WebhookRow[] }>('/api/v1/webhooks').then(unwrap),
      createWebhook: (input) => client.request('/api/v1/webhooks', { method: 'POST', body: input }),
      deleteWebhook: (id) => client.request<void>(`/api/v1/webhooks/${encodeURIComponent(id)}`, { method: 'DELETE' }),
      fields: (includeInactive = false) =>
        client
          .request<{ data: FieldRow[] }>('/api/v1/field-definitions', { query: { includeInactive } })
          .then(unwrap),
      saveField: (key, input) =>
        client.request<FieldRow>(`/api/v1/field-definitions/${encodeURIComponent(key)}`, { method: 'PUT', body: input }),
      deactivateField: (key) =>
        client.request<FieldRow>(`/api/v1/field-definitions/${encodeURIComponent(key)}`, { method: 'DELETE' }),
      reactivateField: (key) =>
        client.request<FieldRow>(`/api/v1/field-definitions/${encodeURIComponent(key)}/reactivate`, {
          method: 'POST',
          body: {},
        }),
    },

    platform: {
      tenants: () => client.request<{ data: TenantRow[] }>('/api/platform/v1/tenants').then(unwrap),
      plans: () => client.request<{ data: PlanRow[] }>('/api/platform/v1/plans').then(unwrap),
      setAiRegions: (tenantId, regions) =>
        client.request<{ id: string; aiAllowedRegions: string[] }>(
          `/api/platform/v1/tenants/${encodeURIComponent(tenantId)}/ai-regions`,
          { method: 'PUT', body: { regions } },
        ),
      tenantUsage: (tenantId) => client.request<PlatformTenantUsage>(`/api/platform/v1/tenants/${encodeURIComponent(tenantId)}/usage`),
      suspendTenant: (tenantId, reason) =>
        client.request<{ id: string; status: 'suspended' }>(`/api/platform/v1/tenants/${encodeURIComponent(tenantId)}/suspend`, {
          method: 'POST',
          body: reason ? { reason } : {},
        }),
      resumeTenant: (tenantId) =>
        client.request<{ id: string; status: 'active' }>(`/api/platform/v1/tenants/${encodeURIComponent(tenantId)}/resume`, {
          method: 'POST',
          body: {},
        }),
      assignPlan: (tenantId, planKey) =>
        client.request<{ id: string; planKey: string | null }>(`/api/platform/v1/tenants/${encodeURIComponent(tenantId)}/plan`, {
          method: 'PUT',
          body: { planKey },
        }),
    },
  };
}
