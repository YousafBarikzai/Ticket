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
 * E2 (also here, because it is the same register) adds discovery,
 * reconciliation and the money: sources that pull through the MOD-14 gateway, a
 * proposal queue where a person confirms every disagreement, and the supplier
 * and contract records finance asks for.
 */
export const assetsManifest: ModuleManifest = registerModule({
  id: 'MOD-10',
  key: 'assets',
  name: 'Assets and the CMDB',
  version: '1.0.0',
  phase: 'PH-4',
  dependsOn: ['MOD-04', 'MOD-05', 'MOD-14'],
  permissions: [
    { key: 'cmdb.read', scopes: ['any'], description: 'See configuration items, their relationships and impact.' },
    { key: 'cmdb.manage', scopes: ['any'], description: 'Write configuration items, classes and relationships.' },
    { key: 'cmdb.link', scopes: ['any'], description: 'Say which configuration items a record touched.' },
    { key: 'asset.read', scopes: ['any'], description: 'See the asset register and who holds what.' },
    { key: 'asset.manage', scopes: ['any'], description: 'Register, assign, return and retire assets.' },
    { key: 'discovery.read', scopes: ['any'], description: 'See discovery sources, runs and what they propose.' },
    { key: 'discovery.manage', scopes: ['any'], description: 'Configure discovery sources and reconciliation rules, and run them.' },
    { key: 'contract.read', scopes: ['any'], description: 'See suppliers, contracts and what they cover.' },
    { key: 'contract.manage', scopes: ['any'], description: 'Write suppliers, contracts and coverage.' },
  ],
  events: {
    publishes: [
      'ci.registered',
      'ci.status.changed',
      'ci.retired',
      'asset.assigned',
      'asset.retired',
      'discovery.run.completed',
      'discovery.proposal.decided',
      'contract.expiring',
    ],
    // Nothing, deliberately. Every relationship and every link in this module
    // was written by somebody who decided to write it; a CMDB that infers what
    // a change touched is a CMDB that is confidently wrong at the worst moment.
    // Discovery does not change that — it proposes, and a person confirms.
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
    {
      key: 'contracts.noticeWarningDays',
      schema: z.number().int().min(1).max(365),
      default: 30,
      scopes: ['tenant'],
      description: 'How long before a contract\'s notice date somebody is told. Notice, not expiry: after the notice date, renewal is no longer a choice.',
    },
  ],
  jobs: [
    {
      name: 'assets.warranty.sweep',
      queue: 'analytics',
      description: 'Report warranties about to lapse, and those that already have.',
    },
    {
      name: 'assets.discovery.sweep',
      queue: 'imports',
      description: 'Pull the discovery sources that are due. Proposes; never writes without a rule saying it may.',
    },
    {
      name: 'assets.contract.sweep',
      queue: 'analytics',
      description: 'Report contracts inside their notice period, and those whose window has closed.',
    },
  ],
  routesPrefix: '/cmdb',
  enabledByDefault: true,
  optional: true,
});
