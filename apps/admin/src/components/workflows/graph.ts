import type { IconName } from '@itsm/ui';
import { conditionText } from '../rules/presentation.js';
import { LEVELS, PRIORITIES, TICKET_STATUSES } from '../../rules/facts.js';
import { eventInfo } from '../../rules/events.js';

/**
 * A workflow's graph, read (SPEC §6.1 `/workflows/[key]`): its steps in
 * words, the order they run in, and where each sits in the diagram. Pure and
 * defensive — the graph is JSON from the API, and a shape this console does
 * not know is described as what it is rather than breaking the page.
 */

export interface FlowNode {
  readonly key: string;
  readonly type: string;
  readonly label?: string;
  readonly [field: string]: unknown;
}

export interface FlowEdge {
  readonly from: string;
  readonly to: string;
  readonly when?: unknown;
  readonly label?: string;
}

export interface FlowGraph {
  readonly trigger: { readonly kind: string; readonly event?: string; readonly when?: unknown };
  readonly start: string;
  readonly nodes: readonly FlowNode[];
  readonly edges: readonly FlowEdge[];
}

/** The graph, or null when the value is not one. */
export function parseFlow(value: unknown): FlowGraph | null {
  if (typeof value !== 'object' || value === null) return null;
  const graph = value as Record<string, unknown>;
  if (!Array.isArray(graph.nodes) || typeof graph.start !== 'string') return null;
  const nodes = graph.nodes.filter((node): node is FlowNode => typeof node === 'object' && node !== null && typeof (node as FlowNode).key === 'string' && typeof (node as FlowNode).type === 'string');
  const edges = (Array.isArray(graph.edges) ? graph.edges : []).filter(
    (edge): edge is FlowEdge => typeof edge === 'object' && edge !== null && typeof (edge as FlowEdge).from === 'string' && typeof (edge as FlowEdge).to === 'string',
  );
  const trigger = typeof graph.trigger === 'object' && graph.trigger !== null ? (graph.trigger as FlowGraph['trigger']) : { kind: 'manual' };
  return { trigger, start: graph.start, nodes, edges };
}

/**
 * Every way out of every step: the graph's edges, and the implicit ones an
 * approval or a wait takes when it times out (`onTimeoutKey`), which the
 * engine follows although no edge names them.
 */
export function flowEdges(graph: FlowGraph): FlowEdge[] {
  const edges: FlowEdge[] = [...graph.edges];
  for (const node of graph.nodes) {
    const target = node.onTimeoutKey;
    if (typeof target === 'string' && target !== '' && !edges.some((edge) => edge.from === node.key && edge.to === target)) {
      edges.push({ from: node.key, to: target, label: 'if it times out' });
    }
  }
  return edges;
}

/* ----------------------------------------------------------------- words */

export interface NodeType {
  readonly label: string;
  readonly icon: IconName;
}

export const NODE_TYPES: Readonly<Record<string, NodeType>> = {
  condition: { label: 'Check', icon: 'list-filter' },
  setField: { label: 'Set a field', icon: 'pencil' },
  assign: { label: 'Assign', icon: 'user' },
  changeStatus: { label: 'Change status', icon: 'flag' },
  createTask: { label: 'Task', icon: 'check' },
  approval: { label: 'Approval', icon: 'approvals' },
  wait: { label: 'Wait', icon: 'hourglass' },
  notify: { label: 'Notify', icon: 'bell' },
  action: { label: 'Integration', icon: 'integrations' },
  end: { label: 'End', icon: 'circle-check' },
};

export function nodeType(type: string): NodeType {
  return NODE_TYPES[type] ?? { label: type, icon: 'settings-2' };
}

const labelOf = (list: readonly { readonly value: string; readonly label: string }[], value: unknown): string =>
  list.find((entry) => entry.value === value)?.label ?? String(value ?? '');

const UNITS: readonly [string, string, string][] = [
  ['Y', 'year', 'years'],
  ['M', 'month', 'months'],
  ['W', 'week', 'weeks'],
  ['D', 'day', 'days'],
];
const TIME_UNITS: readonly [string, string, string][] = [
  ['H', 'hour', 'hours'],
  ['M', 'minute', 'minutes'],
  ['S', 'second', 'seconds'],
];

/** An ISO 8601 duration in words: `P5D` → "5 days", `PT1H30M` → "1 hour 30 minutes". */
export function durationWords(iso: unknown): string {
  if (typeof iso !== 'string') return '';
  const match = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso);
  if (!match) return iso;
  const parts: string[] = [];
  const counts = match.slice(1).map((value) => (value === undefined ? 0 : Number(value)));
  [...UNITS, ...TIME_UNITS].forEach(([, one, many], index) => {
    const count = counts[index] ?? 0;
    if (count > 0) parts.push(`${count} ${count === 1 ? one : many}`);
  });
  return parts.length > 0 ? parts.join(' ') : 'no time';
}

const RECIPIENT_WORDS: Readonly<Record<string, string>> = { requester: 'the requester', assignee: 'the assignee', group: 'the team', watchers: 'the watchers' };

/** What a step does, in a sentence: "Wait 5 days", "Move the ticket to Closed". */
export function describeNode(node: FlowNode): string {
  switch (node.type) {
    case 'condition':
      return `Check: ${conditionText(node.when)}`;
    case 'setField': {
      const field = String(node.field ?? '');
      if (field === 'priority') return `Set the priority to ${labelOf(PRIORITIES, node.value)}`;
      if (field === 'impact' || field === 'urgency') return `Set ${field} to ${labelOf(LEVELS, node.value)}`;
      return `Set ${field.replace(/Id$/, '')}`;
    }
    case 'assign':
      return node.assigneeId ? 'Assign to a person' : node.groupId ? 'Assign to a team' : 'Assign';
    case 'changeStatus':
      return `Move the ticket to ${labelOf(TICKET_STATUSES, node.status).replace(/_/g, ' ')}`;
    case 'createTask':
      return typeof node.title === 'string' && node.title ? `Create a task: ${node.title}` : 'Create a task';
    case 'approval':
      return 'Ask for approval';
    case 'wait':
      if (typeof node.duration === 'string') return `Wait ${durationWords(node.duration)}`;
      if (typeof node.event === 'string') return `Wait until ${eventInfo(node.event).label.toLowerCase()}${node.timeout ? ` (at most ${durationWords(node.timeout)})` : ''}`;
      return 'Wait';
    case 'notify':
      return `Notify ${RECIPIENT_WORDS[String(node.to)] ?? String(node.to ?? 'someone')}`;
    case 'action':
      return `Run the integration action ${String(node.action ?? '')}`.trim();
    case 'end':
      return 'Finish';
    default:
      return nodeType(node.type).label;
  }
}

/** A step's name: its label, or what it does. Never the bare key. */
export function nodeTitle(node: FlowNode): string {
  return typeof node.label === 'string' && node.label.trim() !== '' ? node.label : describeNode(node);
}

/** An edge's condition in words: its label, "when <condition>", or nothing when it always applies. */
export function edgeWords(edge: FlowEdge): string | null {
  if (typeof edge.label === 'string' && edge.label.trim() !== '') return edge.label;
  if (edge.when === undefined || edge.when === null) return null;
  return `when ${conditionText(edge.when).toLowerCase()}`;
}

/** How a run starts: "When the status changes, if a condition holds", "Started by a rule". */
export function triggerWords(trigger: FlowGraph['trigger'] | null | undefined): string {
  if (!trigger) return 'Unknown';
  switch (trigger.kind) {
    case 'event': {
      const heading = trigger.event ? eventInfo(trigger.event).heading : 'When an event happens';
      return trigger.when ? `${heading}, if a condition holds` : heading;
    }
    case 'manual':
      return 'Started by hand';
    case 'rule':
      return 'Started by a rule';
    default:
      return trigger.kind;
  }
}

/* ------------------------------------------------------------------ order */

/**
 * The steps in the order a reader should meet them: breadth first from the
 * start, each branch after the step it leaves; steps nothing reaches come
 * last (the check calls them out).
 */
export function stepOrder(graph: FlowGraph): FlowNode[] {
  const byKey = new Map(graph.nodes.map((node) => [node.key, node]));
  const seen = new Set<string>();
  const order: FlowNode[] = [];
  const queue = [graph.start];
  while (queue.length > 0) {
    const key = queue.shift()!;
    if (seen.has(key)) continue;
    seen.add(key);
    const node = byKey.get(key);
    if (!node) continue;
    order.push(node);
    for (const edge of flowEdges(graph)) if (edge.from === key && !seen.has(edge.to)) queue.push(edge.to);
  }
  for (const node of graph.nodes) if (!seen.has(node.key)) order.push(node);
  return order;
}

export function reachable(graph: FlowGraph): Set<string> {
  const reached = new Set<string>();
  const queue = [graph.start];
  while (queue.length > 0) {
    const key = queue.shift()!;
    if (reached.has(key)) continue;
    reached.add(key);
    for (const edge of flowEdges(graph)) if (edge.from === key) queue.push(edge.to);
  }
  return reached;
}

export interface Step {
  readonly key: string;
  readonly number: number;
  readonly title: string;
  readonly type: NodeType;
  readonly description: string;
  readonly reachable: boolean;
  readonly next: readonly { readonly key: string; readonly title: string; readonly condition: string | null }[];
}

/** The Steps outline: an ordered list with what each step does and where it goes next. */
export function steps(graph: FlowGraph): Step[] {
  const order = stepOrder(graph);
  const numbers = new Map(order.map((node, index) => [node.key, index + 1]));
  const byKey = new Map(graph.nodes.map((node) => [node.key, node]));
  const reached = reachable(graph);
  return order.map((node) => ({
    key: node.key,
    number: numbers.get(node.key)!,
    title: nodeTitle(node),
    type: nodeType(node.type),
    description: describeNode(node),
    reachable: reached.has(node.key),
    next: flowEdges(graph)
      .filter((edge) => edge.from === node.key)
      .map((edge) => {
        const target = byKey.get(edge.to);
        return { key: edge.to, title: target ? nodeTitle(target) : edge.to, condition: edgeWords(edge) };
      }),
  }));
}

/* ----------------------------------------------------------------- layout */

export interface PlacedNode {
  readonly key: string;
  readonly layer: number;
  readonly x: number;
  readonly y: number;
}

export interface PlacedEdge {
  readonly from: string;
  readonly to: string;
  readonly label: string | null;
  /** Goes back up the diagram: a loop. */
  readonly back: boolean;
  readonly path: string;
  readonly labelX: number;
  readonly labelY: number;
  /** Where the label hangs from its point: beside a side curve, or centred on a straight edge. */
  readonly labelAnchor: 'start' | 'middle' | 'end';
}

export interface Layout {
  readonly nodes: readonly PlacedNode[];
  readonly edges: readonly PlacedEdge[];
  readonly width: number;
  readonly height: number;
}

export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 56;
const GAP_X = 40;
const GAP_Y = 64;
const PAD = 16;
/** Room either side for loops, edges that skip a layer, and their labels. */
const SIDE = 150;

/**
 * Top-to-bottom layers: each step one layer below the furthest step that
 * leads to it (a longest path from the start, ignoring loops), steps nothing
 * reaches in a last layer of their own. Within a layer, steps keep the order
 * they were written in. Enough for the graphs workflows are — tens of steps,
 * a few branches — and deterministic, so the same graph always draws the same.
 */
export function layout(graph: FlowGraph): Layout {
  const keys = graph.nodes.map((node) => node.key);
  const index = new Map(keys.map((key, position) => [key, position]));
  // Edges between the same two steps are drawn once, with their conditions joined.
  const merged = new Map<string, { from: string; to: string; labels: string[] }>();
  for (const edge of flowEdges(graph)) {
    const id = `${edge.from}->${edge.to}`;
    const entry = merged.get(id) ?? { from: edge.from, to: edge.to, labels: [] };
    const words = edgeWords(edge);
    if (words && !entry.labels.includes(words)) entry.labels.push(words);
    merged.set(id, entry);
  }
  const outgoing = new Map<string, string[]>();
  for (const edge of merged.values()) {
    if (!index.has(edge.from) || !index.has(edge.to)) continue;
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge.to);
    outgoing.set(edge.from, list);
  }

  // Back edges: found by a depth-first walk from the start.
  const back = new Set<string>();
  const state = new Map<string, 'open' | 'done'>();
  const visit = (key: string): void => {
    state.set(key, 'open');
    for (const next of outgoing.get(key) ?? []) {
      const seen = state.get(next);
      if (seen === 'open') back.add(`${key}->${next}`);
      else if (seen === undefined) visit(next);
    }
    state.set(key, 'done');
  };
  if (index.has(graph.start)) visit(graph.start);

  // Longest path over the forward edges.
  const layer = new Map<string, number>();
  if (index.has(graph.start)) layer.set(graph.start, 0);
  const reached = [...state.keys()];
  for (let pass = 0; pass < reached.length; pass += 1) {
    let changed = false;
    for (const key of reached) {
      const at = layer.get(key);
      if (at === undefined) continue;
      for (const next of outgoing.get(key) ?? []) {
        if (back.has(`${key}->${next}`)) continue;
        if ((layer.get(next) ?? -1) < at + 1) {
          layer.set(next, at + 1);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  const deepest = Math.max(-1, ...layer.values());
  for (const key of keys) if (!layer.has(key)) layer.set(key, deepest + 1);

  const layers = new Map<number, string[]>();
  for (const key of keys) {
    const at = layer.get(key)!;
    const list = layers.get(at) ?? [];
    list.push(key);
    layers.set(at, list);
  }
  const widest = Math.max(1, ...[...layers.values()].map((list) => list.length));
  const width = (PAD + SIDE) * 2 + widest * NODE_WIDTH + (widest - 1) * GAP_X;
  const depth = Math.max(1, layers.size);
  const height = PAD * 2 + depth * NODE_HEIGHT + (depth - 1) * GAP_Y;

  const placed = new Map<string, PlacedNode>();
  for (const [at, list] of layers) {
    const rowWidth = list.length * NODE_WIDTH + (list.length - 1) * GAP_X;
    const left = (width - rowWidth) / 2;
    list.forEach((key, position) => {
      placed.set(key, { key, layer: at, x: left + position * (NODE_WIDTH + GAP_X), y: PAD + at * (NODE_HEIGHT + GAP_Y) });
    });
  }

  const edges: PlacedEdge[] = [];
  for (const edge of merged.values()) {
    const from = placed.get(edge.from);
    const to = placed.get(edge.to);
    if (!from || !to) continue;
    const label = edge.labels.length > 0 ? edge.labels.join(' or ') : null;
    const isBack = back.has(`${edge.from}->${edge.to}`) || to.y <= from.y;
    const skips = !isBack && to.layer - from.layer > 1;
    const x1 = from.x + NODE_WIDTH / 2;
    const x2 = to.x + NODE_WIDTH / 2;
    let path: string;
    let labelX: number;
    let labelY: number;
    let labelAnchor: PlacedEdge['labelAnchor'] = 'middle';
    if (isBack || skips) {
      // A loop leaves by the right side and comes back up; an edge that
      // skips a layer goes round the left, so neither runs behind a step.
      const y1 = from.y + NODE_HEIGHT / 2;
      const y2 = to.y + NODE_HEIGHT / 2;
      // A loop, or a skip starting right of the middle, goes round the right; other skips round the left.
      const rightSide = isBack || from.x + NODE_WIDTH / 2 > width / 2;
      if (rightSide) {
        const right = Math.max(from.x, to.x) + NODE_WIDTH;
        const bulge = right + GAP_X / 2;
        path = `M ${from.x + NODE_WIDTH} ${y1} C ${bulge} ${y1}, ${bulge} ${y2}, ${to.x + NODE_WIDTH} ${y2}`;
        labelX = bulge + 6;
        labelAnchor = 'start';
      } else {
        const left = Math.min(from.x, to.x);
        const bulge = left - GAP_X / 2;
        path = `M ${from.x} ${y1} C ${bulge} ${y1}, ${bulge} ${y2}, ${to.x} ${y2}`;
        labelX = bulge - 6;
        labelAnchor = 'end';
      }
      labelY = (y1 + y2) / 2;
    } else {
      const y1 = from.y + NODE_HEIGHT;
      const y2 = to.y;
      const middle = (y1 + y2) / 2;
      path = `M ${x1} ${y1} C ${x1} ${middle}, ${x2} ${middle}, ${x2} ${y2}`;
      labelX = (x1 + x2) / 2;
      labelY = middle;
    }
    edges.push({ from: edge.from, to: edge.to, label, back: isBack, path, labelX, labelY, labelAnchor });
  }

  return { nodes: [...placed.values()], edges, width, height };
}
