import { z } from 'zod';
import { registerModule, type ModuleManifest } from '@itsm/platform';

/**
 * MOD-09 Knowledge (PH-3).
 *
 * The half of MOD-09 that holds what people know; `modules/search` already
 * holds how it is found. Articles follow the versioned-definition lifecycle
 * (docs/architecture/05 §8), so what a reader saw last week is still readable
 * after an edit — which is the point of writing something down.
 */
export const knowledgeManifest: ModuleManifest = registerModule({
  id: 'MOD-09-KNOWLEDGE',
  key: 'knowledge',
  name: 'Knowledge base',
  version: '1.0.0',
  phase: 'PH-3',
  dependsOn: ['MOD-09', 'MOD-04', 'MOD-01'],
  permissions: [
    { key: 'knowledge.read', scopes: ['own', 'team', 'any'], description: 'Read articles you are entitled to.' },
    { key: 'knowledge.write', scopes: ['own', 'any'], description: 'Write and edit article drafts.' },
    { key: 'knowledge.publish', scopes: ['any'], description: 'Publish, retire and roll back articles.' },
    { key: 'knowledge.feedback', scopes: ['own'], description: 'Say whether an article helped.' },
  ],
  events: {
    publishes: [
      'knowledge.article.submitted',
      'knowledge.article.published',
      'knowledge.article.retired',
      'knowledge.article.feedback',
    ],
    consumes: ['approval.decided', 'ticket.status.changed'],
  },
  featureFlags: [],
  settings: [
    {
      key: 'knowledge.reviewIntervalDays',
      schema: z.number().int().min(7).max(1095),
      default: 180,
      scopes: ['tenant'],
      description: 'How long after publication an article is due for review.',
    },
    {
      key: 'knowledge.requireApprovalToPublish',
      schema: z.boolean(),
      default: false,
      scopes: ['tenant'],
      description: 'Send an article for approval before it is published.',
    },
  ],
  jobs: [
    { name: 'knowledge.review.sweep', queue: 'search', description: 'Find articles past their review date.' },
  ],
  routesPrefix: '/knowledge',
  enabledByDefault: true,
  optional: true,
});
