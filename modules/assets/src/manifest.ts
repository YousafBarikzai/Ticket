import { z } from 'zod';
import { registerModule, type ModuleManifest } from '@itsm/platform';

/**
 * MOD-10-E1 Assets and the CMDB (PH-4).
 *
 * The register everybody wants and nobody maintains. The reason is almost
 * always the same: it was built to be complete rather than to be useful, so
 * filling it in is somebody's chore and reading it is nobody's habit, and a
 * register nobody reads is a register nobody corrects.
 *
 * So this one is built around the two questions that get asked under pressure —
 * "what falls over if this goes?" and "what changed on this last week?" — and
 * everything else is arranged behind them. Traversal has a performance target
 * because it is asked during an incident. Links are written by people because a
 * guess given confidently during an incident is worse than no answer.
 *
 * E2 adds discovery, reconciliation and the contract and supplier records.
 */
export const assetsManifest: ModuleManifest = registerModule({
  id: 'MOD-10-E1',
  key: 'assets',
  name: 'Assets and the CMDB',
  version: '1.0.0',
  phase: 'PH-4',
  dependsOn: ['MOD-04', 'MOD-05'],
  permissions: [
    { key: 'cmdb.read', scopes: ['any'], description: 'See configuration items, their relationships and impact.' },
    { key: 'cmdb.manage', scopes: ['any'], description: 'Write configuration items, classes and relationships.' },
    { key: 'cmdb.link', scopes: ['any'], description: 'Say which configuration items a record touched.' },
    { key: 'asset.read', scopes: ['any'], description: 'See the asset register and who holds what.' },
    { key: 'asset.manage', scopes: ['any'], description: 'Register, assign, return and retire assets.' },
  ],
  events: {
    publishes: ['ci.registered', 'ci.status.changed', 'ci.retired', 'asset.assigned', 'asset.retired'],
    // Nothing, deliberately. Every relationship and every link in this module
    // was written by somebody who decided to write it; a CMDB that infers what
    // a change touched is a CMDB that is confidently wrong at the worst moment.
    consumes: [],
  },
  featureFlags: [],
  settings: [
    {
      key: 'cmdb.impactDepth',
      schema: z.number().int().min(1).max(6),
      default: 3,
      scopes: ['tenant'],
      description: 'How many hops an impact answer walks by default. Beyond three it usually reaches everything.',
    },
    {
      key: 'assets.warrantyWarningDays',
      schema: z.number().int().min(1).max(365),
      default: 30,
      scopes: ['tenant'],
      description: 'How far ahead the warranty sweep looks.',
    },
  ],
  jobs: [
    {
      name: 'assets.warranty.sweep',
      queue: 'analytics',
      description: 'Report warranties about to lapse, and those that already have.',
    },
  ],
  routesPrefix: '/cmdb',
  enabledByDefault: true,
  optional: true,
});
