import { evaluate, referencedVars, type EvalContext } from '@itsm/expr';
import {
  MAX_NODES,
  NODES_NOT_YET_AVAILABLE,
  TERMINAL_NODES,
  placeholderFields,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNode,
} from './definition.js';
import { placeholdersIn } from './template.js';

/**
 * Everything about the graph that can be decided without running it.
 *
 * Pure, like the rules engine's `decide()`, and for the same reason: the
 * validator, the test panel and the live executor all ask these functions the
 * same questions, so a rehearsal cannot disagree with the real thing.
 */

export function nodesByKey(graph: WorkflowGraph): Map<string, WorkflowNode> {
  return new Map(graph.nodes.map((node) => [node.key, node]));
}

/**
 * Which nodes run after this one.
 *
 * An edge with no condition always applies. Where several conditional edges
 * leave a node, every one that holds is followed — that is how a graph forks,
 * and refusing to choose between them is more honest than picking the first.
 */
export function nextKeys(graph: WorkflowGraph, from: string, context: EvalContext): { keys: string[]; errors: string[] } {
  const keys: string[] = [];
  const errors: string[] = [];

  for (const edge of graph.edges.filter((e) => e.from === from)) {
    if (!edge.when) {
      keys.push(edge.to);
      continue;
    }
    try {
      if (evaluate(edge.when, context)) keys.push(edge.to);
    } catch (error) {
      // An edge whose condition cannot be evaluated is not followed, and the
      // run records why. Following it would be worse: the branch exists to
      // distinguish two outcomes, and guessing picks one of them silently.
      errors.push(`edge ${edge.from} → ${edge.to}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { keys: [...new Set(keys)], errors };
}

export interface GraphProblem {
  code: string;
  where: string;
  message: string;
}

/**
 * Validates a definition before it can be published (docs/architecture/11 §2).
 *
 * Every check here exists because the failure it catches is silent at run time:
 * an unreachable node never runs and nobody notices, a cycle with no exit spins
 * until a limit stops it, and an unresolved variable renders as nothing in the
 * middle of a sentence somebody reads.
 */
export function validateGraph(graph: WorkflowGraph): GraphProblem[] {
  const problems: GraphProblem[] = [];
  const byKey = nodesByKey(graph);

  if (graph.nodes.length !== byKey.size) {
    const seen = new Set<string>();
    for (const node of graph.nodes) {
      if (seen.has(node.key)) {
        problems.push({ code: 'duplicate_key', where: node.key, message: `two nodes are both called ${node.key}` });
      }
      seen.add(node.key);
    }
  }

  if (!byKey.has(graph.start)) {
    problems.push({ code: 'unknown_start', where: 'start', message: `the workflow starts at ${graph.start}, which is not a node` });
  }

  for (const edge of graph.edges) {
    if (!byKey.has(edge.from)) {
      problems.push({ code: 'unknown_node', where: edge.from, message: `an edge leaves ${edge.from}, which is not a node` });
    }
    if (!byKey.has(edge.to)) {
      problems.push({ code: 'unknown_node', where: edge.to, message: `an edge arrives at ${edge.to}, which is not a node` });
    }
    const from = byKey.get(edge.from);
    if (from && TERMINAL_NODES.has(from.type)) {
      problems.push({ code: 'after_end', where: edge.from, message: `${edge.from} ends the workflow, so nothing can follow it` });
    }
  }

  for (const node of graph.nodes) {
    const unavailable = NODES_NOT_YET_AVAILABLE[node.type];
    if (unavailable) {
      problems.push({
        code: 'not_yet_available',
        where: node.key,
        message: `${node.key} is a ${node.type} step, which arrives with ${unavailable}`,
      });
    }

    if (node.type === 'wait') {
      const hasTimer = Boolean(node.duration);
      const hasEvent = Boolean(node.event);
      if (hasTimer === hasEvent) {
        problems.push({
          code: 'wait_shape',
          where: node.key,
          message: `${node.key} must wait for either a length of time or an event, not both and not neither`,
        });
      }
      if (node.onTimeoutKey && !byKey.has(node.onTimeoutKey)) {
        problems.push({ code: 'unknown_node', where: node.key, message: `${node.key} times out to ${node.onTimeoutKey}, which is not a node` });
      }
      if (hasEvent && !node.timeout) {
        // A wait with no timeout is a run that can sit there for ever, and
        // nobody goes looking for it.
        problems.push({
          code: 'wait_forever',
          where: node.key,
          message: `${node.key} waits for an event with no timeout, so a run could sit there indefinitely`,
        });
      }
    }

    if (node.type === 'approval' && node.onTimeoutKey && !byKey.has(node.onTimeoutKey)) {
      problems.push({ code: 'unknown_node', where: node.key, message: `${node.key} times out to ${node.onTimeoutKey}, which is not a node` });
    }

    if (!TERMINAL_NODES.has(node.type) && !graph.edges.some((edge) => edge.from === node.key)) {
      problems.push({
        code: 'dead_end',
        where: node.key,
        message: `${node.key} has nothing after it and does not end the workflow, so a run reaching it would stop silently`,
      });
    }
  }

  problems.push(...unreachable(graph, byKey));
  problems.push(...cyclesWithoutExit(graph, byKey));

  if (graph.nodes.length > MAX_NODES) {
    problems.push({ code: 'too_large', where: 'nodes', message: `a workflow may have at most ${MAX_NODES} nodes` });
  }

  return problems;
}

function unreachable(graph: WorkflowGraph, byKey: Map<string, WorkflowNode>): GraphProblem[] {
  const seen = new Set<string>();
  const queue = [graph.start];
  while (queue.length > 0) {
    const key = queue.shift()!;
    if (seen.has(key) || !byKey.has(key)) continue;
    seen.add(key);
    for (const edge of graph.edges.filter((e) => e.from === key)) queue.push(edge.to);
    // A timeout branch is a way to reach a node, and not an edge. Missing this
    // reported every timeout handler as unreachable — including the one in the
    // reference workflow this platform ships — which would have taught
    // administrators that the validator cries wolf.
    const node = byKey.get(key);
    if (node && (node.type === 'wait' || node.type === 'approval') && node.onTimeoutKey) {
      queue.push(node.onTimeoutKey);
    }
  }
  return [...byKey.keys()]
    .filter((key) => !seen.has(key))
    .map((key) => ({
      code: 'unreachable',
      where: key,
      message: `nothing leads to ${key}, so it would never run`,
    }));
}

/**
 * A loop is allowed — a reminder that repeats until something happens is a real
 * workflow — but only if it can be left. A cycle every one of whose nodes is
 * inside it, with no edge out and no terminal node, is a run that never ends.
 */
function cyclesWithoutExit(graph: WorkflowGraph, byKey: Map<string, WorkflowNode>): GraphProblem[] {
  const problems: GraphProblem[] = [];
  const colour = new Map<string, 'white' | 'grey' | 'black'>();
  for (const key of byKey.keys()) colour.set(key, 'white');

  const outEdges = (key: string): WorkflowEdge[] => graph.edges.filter((e) => e.from === key);

  const visit = (key: string, path: string[]): void => {
    if (colour.get(key) === 'black') return;
    if (colour.get(key) === 'grey') {
      const cycle = path.slice(path.indexOf(key));
      const escapes = cycle.some((member) => {
        const node = byKey.get(member);
        if (node && TERMINAL_NODES.has(node.type)) return true;
        // A conditional edge leaving the cycle is a way out; an unconditional
        // one back into it is not.
        return outEdges(member).some((edge) => !cycle.includes(edge.to) || Boolean(edge.when));
      });
      if (!escapes) {
        problems.push({
          code: 'endless_loop',
          where: cycle.join(' → '),
          message: `${cycle.join(' → ')} loops with no way out, so a run entering it would never finish`,
        });
      }
      return;
    }

    colour.set(key, 'grey');
    for (const edge of outEdges(key)) {
      if (byKey.has(edge.to)) visit(edge.to, [...path, key]);
    }
    colour.set(key, 'black');
  };

  if (byKey.has(graph.start)) visit(graph.start, []);
  return problems;
}

/**
 * Paths a definition reads that the run context will not provide.
 *
 * `available` is what the trigger and the node outputs put there, so this
 * catches `{{answers.emial}}` at publish rather than in the middle of a run —
 * where the only evidence is a blank in an email somebody already received.
 */
export function unresolvedPaths(graph: WorkflowGraph, available: readonly string[]): GraphProblem[] {
  const knows = (path: string): boolean =>
    available.some((prefix) => path === prefix || path.startsWith(`${prefix}.`)) ||
    // A node's own output is addressed by its key, so `approve.decision` is
    // readable once `approve` has run.
    graph.nodes.some((node) => path.startsWith(`${node.key}.`));

  const problems: GraphProblem[] = [];
  for (const node of graph.nodes) {
    for (const [field, template] of placeholderFields(node)) {
      for (const path of placeholdersIn(template)) {
        if (!knows(path)) {
          problems.push({
            code: 'unresolved_variable',
            where: `${node.key}.${field}`,
            message: `${node.key} reads {{${path}}}, which nothing in the run provides`,
          });
        }
      }
    }
  }

  for (const edge of graph.edges) {
    if (!edge.when) continue;
    for (const path of referencedVars(edge.when)) {
      if (!knows(path)) {
        problems.push({
          code: 'unresolved_variable',
          where: `${edge.from} → ${edge.to}`,
          message: `the condition on ${edge.from} → ${edge.to} reads ${path}, which nothing in the run provides`,
        });
      }
    }
  }

  return problems;
}
