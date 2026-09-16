import { logger, platformDb, newId } from '@itsm/platform';
import type { PlanInput } from '../service/plan-service.js';

/**
 * The plans a deployment starts with (OD-05).
 *
 * Per agent, per month, on three tiers — Starter, Professional, Enterprise —
 * which is the shape every buyer of a service desk already understands, and
 * the shape the limit primitives were built for. A fourth row, `trial`, is not
 * a tier: it is an evaluation with no price and small numbers on purpose.
 *
 * Prices are in **micro-pence**, the unit every other amount in this platform
 * is held in. £29.00 per agent per month is 29_000_000. A second money
 * convention is how two numbers that look comparable turn out to be a thousand
 * times apart.
 *
 * **Nothing in this repository charges anybody.** These rows say what a plan
 * costs; there is no payment provider, no invoice and no dunning, and doc 23
 * carries that as absent rather than implied. An operator editing the numbers
 * is editing a price list, not a billing system.
 *
 * `trial` refuses at a size where a real desk would notice, on purpose: a
 * trial that never refuses proves nothing about whether the refusal works.
 */

/** £1.00 in micro-pence, so the prices below read as money rather than as digits. */
const POUND = 1_000_000;

export const DEFAULT_PLANS: PlanInput[] = [
  {
    key: 'trial',
    name: 'Trial',
    description: 'Thirty days to see whether it fits. Small on purpose.',
    features: [],
    pricePerAgentMicros: null,
    sortOrder: 10,
    limits: [
      { meter: 'agents', soft: 4, hard: 5 },
      { meter: 'tickets', soft: 400, hard: 500 },
      { meter: 'storage', soft: 800 * 1024 * 1024, hard: 1024 * 1024 * 1024 },
      { meter: 'api_calls', soft: 40_000, hard: 50_000 },
    ],
  },
  {
    key: 'starter',
    name: 'Starter',
    description: 'One desk finding its feet. Tickets, the portal and email.',
    features: [],
    pricePerAgentMicros: 19 * POUND,
    sortOrder: 20,
    limits: [
      { meter: 'agents', soft: 8, hard: 10 },
      { meter: 'tickets', soft: 4_000, hard: 5_000 },
      { meter: 'storage', soft: 8 * 1024 * 1024 * 1024, hard: 10 * 1024 * 1024 * 1024 },
      { meter: 'api_calls', soft: 200_000, hard: 250_000 },
    ],
  },
  {
    key: 'professional',
    name: 'Professional',
    description: 'One desk running properly: custom fields, automation and the chat channels.',
    features: ['ticket.customFields'],
    pricePerAgentMicros: 45 * POUND,
    sortOrder: 30,
    limits: [
      { meter: 'agents', soft: 40, hard: 50 },
      { meter: 'tickets', soft: 20_000, hard: 25_000 },
      { meter: 'storage', soft: 80 * 1024 * 1024 * 1024, hard: 100 * 1024 * 1024 * 1024 },
      { meter: 'api_calls', soft: 1_600_000, hard: 2_000_000 },
    ],
  },
  {
    key: 'enterprise',
    name: 'Enterprise',
    description: 'Several desks, several organisations, and the integrations.',
    features: ['ticket.customFields'],
    // No list price: at this size the number comes out of a negotiation, and
    // publishing one would be a fiction on the pricing page.
    pricePerAgentMicros: null,
    sortOrder: 40,
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
        pricePerAgentMicros: plan.pricePerAgentMicros == null ? null : BigInt(plan.pricePerAgentMicros),
        currency: plan.currency ?? 'GBP',
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
