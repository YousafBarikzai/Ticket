import { describe, expect, it } from 'vitest';
import {
  RELATIONSHIP_TYPES,
  assertRelationship,
  carriesImpact,
  describe as describeEdge,
  summarise,
} from '../domain/relationships.js';
import { IMPACT_EDGES } from '../repo/graph-repo.js';

/**
 * The direction of an edge is the thing a CMDB is most often confidently wrong
 * about, and a confident wrong answer during an incident sends people to look
 * at the one thing that is fine.
 */

describe('relationship types', () => {
  it('excludes the symmetric type from impact, because everything is connected to something', () => {
    expect(carriesImpact('connected_to')).toBe(false);
    expect(carriesImpact('depends_on')).toBe(true);
  });

  it('keeps the traversal defaults and the domain in step', () => {
    // The repo picks the default edge set; the domain decides which types carry
    // impact. Two lists that disagree would mean a traversal quietly walking an
    // edge the domain says means nothing, or missing one it says does.
    expect([...IMPACT_EDGES].sort()).toEqual(RELATIONSHIP_TYPES.filter(carriesImpact).sort());
  });

  it('reads the direction back as a sentence somebody can check', () => {
    expect(describeEdge('depends_on', 'checkout', 'orders-db')).toContain('if orders-db fails, checkout is in trouble');
  });

  it('refuses a self-edge and an invented type', () => {
    expect(() => assertRelationship('a', 'a', 'depends_on')).toThrow(/cannot depend on itself/);
    expect(() => assertRelationship('a', 'b', 'sits_near')).toThrow(/not a relationship type/);
  });
});

describe('summarise', () => {
  const node = (over: Partial<{ criticality: string; serviceId: string | null; depth: number }> = {}) => ({
    criticality: 'medium',
    serviceId: null,
    depth: 1,
    ...over,
  });

  it('counts by criticality and names the distinct services', () => {
    const summary = summarise(
      [
        node({ criticality: 'critical', serviceId: 's1' }),
        node({ criticality: 'high', serviceId: 's1' }),
        node({ criticality: 'low', serviceId: 's2' }),
      ],
      3,
    );
    expect(summary.total).toBe(3);
    expect(summary.byCriticality).toEqual({ low: 1, medium: 0, high: 1, critical: 1 });
    expect(summary.services).toEqual(['s1', 's2']);
    expect(summary.worst).toBe('critical');
  });

  it('says there may be more when something sits at the depth bound', () => {
    expect(summarise([node({ depth: 3 })], 3).truncated).toBe(true);
    expect(summarise([node({ depth: 2 })], 3).truncated).toBe(false);
  });

  it('is honest about an empty answer rather than inventing a worst case', () => {
    const summary = summarise([], 3);
    expect(summary.total).toBe(0);
    expect(summary.worst).toBeNull();
    expect(summary.truncated).toBe(false);
  });

  it('treats an unrecognised criticality as medium instead of dropping the row', () => {
    // A row is a thing that can break whatever its criticality column says; a
    // summary that silently omitted it would undercount the blast radius.
    const summary = summarise([node({ criticality: 'catastrophic' })], 3);
    expect(summary.total).toBe(1);
    expect(summary.byCriticality.medium).toBe(1);
  });
});
