import type { Tx } from '@itsm/platform';

/**
 * The CMDB graph queries.
 *
 * Raw SQL, in a `repo/` folder because that is where the module contract puts
 * anything that touches the database directly (docs/architecture/04 §3). It is
 * raw because the shape doc 06 §2.4 specifies — a depth-bounded recursive CTE
 * over typed edges — is not expressible in the query builder, and the target it
 * exists to meet is a measured one: impact traversal under a second at 100 000
 * CIs and 500 000 relationships, depth 3 (doc 18).
 *
 * Every query here is parameterised. Nothing is interpolated into the SQL, so
 * a CI class or relationship type a tenant invented cannot become SQL.
 */

/** Edge types that carry impact. `connected_to` does not: it is symmetric and
 *  says two things can reach each other, not that one needs the other. */
export const IMPACT_EDGES = ['depends_on', 'runs_on', 'installed_on', 'member_of'] as const;

export const MAX_DEPTH = 6;
export const DEFAULT_DEPTH = 3;

export interface GraphNode {
  id: string;
  name: string;
  status: string;
  criticality: string;
  serviceId: string | null;
  className: string;
  /** How many edges away from the CI that was asked about. */
  depth: number;
  /** The edge type that brought us here, on the shortest path found. */
  via: string;
}

/**
 * What falls over if this CI does.
 *
 * `from depends_on to` means: if `to` fails, `from` is in trouble. So impact
 * walks **incoming** edges — everything whose row points at this CI — and then
 * everything pointing at those.
 *
 * The `path` array is not decoration. Real CMDBs are full of cycles: a
 * webserver runs on a VM, the VM is a member of a cluster, the cluster depends
 * on the webserver for its health check. Without cycle detection this query
 * does not return a wrong answer, it returns no answer, and the first anybody
 * hears of it is a request timing out during an incident.
 */
export async function impactOf(
  tx: Tx,
  tenantId: string,
  ciId: string,
  depth: number,
  types: readonly string[],
): Promise<GraphNode[]> {
  return tx.$queryRawUnsafe<GraphNode[]>(
    `
    WITH RECURSIVE reached AS (
      SELECT r.from_ci AS id, r.type AS via, 1 AS depth,
             ARRAY[r.to_ci, r.from_ci] AS path
      FROM ci_relationship r
      -- Retired items are filtered here, inside the traversal, rather than at
      -- the end. A decommissioned server that still has its old edges must not
      -- carry impact *through* itself to the things behind it: filtering only
      -- the result would hide the dead server and keep everything it reached.
      JOIN configuration_item c
        ON c.id = r.from_ci AND c.tenant_id = $1::uuid AND c.retired_at IS NULL
      WHERE r.tenant_id = $1::uuid
        AND r.to_ci = $2::uuid
        AND r.type = ANY($3::text[])

      UNION ALL

      SELECT r.from_ci, r.type, reached.depth + 1,
             reached.path || r.from_ci
      FROM ci_relationship r
      JOIN reached ON r.to_ci = reached.id
      JOIN configuration_item c
        ON c.id = r.from_ci AND c.tenant_id = $1::uuid AND c.retired_at IS NULL
      WHERE r.tenant_id = $1::uuid
        AND r.type = ANY($3::text[])
        AND reached.depth < $4::int
        AND NOT (r.from_ci = ANY(reached.path))
    ),
    -- The same CI can be reached by several paths. The shortest is the one
    -- worth reporting: "two hops away" is a different conversation from "six".
    shortest AS (
      SELECT id, MIN(depth) AS depth, (ARRAY_AGG(via ORDER BY depth))[1] AS via
      FROM reached
      GROUP BY id
    )
    SELECT ci.id, ci.name, ci.status, ci.criticality,
           ci.service_id AS "serviceId", cls.name AS "className",
           shortest.depth::int AS depth, shortest.via AS via
    FROM shortest
    JOIN configuration_item ci ON ci.id = shortest.id AND ci.tenant_id = $1::uuid
    JOIN ci_class cls ON cls.id = ci.class_id
    ORDER BY shortest.depth ASC,
             -- Critical things first within a depth: an impact list read during
             -- an incident is read from the top and rarely to the bottom.
             CASE ci.criticality WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
             ci.name ASC
    LIMIT 1000
    `,
    tenantId,
    ciId,
    [...types],
    depth,
  );
}

/**
 * What this CI needs in order to work.
 *
 * The same traversal with the edges read the other way. Asked before a change:
 * "what am I relying on that might not be there?"
 */
export async function dependenciesOf(
  tx: Tx,
  tenantId: string,
  ciId: string,
  depth: number,
  types: readonly string[],
): Promise<GraphNode[]> {
  return tx.$queryRawUnsafe<GraphNode[]>(
    `
    WITH RECURSIVE reached AS (
      SELECT r.to_ci AS id, r.type AS via, 1 AS depth,
             ARRAY[r.from_ci, r.to_ci] AS path
      FROM ci_relationship r
      JOIN configuration_item c
        ON c.id = r.to_ci AND c.tenant_id = $1::uuid AND c.retired_at IS NULL
      WHERE r.tenant_id = $1::uuid
        AND r.from_ci = $2::uuid
        AND r.type = ANY($3::text[])

      UNION ALL

      SELECT r.to_ci, r.type, reached.depth + 1,
             reached.path || r.to_ci
      FROM ci_relationship r
      JOIN reached ON r.from_ci = reached.id
      JOIN configuration_item c
        ON c.id = r.to_ci AND c.tenant_id = $1::uuid AND c.retired_at IS NULL
      WHERE r.tenant_id = $1::uuid
        AND r.type = ANY($3::text[])
        AND reached.depth < $4::int
        AND NOT (r.to_ci = ANY(reached.path))
    ),
    shortest AS (
      SELECT id, MIN(depth) AS depth, (ARRAY_AGG(via ORDER BY depth))[1] AS via
      FROM reached
      GROUP BY id
    )
    SELECT ci.id, ci.name, ci.status, ci.criticality,
           ci.service_id AS "serviceId", cls.name AS "className",
           shortest.depth::int AS depth, shortest.via AS via
    FROM shortest
    JOIN configuration_item ci ON ci.id = shortest.id AND ci.tenant_id = $1::uuid
    JOIN ci_class cls ON cls.id = ci.class_id
    ORDER BY shortest.depth ASC, ci.name ASC
    LIMIT 1000
    `,
    tenantId,
    ciId,
    [...types],
    depth,
  );
}

/**
 * Every class from the root of the hierarchy down to this one.
 *
 * Bounded, because a class that is its own ancestor would otherwise loop here
 * exactly as an unbounded traversal would. The bound is small: a class
 * hierarchy deeper than eight is a modelling problem, not a query problem.
 */
export async function classChain(tx: Tx, tenantId: string, classId: string): Promise<{ id: string; key: string; attributes: unknown }[]> {
  return tx.$queryRawUnsafe<{ id: string; key: string; attributes: unknown }[]>(
    `
    WITH RECURSIVE chain AS (
      SELECT c.id, c.key, c.attributes, c.parent_id, 1 AS depth
      FROM ci_class c
      WHERE c.tenant_id = $1::uuid AND c.id = $2::uuid

      UNION ALL

      SELECT parent.id, parent.key, parent.attributes, parent.parent_id, chain.depth + 1
      FROM ci_class parent
      JOIN chain ON parent.id = chain.parent_id
      WHERE parent.tenant_id = $1::uuid AND chain.depth < 8
    )
    -- Most general first, so a subclass may tighten what it inherits.
    SELECT id, key, attributes FROM chain ORDER BY depth DESC
    `,
    tenantId,
    classId,
  );
}
