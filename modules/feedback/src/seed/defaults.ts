import { newId, transaction, type TenantContext } from '@itsm/platform';
import type { SurveyDocument } from '../domain/survey-document.js';

/**
 * The survey a tenant starts with: one question that people answer, one they
 * may. A 1–5 rating and an optional comment, sent after a resolution, a
 * fulfilment and a major incident, no more than once a week to anybody.
 *
 * Published on creation, so feedback is being collected from the first
 * resolved ticket rather than from whenever somebody remembers to set it up —
 * a survey programme that starts three months in has three months of nothing
 * to compare against.
 */
export const DEFAULT_SURVEY: { key: string; name: string; description: string; document: SurveyDocument } = {
  key: 'csat',
  name: 'How did we do?',
  description: 'A rating and a comment, after a ticket is resolved.',
  document: {
    title: 'How did we do?',
    description: 'One question, and a box if there is more to say.',
    thanks: 'Thank you. Your answer goes straight to the team that helped you.',
    schema: {
      type: 'object',
      properties: {
        rating: { type: 'integer', title: 'How satisfied are you with how this was handled?', minimum: 1, maximum: 5 },
        comment: { type: 'string', title: 'Anything you would like to add?', maxLength: 2000 },
      },
      required: ['rating'],
    },
    ui: {
      elements: [
        { kind: 'field', field: 'rating', label: 'How satisfied are you with how this was handled?', control: 'number' },
        { kind: 'field', field: 'comment', label: 'Anything you would like to add?', control: 'longtext' },
      ],
    },
    scoring: { field: 'rating', min: 1, max: 5, commentField: 'comment' },
  },
};

export async function seedFeedbackDefaults(ctx: TenantContext): Promise<{ created: boolean }> {
  return transaction(ctx, async (tx) => {
    const existing = await tx.surveyDefinition.findFirst({ where: { key: DEFAULT_SURVEY.key } });
    if (existing) return { created: false };

    const surveyId = newId();
    await tx.surveyDefinition.create({
      data: {
        id: surveyId,
        tenantId: ctx.tenantId,
        key: DEFAULT_SURVEY.key,
        name: DEFAULT_SURVEY.name,
        description: DEFAULT_SURVEY.description,
        document: DEFAULT_SURVEY.document as never,
        status: 'published',
        version: 1,
        publishedAt: new Date(),
      },
    });
    await tx.surveyVersion.create({
      data: { id: newId(), tenantId: ctx.tenantId, definitionId: surveyId, version: 1, document: DEFAULT_SURVEY.document as never },
    });
    for (const kind of ['ticket.resolved', 'request.fulfilled', 'incident.major.resolved']) {
      await tx.surveyTrigger.create({
        data: { id: newId(), tenantId: ctx.tenantId, surveyId, kind, throttleDays: 7, expiryDays: 14, isActive: true },
      });
    }
    return { created: true };
  });
}
