import { z } from 'zod';
import { registerModule, type ModuleManifest } from '@itsm/platform';

/**
 * MOD-09 AI, as a governed capability service (ADR-0006).
 *
 * No other module calls a model provider. Everything goes through here, which
 * is what makes budgets, kill switches, evidence, evaluation and audit
 * properties of *every* AI feature rather than of whichever ones remembered.
 *
 * Nothing reaches a real model yet: the provider is a socket with a stub in
 * it, and OD-04 is the decision that fills it. Everything around the socket —
 * the prompts, the thresholds, the budgets, the refusals — is real, and is
 * what would otherwise have been written in a hurry on the day a provider was
 * chosen.
 */
export const aiManifest: ModuleManifest = registerModule({
  id: 'MOD-09-AI',
  key: 'ai',
  name: 'AI capability service',
  version: '1.0.0',
  phase: 'PH-4',
  dependsOn: ['MOD-01', 'MOD-04', 'MOD-09', 'MOD-09-KNOWLEDGE', 'MOD-13', 'MOD-15'],
  permissions: [
    { key: 'ai.suggest', scopes: ['any'], description: 'Ask for a suggestion, and say what you did with it.' },
    { key: 'ai.read', scopes: ['any'], description: 'See this tenant’s AI jobs, suggestions and spend.' },
    { key: 'ai.manage', scopes: ['any'], description: 'Set this tenant’s AI budget and switch capabilities off.' },
    // Prompts and their evaluations are the deployment's, not a tenant's: a
    // tenant that could edit its own prompt could edit its way past every
    // threshold the release gate depends on. So this is a platform operator's
    // permission, and no tenant role holds it.
    { key: 'platform.ai.prompt', scopes: ['any'], description: 'Write, evaluate and promote prompt versions (platform operators).' },
  ],
  events: {
    // A promotion is audited, not evented: an event is written into one
    // tenant's outbox, and a prompt belongs to none of them.
    publishes: ['ai.suggestion.created', 'ai.budget.threshold'],
    consumes: [],
  },
  featureFlags: [
    {
      key: 'ai.enabled',
      description: 'The tenant-wide switch. Off refuses every capability, in under a flag cache TTL.',
      default: true,
      owner: 'ai',
      // A kill switch is not a rollout: it exists for as long as the feature
      // it can switch off does.
      expires: 'permanent',
    },
    {
      key: 'ai.capability.reply-draft',
      description: 'Draft a reply for an agent to edit and send.',
      default: true,
      owner: 'ai',
      // A kill switch is not a rollout: it exists for as long as the feature
      // it can switch off does.
      expires: 'permanent',
    },
    {
      key: 'ai.capability.ticket-summary',
      description: 'Summarise a ticket for a handover or an escalation.',
      default: true,
      owner: 'ai',
      // A kill switch is not a rollout: it exists for as long as the feature
      // it can switch off does.
      expires: 'permanent',
    },
    {
      key: 'ai.capability.article-draft',
      description: 'Draft a knowledge article from a resolved ticket.',
      default: true,
      owner: 'ai',
      // A kill switch is not a rollout: it exists for as long as the feature
      // it can switch off does.
      expires: 'permanent',
    },
    {
      key: 'ai.capability.similar-work',
      description: 'Surface similar tickets and known errors. Retrieval only; no model call.',
      default: true,
      owner: 'ai',
      // A kill switch is not a rollout: it exists for as long as the feature
      // it can switch off does.
      expires: 'permanent',
    },
  ],
  settings: [
    {
      key: 'ai.tone',
      schema: z.enum(['plain', 'formal', 'friendly']),
      default: 'plain',
      scopes: ['tenant'],
      description: 'How a drafted reply should read. The only part of a prompt a tenant may change.',
    },
    {
      key: 'ai.language',
      schema: z.string().min(2).max(40),
      default: 'English',
      scopes: ['tenant'],
      description: 'The language a drafted reply should be written in.',
    },
    {
      key: 'ai.retainDays',
      schema: z.number().int().min(1).max(365),
      default: 30,
      scopes: ['tenant'],
      description: 'How long a rendered prompt and its completion are kept before the sweep removes them.',
    },
  ],
  jobs: [
    {
      name: 'ai.suggest',
      queue: 'ai',
      description: 'Assemble the context, call the provider, and store the suggestion with its evidence.',
    },
    {
      name: 'ai.retention.sweep',
      queue: 'retention',
      // After the audit chain check and before the working day, like the
      // other retention work.
      schedule: '40 3 * * *',
      description: 'Remove rendered prompts and completions past the tenant’s retention window.',
    },
  ],
  routesPrefix: '/ai',
  enabledByDefault: true,
  optional: true,
});
