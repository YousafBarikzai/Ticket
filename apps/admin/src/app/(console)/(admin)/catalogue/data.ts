import 'server-only';
import { cache } from 'react';
import type { Admin, FormRow, Me, RequestTypeRow, ServiceRow } from '@itsm/sdk';
import { holds } from '../../../../permissions.js';
import { read, type Read } from '../../../../server/read.js';
import { resolvePeople } from '../../../../server/people.js';
import {
  formView,
  questionsLabel,
  questionsSource,
  requestTypeState,
  type FormView,
  type RequestTypeView,
  type ServiceView,
} from '../../../../components/catalogue/presentation.js';

/**
 * What the Services & requests pages load, made serialisable for their
 * client views: services with their owners and teams by name, request types
 * with their questions described, forms with their state.
 *
 * Each list is read on its own (SPEC §4.10: sections fail independently) —
 * forms need `catalogue.form.read`, which not everyone who manages the
 * catalogue holds, and teams need the directory (A6); without either the
 * page still works, it just cannot name or change what it cannot read.
 */

export function mayReadForms(me: Me): boolean {
  return holds(me, 'catalogue.form.read') || holds(me, 'catalogue.form.manage');
}

export function mayWriteForms(me: Me): boolean {
  return holds(me, 'catalogue.form.manage');
}

/** Every form, once per request (the editor's metadata and its page both ask); null without `catalogue.form.read`. */
export const loadForms = cache(async (api: Admin, me: Me): Promise<Read<FormView[]> | null> => {
  if (!mayReadForms(me)) return null;
  const forms = await read(() => api.configure.catalogue.forms());
  return forms.ok ? { ok: true, value: forms.value.map((row: FormRow) => formView(row)) } : forms;
});

export async function loadTeams(api: Admin): Promise<{ id: string; name: string }[] | null> {
  const teams = await read(() => api.tenant.teams());
  return teams.ok ? teams.value.map((team) => ({ id: team.id, name: team.name })).sort((a, b) => a.name.localeCompare(b.name)) : null;
}

export async function serviceViews(api: Admin, rows: readonly ServiceRow[], teams: readonly { id: string; name: string }[] | null): Promise<ServiceView[]> {
  const people = await resolvePeople(api, rows.map((row) => row.ownerId));
  const teamName = new Map((teams ?? []).map((team) => [team.id, team.name]));
  return rows.map((row) => {
    const owner = row.ownerId ? people.get(row.ownerId) : undefined;
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      description: row.description,
      status: row.status,
      ownerId: row.ownerId,
      owner: row.ownerId ? { id: row.ownerId, name: owner?.name ?? 'Unknown person' } : null,
      groupId: row.groupId,
      teamName: row.groupId ? (teamName.get(row.groupId) ?? null) : null,
    };
  });
}

export function requestTypeViews(
  rows: readonly RequestTypeRow[],
  services: readonly ServiceView[],
  forms: readonly FormView[],
  teams: readonly { id: string; name: string }[] | null,
): RequestTypeView[] {
  const serviceById = new Map(services.map((service) => [service.id, service]));
  const formsByKey = new Map(forms.map((form) => [form.key, form]));
  const teamName = new Map((teams ?? []).map((team) => [team.id, team.name]));
  return rows.map((row) => {
    const service = serviceById.get(row.serviceId);
    const source = questionsSource(row, formsByKey);
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      summary: row.shortSummary,
      description: row.description,
      serviceId: row.serviceId,
      serviceKey: service?.key ?? null,
      serviceName: service?.name ?? null,
      priority: row.priority,
      status: row.status,
      state: requestTypeState(row.status, source),
      formKey: row.formKey,
      questions: source,
      questionsLabel: questionsLabel(source),
      groupId: row.groupId,
      teamName: row.groupId ? (teamName.get(row.groupId) ?? null) : null,
      // The API returns the whole record; the SDK's row type leaves `entitlement` out.
      entitlement: (row as RequestTypeRow & { entitlement?: unknown }).entitlement ?? null,
      sortOrder: row.sortOrder,
      publishedAt: row.publishedAt,
    };
  });
}

/** An origin from the environment, without a trailing slash; nothing when unset or not a URL (C1). */
export function originOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}
