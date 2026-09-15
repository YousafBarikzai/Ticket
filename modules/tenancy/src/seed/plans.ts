import { logger, platformDb, newId } from '@itsm/platform';
import type { PlanInput } from '../service/plan-service.js';

/**
 * The plans a deployment starts with.
 *
 * Three, with the shape most desks recognise, and a fourth that is the
 * absence of one: a tenant with no plan has no limits, which is what a
 * pilot and a self-hosted deployment both want. The numbers here are a
 * starting point an operator edits, not a price list — nothing in this
 * repository charges anybody.
 *
 * `trial` refuses at a size where a real desk would notice, on purpose: a
 * trial that never refuses proves nothing about whether the refusal works.
 */
export const DEFAULT_PLANS: PlanInput[] = [
  {
    key: 'trial',
    name: 'Trial',
    description: 'Thirty days to see whether it fits. Small on purpose.',
    features: [],
    sortOrder: 10,
    limits: [
      { meter: 'agents', soft: 4, hard: 5 },
      { meter: 'tickets', soft: 400, hard: 500 },
      { meter: 'storage', soft: 800 * 1024 * 1024, hard: 1024 * 1024 * 1024 },
      { meter: 'api_calls', soft: 40_000, hard: 50_000 },
    ],
  },
  {
    key: 'team',
    name: 'Team',
    description: 'One desk, one organisation.',
    features: ['ticket.customFields'],
    sortOrder: 20,
    limits: [
      { meter: 'agents', soft: 20, hard: 25 },
      { meter: 'tickets', soft: 8_000, hard: 10_000 },
      { meter: 'storage', soft: 40 * 1024 * 1024 * 1024, hard: 50 * 1024 * 1024 * 1024 },
      { meter: 'api_calls', soft: 800_000, hard: 1_000_000 },
    ],
  },
  {
    key: 'enterprise',
    name: 'Enterprise',
    description: 'Several desks, several organisations, and the integrations.',
    features: ['ticket.customFields'],
    sortOrder: 30,
    limits: [
      // Warned but never refused: at this size the conversation happens
      // between people before it happens between machines.
      { meter: 'agents', soft: 400, hard: null },
      { meter: 'tickets', soft: 200_000, hard: null },
      { meter: 'storage', soft: 900 * 1024 * 1024 * 1024, hard: 1024 * 1024 * 1024 * 1024 },
      { meter: 'api_calls', soft: 20_000_000, hard: null },
    ],
  },
];

/**
 * Written once per deployment rather than per tenant, because plans are not
 * a tenant's. Idempotent on the key, and it never edits a plan an operator
 * has already changed: a seed that overwrote the numbers somebody tuned
 * would undo their work on every deployment.
 */
export async function seedPlans(): Promise<{ created: number }> {
  const db = platformDb();
  let created = 0;
  for (const plan of DEFAULT_PLANS) {
    const existing = await db.plan.findFirst({ where: { key: plan.key } });
    if (existing) continue;
    await db.plan.create({
      data: {
        key: plan.key,
        name: plan.name,
        description: plan.description ?? null,
        features: plan.features ?? [],
        sortOrder: plan.sortOrder ?? 100,
      },
    });
    for (const limit of plan.limits ?? []) {
      await db.planLimit.create({
        data: {
          id: newId(),
          planKey: plan.key,
          meter: limit.meter,
          soft: limit.soft == null ? null : BigInt(limit.soft),
          hard: limit.hard == null ? null : BigInt(limit.hard),
        },
      });
    }
    created += 1;
  }
  if (created > 0) logger.info('default plans seeded', { created });
  return { created };
}
