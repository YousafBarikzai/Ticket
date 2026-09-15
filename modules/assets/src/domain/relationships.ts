import { ValidationError } from '@itsm/platform';

/**
 * What a relationship means, and which way round it goes.
 *
 * The direction is the part every CMDB gets wrong at least once, and the cost
 * of getting it wrong is not a wrong answer — it is a *confident* wrong answer,
 * given during an incident, that sends people to look at the one thing that is
 * fine. So it is stated once, here, in the terms a person would use:
 *
 *   `from depends_on to` — if **to** falls over, **from** is in trouble.
 *
 * Every other typed edge is the same shape: the subject is `from`, the thing it
 * needs is `to`. A webserver `runs_on` a VM; the VM is what it needs. An agent
 * is `installed_on` a laptop; the laptop is what it needs. A node is `member_of`
 * a cluster — which reads oddly until you ask what happens when the cluster
 * goes: the node goes with it.
 */

export const RELATIONSHIP_TYPES = [
  'depends_on',
  'runs_on',
  'installed_on',
  'member_of',
  'connected_to',
] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

/**
 * `connected_to` carries no impact.
 *
 * It says two things can reach each other, not that one needs the other, and
 * treating it as impact is how a traversal ends up returning the entire estate:
 * everything is connected to something. Kept as a type because network people
 * genuinely want to record it; kept out of the default traversal because
 * including it makes the answer useless.
 */
export const SYMMETRIC_TYPES: readonly RelationshipType[] = ['connected_to'];

export function carriesImpact(type: string): boolean {
  return (RELATIONSHIP_TYPES as readonly string[]).includes(type) && !SYMMETRIC_TYPES.includes(type as RelationshipType);
}

export function isRelationshipType(value: string): value is RelationshipType {
  return (RELATIONSHIP_TYPES as readonly string[]).includes(value);
}

/** The sentence a person reads back to check the direction is the one they meant. */
export function describe(type: RelationshipType, fromName: string, toName: string): string {
  switch (type) {
    case 'depends_on':
      return `${fromName} depends on ${toName}: if ${toName} fails, ${fromName} is in trouble`;
    case 'runs_on':
      return `${fromName} runs on ${toName}`;
    case 'installed_on':
      return `${fromName} is installed on ${toName}`;
    case 'member_of':
      return `${fromName} is a member of ${toName}`;
    case 'connected_to':
      return `${fromName} is connected to ${toName}; neither depends on the other`;
  }
}

export function assertRelationship(fromCi: string, toCi: string, type: string): asserts type is RelationshipType {
  if (!isRelationshipType(type)) {
    throw new ValidationError(`${type} is not a relationship type; one of ${RELATIONSHIP_TYPES.join(', ')}`);
  }
  if (fromCi === toCi) {
    // Harmless to the traversal, which would refuse to revisit it anyway, but
    // it is always a mistake and saying so now is cheaper than the hour spent
    // later wondering why one row in the register looks like that.
    throw new ValidationError('a configuration item cannot depend on itself');
  }
}

export const CI_STATUSES = ['operational', 'degraded', 'down', 'retired'] as const;
export type CiStatus = (typeof CI_STATUSES)[number];

export const CRITICALITIES = ['low', 'medium', 'high', 'critical'] as const;
export type Criticality = (typeof CRITICALITIES)[number];

const CRITICALITY_RANK: Record<string, number> = { critical: 3, high: 2, medium: 1, low: 0 };

export interface ImpactSummary {
  /** Configuration items reached, excluding the one asked about. */
  total: number;
  byCriticality: Record<Criticality, number>;
  /** Distinct services reached, which is what a status page is written from. */
  services: string[];
  /** The worst criticality anywhere in the blast radius. */
  worst: Criticality | null;
  /** True where the traversal stopped at the depth bound rather than running out. */
  truncated: boolean;
}

/**
 * Turns a list of reached nodes into the two or three numbers somebody reads
 * out on a bridge call.
 *
 * The list itself is rarely what is wanted in the first minute — "forty-one
 * things, six of them critical, across three services" is — and a caller that
 * has to compute that itself will compute it four different ways in four
 * different places.
 */
export function summarise(
  nodes: { criticality: string; serviceId: string | null; depth: number }[],
  depth: number,
): ImpactSummary {
  const byCriticality: Record<Criticality, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  const services = new Set<string>();
  let worst: Criticality | null = null;
  let atBound = false;

  for (const node of nodes) {
    const criticality = (CRITICALITIES as readonly string[]).includes(node.criticality)
      ? (node.criticality as Criticality)
      : 'medium';
    byCriticality[criticality] += 1;
    if (node.serviceId) services.add(node.serviceId);
    if (worst === null || CRITICALITY_RANK[criticality]! > CRITICALITY_RANK[worst]!) worst = criticality;
    if (node.depth >= depth) atBound = true;
  }

  return {
    total: nodes.length,
    byCriticality,
    services: [...services].sort(),
    worst,
    // Honest rather than precise: something sitting at the depth bound *may*
    // have more behind it. Reporting "41 things" when the real answer is 300 is
    // the failure mode worth avoiding, and the cost of the occasional
    // unnecessary "there may be more" is nothing.
    truncated: atBound,
  };
}
