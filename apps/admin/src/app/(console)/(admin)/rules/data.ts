import 'server-only';
import { cache } from 'react';
import type { Admin, Me, RuleDetail, RuleFacts, RuleRow, RuleVersionRow } from '@itsm/sdk';
import { holds, holdsAny, viewOnlyFor } from '../../../../permissions.js';
import { personFrom, resolvePeople } from '../../../../server/people.js';
import { read, type Read } from '../../../../server/read.js';
import { lastFiredByKey, toRuleView } from '../../../../components/rules/presentation.js';
import type { Choice, RuleNames, RuleSnapshot, RuleVersionView, RuleView } from '../../../../components/rules/types.js';

/**
 * What the three rules pages share: the rows, made serialisable, and the
 * names a rule's ids and keys read as. Server-only; nothing here is a
 * function a client component would need (SPEC §3.6, and the WP16 trap: a
 * server page cannot call into a `'use client'` module).
 */

export const RULES_WRITE = ['rules.rule.manage', 'rules.rule.publish'] as const;

/** The rows, as the client views read them. */
export const ruleView = (row: RuleRow): RuleView => toRuleView(row);

export interface RulesAbilities {
  readonly canManage: boolean;
  readonly canPublish: boolean;
  readonly viewOnly?: { readonly label: string; readonly permission: string; readonly key: string };
}

export function abilities(me: Me, label: string): RulesAbilities {
  const viewOnly = viewOnlyFor(me, label, RULES_WRITE);
  return { canManage: holds(me, 'rules.rule.manage'), canPublish: holds(me, 'rules.rule.publish'), ...(viewOnly ? { viewOnly } : {}) };
}

export interface RuleLookups {
  readonly names: RuleNames;
  /** Published workflows to start, by name; null when this person cannot list workflows. */
  readonly workflows: readonly Choice[] | null;
  /** Teams to assign to (A6); null when the list cannot be read. */
  readonly teams: readonly Choice[] | null;
}

/**
 * Teams and workflows, each read separately so one refusal leaves the other:
 * a rule that assigns to a team reads "Assign to Service desk" rather than an
 * id, and *Start a workflow* offers workflows by name.
 */
export async function loadLookups(api: Admin, me: Me): Promise<RuleLookups> {
  const [teams, workflows] = await Promise.all([
    read(() => api.tenant.teams()),
    holdsAny(me, ['workflow.read', 'workflow.manage']) ? read(() => api.configure.workflows.list()) : Promise.resolve(null),
  ]);
  const teamRows = teams.ok ? teams.value : null;
  const workflowRows = workflows?.ok ? workflows.value : null;
  return {
    names: {
      teams: Object.fromEntries((teamRows ?? []).map((team) => [team.id, team.name])),
      workflows: Object.fromEntries((workflowRows ?? []).map((flow) => [flow.key, { name: flow.name, live: flow.status === 'published' }])),
    },
    teams: teamRows ? teamRows.map((team) => ({ value: team.id, label: team.name })) : null,
    workflows: workflowRows
      ? workflowRows.map((flow) => ({
          value: flow.key,
          label: flow.name,
          ...(flow.status === 'published' ? {} : { description: 'Not published: a rule can’t start it until it is' }),
        }))
      : null,
  };
}

/**
 * When each rule last acted, from the audit trail (`rule.applied`), for
 * people who may read it; null otherwise — the column is left out rather
 * than showing a guess. Only the latest 200 applications are looked at, so a
 * rule that has not fired among them reads "Not recently".
 */
export async function loadLastFired(api: Admin, me: Me): Promise<Record<string, string> | null> {
  if (!holds(me, 'audit.read')) return null;
  const events = await read(() => api.observe.auditEvents({ action: 'rule.applied', limit: 200 }));
  return events.ok ? lastFiredByKey(events.value.data) : null;
}

/**
 * How many recent tickets "Try it" replays: the `rules.test.sampleSize`
 * setting, for people who may read settings. Null means the API's own
 * default (100), which is what it uses when none is sent.
 */
export async function loadSampleSize(api: Admin, me: Me): Promise<number | null> {
  if (!holds(me, 'admin.setting.read')) return null;
  const setting = await read(() => api.tenant.setting('rules.test.sampleSize'));
  const value = setting.ok ? setting.value.value : null;
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 500 ? value : null;
}

/**
 * One rule and its versions, read once per request: the page and its
 * metadata both ask, and `cache()` makes that one call.
 */
export const loadRule = cache((api: Admin, key: string): Promise<Read<RuleDetail>> => read(() => api.configure.rules.get(key)));

/** The versions with who published each, by name (one directory call for all of them). */
export async function versionViews(api: Admin, versions: readonly RuleVersionRow[] | undefined): Promise<RuleVersionView[]> {
  const rows = (versions ?? []).filter((row) => typeof row?.version === 'number');
  const people = await resolvePeople(api, rows.map((row) => row.publishedBy));
  return rows.map((row) => ({
    version: row.version,
    publishedAt: typeof row.publishedAt === 'string' ? row.publishedAt : new Date(row.publishedAt as unknown as string).toISOString(),
    publishedBy: personFrom(people, row.publishedBy),
    snapshot: (row.snapshot ?? {}) as RuleSnapshot,
  }));
}

export interface BuilderContext {
  readonly siblings: readonly RuleView[];
  readonly facts: RuleFacts;
  readonly lookups: RuleLookups;
  readonly sampleSize: number | null;
}

/**
 * What the builder needs besides the rule: every rule (for the key check and
 * the running order), the engine's facts and events, the names, and the
 * test's sample size. A failed facts read falls back to the console's own
 * catalogue rather than failing the page.
 */
export async function loadBuilderContext(api: Admin, me: Me): Promise<Read<BuilderContext>> {
  const [rules, facts, lookups, sampleSize] = await Promise.all([
    read(() => api.configure.rules.list()),
    read(() => api.configure.rules.facts()),
    loadLookups(api, me),
    loadSampleSize(api, me),
  ]);
  if (!rules.ok) return rules;
  return {
    ok: true,
    value: {
      siblings: rules.value.map(toRuleView),
      facts: facts.ok ? facts.value : { facts: [], events: [] },
      lookups,
      sampleSize,
    },
  };
}
