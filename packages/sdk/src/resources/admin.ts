import type { Client } from '../client.js';
import type { Me } from './types.js';
import { builders, type Builders } from './builders.js';
import { operations, type Operations } from './operations.js';

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

export interface UserRow {
  id: string;
  email: string;
  displayName: string;
  status: string;
  primaryOrgId: string | null;
  isExternal: boolean;
}

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
}

export interface PermissionRow {
  key: string;
  module: string;
  scopes: string[];
  description: string | null;
}

export interface SettingRow {
  key: string;
  value: unknown;
  scope?: string;
  updatedAt?: string;
}

export interface FlagRow {
  key: string;
  enabled: boolean;
  description?: string | null;
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
   * what has actually happened — read-only almost throughout, and tenant-scoped
   * like the other two.
   */
  readonly observe: Operations;

  /** What an administrator of one desk may do. */
  readonly tenant: {
    users(search?: string): Promise<UserRow[]>;
    createUser(input: { email: string; displayName: string; primaryOrgId?: string }): Promise<UserRow>;
    deactivateUser(id: string): Promise<unknown>;
    assignRole(userId: string, roleKey: string): Promise<unknown>;
    removeRoleAssignment(id: string): Promise<unknown>;
    organisations(): Promise<OrganisationRow[]>;
    createTeam(input: { key: string; name: string; orgId: string }): Promise<TeamRow>;
    addTeamMember(teamId: string, userId: string, isLead?: boolean): Promise<unknown>;
    permissions(): Promise<PermissionRow[]>;
    settings(): Promise<SettingRow[]>;
    setSetting(key: string, value: unknown): Promise<unknown>;
    flags(): Promise<FlagRow[]>;
    setFlag(key: string, enabled: boolean): Promise<unknown>;
    fields(includeInactive?: boolean): Promise<FieldRow[]>;
    saveField(key: string, input: Record<string, unknown>): Promise<FieldRow>;
    deactivateField(key: string): Promise<FieldRow>;
  };

  /** What an operator of the deployment may do. 403 for everybody else. */
  readonly platform: {
    tenants(): Promise<TenantRow[]>;
    plans(): Promise<PlanRow[]>;
    setAiRegions(tenantId: string, regions: string[]): Promise<{ id: string; aiAllowedRegions: string[] }>;
  };
}

const unwrap = <T>(body: { data: T }): T => body.data;

export function admin(client: Client): Admin {
  return {
    me: () => client.request<Me>('/api/v1/me'),

    configure: builders(client),

    observe: operations(client),

    tenant: {
      users: (search) =>
        client
          .request<{ data: UserRow[] }>(`/api/v1/users${search ? `?q=${encodeURIComponent(search)}` : ''}`)
          .then(unwrap),
      createUser: (input) => client.request<UserRow>('/api/v1/users', { method: 'POST', body: input }),
      deactivateUser: (id) =>
        client.request(`/api/v1/users/${encodeURIComponent(id)}/deactivate`, { method: 'POST', body: {} }),
      assignRole: (userId, roleKey) =>
        client.request('/api/v1/role-assignments', { method: 'POST', body: { userId, roleKey } }),
      removeRoleAssignment: (id) =>
        client.request(`/api/v1/role-assignments/${encodeURIComponent(id)}`, { method: 'DELETE' }),
      organisations: () => client.request<{ data: OrganisationRow[] }>('/api/v1/organisations').then(unwrap),
      createTeam: (input) => client.request<TeamRow>('/api/v1/teams', { method: 'POST', body: input }),
      addTeamMember: (teamId, userId, isLead = false) =>
        client.request(`/api/v1/teams/${encodeURIComponent(teamId)}/members`, {
          method: 'POST',
          body: { userId, isLead },
        }),
      permissions: () => client.request<{ data: PermissionRow[] }>('/api/v1/permissions').then(unwrap),
      settings: () => client.request<{ data: SettingRow[] }>('/api/v1/settings').then(unwrap),
      setSetting: (key, value) =>
        client.request(`/api/v1/settings/${encodeURIComponent(key)}`, { method: 'PUT', body: { value } }),
      flags: () => client.request<{ data: FlagRow[] }>('/api/v1/feature-flags').then(unwrap),
      setFlag: (key, enabled) =>
        client.request(`/api/v1/feature-flags/${encodeURIComponent(key)}`, { method: 'PUT', body: { enabled } }),
      fields: (includeInactive = false) =>
        client
          .request<{ data: FieldRow[] }>(`/api/v1/field-definitions${includeInactive ? '?includeInactive=true' : ''}`)
          .then(unwrap),
      saveField: (key, input) =>
        client.request<FieldRow>(`/api/v1/field-definitions/${encodeURIComponent(key)}`, { method: 'PUT', body: input }),
      deactivateField: (key) =>
        client.request<FieldRow>(`/api/v1/field-definitions/${encodeURIComponent(key)}`, { method: 'DELETE' }),
    },

    platform: {
      tenants: () => client.request<{ data: TenantRow[] }>('/api/platform/v1/tenants').then(unwrap),
      plans: () => client.request<{ data: PlanRow[] }>('/api/platform/v1/plans').then(unwrap),
      setAiRegions: (tenantId, regions) =>
        client.request<{ id: string; aiAllowedRegions: string[] }>(
          `/api/platform/v1/tenants/${encodeURIComponent(tenantId)}/ai-regions`,
          { method: 'PUT', body: { regions } },
        ),
    },
  };
}
