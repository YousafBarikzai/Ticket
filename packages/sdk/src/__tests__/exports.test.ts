import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, expectTypeOf, it } from 'vitest';
import * as sdk from '../index.js';
import type * as insightsModule from '../resources/insights.js';
import type * as serviceManagement from '../resources/service-management.js';

/**
 * Every name the barrel exported from `operations.js` before the redesign is
 * still exported (V1-m15).
 *
 * The Insights group moved to `resources/insights.ts` and the major-incident
 * row to `resources/service-management.ts`, so the Service Desk could share
 * them. Two hundred files in the applications import from `@itsm/sdk`, and
 * a name lost in a move is a build that fails in an app nobody touched.
 * Pinned twice: at runtime, by reading the barrel's export lists, so `vitest`
 * fails; and as types, so `tsc` does — a type that stopped existing is a
 * compile error on its `expectTypeOf` line, naming it.
 *
 * Only the names that existed. New names reach the barrel as hand-offs, and
 * their own tests import the files that define them directly (§15.0 rule 4).
 */

/** The 62 type names `index.ts` re-exported from `./resources/operations.js` (with the value `operations`). */
const OPERATIONS_TYPES = [
  'ActionOutcome',
  'ActionRow',
  'AiBudget',
  'AiDecisions',
  'AssetDetail',
  'AssetFilter',
  'AssetInput',
  'AssetRow',
  'AuditEventRow',
  'AuditFilter',
  'AvailabilityRow',
  'CiAttribute',
  'CiClassRow',
  'CiFilter',
  'CiHistory',
  'CiInput',
  'CiRelationships',
  'CiRow',
  'CiStatus',
  'CredentialRow',
  'Criticality',
  'DashboardDetail',
  'DashboardInput',
  'DashboardRow',
  'DashboardSummary',
  'DecisionQuestionScore',
  'DecisionRow',
  'DecisionScore',
  'ErrorQueueRow',
  'Estate',
  'ImpactResult',
  'Insights',
  'Integrations',
  'MajorIncidentRow',
  'MetricFilter',
  'MetricQuery',
  'MetricRange',
  'MetricResult',
  'MetricRow',
  'MetricTrend',
  'OnCallRow',
  'Operations',
  'Queues',
  'Relationship',
  'RelationshipType',
  'RenderedDashboard',
  'RenderedWidget',
  'ReportRow',
  'ReportRunRow',
  'RotationRow',
  'RoutingExplanation',
  'RoutingPolicy',
  'RoutingStrategy',
  'SecurityAlertRow',
  'ShiftAssignmentRow',
  'ShiftPattern',
  'ShiftRow',
  'SkillRow',
  'Weekday',
  'WidgetInput',
  'WidgetRow',
  'WidgetType',
] as const;

/** Every name the barrel exports, read from its `export { … } from` and `export type { … } from` lists. */
function barrelNames(): Set<string> {
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.ts'), 'utf8');
  const names = new Set<string>();
  for (const match of source.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"][^'"]+['"]/g)) {
    for (const entry of match[1]!.split(',')) {
      // `type Name`, `Name`, and `Name as Alias` (the alias is what is exported).
      const name = entry.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '').trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()!.trim();
      if (name) names.add(name);
    }
  }
  return names;
}

describe('the barrel keeps every name it exported from operations.js', () => {
  it('reads the barrel’s lists at all', () => {
    // A reader that matched nothing would make the next test pass vacuously.
    const names = barrelNames();
    expect(names.size).toBeGreaterThan(150);
    expect(names).toContain('createClient');
    expect(names).toContain('Ticket');
  });

  it('pins 62 type names and the value', () => {
    expect(OPERATIONS_TYPES).toHaveLength(62);
    expect(new Set(OPERATIONS_TYPES).size).toBe(62);
  });

  it.each(OPERATIONS_TYPES)('exports %s', (name) => {
    expect(barrelNames()).toContain(name);
  });

  it('exports `operations` as the function it was', () => {
    expect(barrelNames()).toContain('operations');
    expect(typeof sdk.operations).toBe('function');
    const surface = sdk.operations(sdk.createClient({ baseUrl: 'http://api.test', fetch: (async () => new Response('{}')) as unknown as typeof fetch }));
    expect(Object.keys(surface.insights)).toContain('render');
    expect(typeof surface.majorIncidents).toBe('function');
  });

  it('exports every one of them as a type', () => {
    expectTypeOf<sdk.ActionOutcome>().not.toBeAny();
    expectTypeOf<sdk.ActionRow>().not.toBeAny();
    expectTypeOf<sdk.AiBudget>().not.toBeAny();
    expectTypeOf<sdk.AiDecisions>().not.toBeAny();
    expectTypeOf<sdk.AssetDetail>().not.toBeAny();
    expectTypeOf<sdk.AssetFilter>().not.toBeAny();
    expectTypeOf<sdk.AssetInput>().not.toBeAny();
    expectTypeOf<sdk.AssetRow>().not.toBeAny();
    expectTypeOf<sdk.AuditEventRow>().not.toBeAny();
    expectTypeOf<sdk.AuditFilter>().not.toBeAny();
    expectTypeOf<sdk.AvailabilityRow>().not.toBeAny();
    expectTypeOf<sdk.CiAttribute>().not.toBeAny();
    expectTypeOf<sdk.CiClassRow>().not.toBeAny();
    expectTypeOf<sdk.CiFilter>().not.toBeAny();
    expectTypeOf<sdk.CiHistory>().not.toBeAny();
    expectTypeOf<sdk.CiInput>().not.toBeAny();
    expectTypeOf<sdk.CiRelationships>().not.toBeAny();
    expectTypeOf<sdk.CiRow>().not.toBeAny();
    expectTypeOf<sdk.CiStatus>().not.toBeAny();
    expectTypeOf<sdk.CredentialRow>().not.toBeAny();
    expectTypeOf<sdk.Criticality>().not.toBeAny();
    expectTypeOf<sdk.DashboardDetail>().not.toBeAny();
    expectTypeOf<sdk.DashboardInput>().not.toBeAny();
    expectTypeOf<sdk.DashboardRow>().not.toBeAny();
    expectTypeOf<sdk.DashboardSummary>().not.toBeAny();
    expectTypeOf<sdk.DecisionQuestionScore>().not.toBeAny();
    expectTypeOf<sdk.DecisionRow>().not.toBeAny();
    expectTypeOf<sdk.DecisionScore>().not.toBeAny();
    expectTypeOf<sdk.ErrorQueueRow>().not.toBeAny();
    expectTypeOf<sdk.Estate>().not.toBeAny();
    expectTypeOf<sdk.ImpactResult>().not.toBeAny();
    expectTypeOf<sdk.Insights>().not.toBeAny();
    expectTypeOf<sdk.Integrations>().not.toBeAny();
    expectTypeOf<sdk.MajorIncidentRow>().not.toBeAny();
    expectTypeOf<sdk.MetricFilter>().not.toBeAny();
    expectTypeOf<sdk.MetricQuery>().not.toBeAny();
    expectTypeOf<sdk.MetricRange>().not.toBeAny();
    expectTypeOf<sdk.MetricResult>().not.toBeAny();
    expectTypeOf<sdk.MetricRow>().not.toBeAny();
    expectTypeOf<sdk.MetricTrend>().not.toBeAny();
    expectTypeOf<sdk.OnCallRow>().not.toBeAny();
    expectTypeOf<sdk.Operations>().not.toBeAny();
    expectTypeOf<sdk.Queues>().not.toBeAny();
    expectTypeOf<sdk.Relationship>().not.toBeAny();
    expectTypeOf<sdk.RelationshipType>().not.toBeAny();
    expectTypeOf<sdk.RenderedDashboard>().not.toBeAny();
    expectTypeOf<sdk.RenderedWidget>().not.toBeAny();
    expectTypeOf<sdk.ReportRow>().not.toBeAny();
    expectTypeOf<sdk.ReportRunRow>().not.toBeAny();
    expectTypeOf<sdk.RotationRow>().not.toBeAny();
    expectTypeOf<sdk.RoutingExplanation>().not.toBeAny();
    expectTypeOf<sdk.RoutingPolicy>().not.toBeAny();
    expectTypeOf<sdk.RoutingStrategy>().not.toBeAny();
    expectTypeOf<sdk.SecurityAlertRow>().not.toBeAny();
    expectTypeOf<sdk.ShiftAssignmentRow>().not.toBeAny();
    expectTypeOf<sdk.ShiftPattern>().not.toBeAny();
    expectTypeOf<sdk.ShiftRow>().not.toBeAny();
    expectTypeOf<sdk.SkillRow>().not.toBeAny();
    expectTypeOf<sdk.Weekday>().not.toBeAny();
    expectTypeOf<sdk.WidgetInput>().not.toBeAny();
    expectTypeOf<sdk.WidgetRow>().not.toBeAny();
    expectTypeOf<sdk.WidgetType>().not.toBeAny();
  });

  it('re-exports the moved types as the same types, not copies that could drift', () => {
    expectTypeOf<sdk.MetricResult>().toEqualTypeOf<insightsModule.MetricResult>();
    expectTypeOf<sdk.MetricQuery>().toEqualTypeOf<insightsModule.MetricQuery>();
    expectTypeOf<sdk.Insights>().toEqualTypeOf<insightsModule.Insights>();
    expectTypeOf<sdk.RenderedDashboard>().toEqualTypeOf<insightsModule.RenderedDashboard>();
    expectTypeOf<sdk.MajorIncidentRow>().toEqualTypeOf<serviceManagement.MajorIncidentRow>();
    expectTypeOf<sdk.Operations['insights']>().toEqualTypeOf<insightsModule.Insights>();
  });
});

describe('the barrel’s values', () => {
  it('are still the functions and classes the applications call', () => {
    expect(typeof sdk.createClient).toBe('function');
    expect(typeof sdk.ApiError).toBe('function');
    expect(typeof sdk.workbench).toBe('function');
    expect(typeof sdk.portal).toBe('function');
    expect(typeof sdk.admin).toBe('function');
    expect(typeof sdk.builders).toBe('function');
    expect(typeof sdk.ticketQuery).toBe('function');
    expect(typeof sdk.ticketCountQuery).toBe('function');
    expect(typeof sdk.queueable.reportIssue).toBe('function');
  });
});
