import { describe, expect, it } from 'vitest';
import { parseGraph, type WorkflowGraph } from '../domain/definition.js';
import { nextKeys, unresolvedPaths, validateGraph } from '../domain/graph.js';
import { REFERENCE_WORKFLOWS } from '../seed/defaults.js';
import { RUN_FACTS } from '../service/workflow-service.js';

/**
 * The validator earns its place by catching failures that are silent at run
 * time. Each test below names the silence it prevents.
 */

const minimal = (over: Partial<WorkflowGraph> = {}): WorkflowGraph =>
  parseGraph({
    schemaVersion: 1,
    trigger: { kind: 'manual' },
    start: 'a',
    nodes: [
      { key: 'a', type: 'changeStatus', status: 'in_progress' },
      { key: 'end', type: 'end' },
    ],
    edges: [{ from: 'a', to: 'end' }],
    ...over,
  });

describe('the reference workflows', () => {
  // They ship published, so a problem in one of them is a problem in every
  // tenant's provisioning. They are also the engine's acceptance tests: each
  // uses a different node type.
  for (const reference of REFERENCE_WORKFLOWS) {
    it(`${reference.key} is valid and could be published`, () => {
      const graph = parseGraph(reference.graph);
      expect(validateGraph(graph)).toEqual([]);
      expect(unresolvedPaths(graph, RUN_FACTS)).toEqual([]);
    });
  }

  it('between them exercise every node type the phase delivers', () => {
    const used = new Set(REFERENCE_WORKFLOWS.flatMap((w) => w.graph.nodes.map((n) => n.type)));
    for (const type of ['wait', 'condition', 'changeStatus', 'setField', 'notify', 'approval', 'createTask', 'end']) {
      expect({ type, used: used.has(type as never) }).toEqual({ type, used: true });
    }
  });

  it('cannot send anything to a customer or touch another system', () => {
    // Seeded automation runs on day one in a tenant nobody has configured. The
    // only notifications it sends go to the people working the ticket.
    const audiences = REFERENCE_WORKFLOWS.flatMap((w) =>
      w.graph.nodes.filter((n) => n.type === 'notify').map((n) => (n as { to: string }).to),
    );
    expect(audiences.every((to) => ['assignee', 'group', 'requester'].includes(to))).toBe(true);
    expect(REFERENCE_WORKFLOWS.some((w) => w.graph.nodes.some((n) => n.type === 'action'))).toBe(false);
  });
});

describe('validation refuses what would fail silently', () => {
  it('a node nothing leads to, which would never run', () => {
    const graph = minimal({
      nodes: [
        { key: 'a', type: 'changeStatus', status: 'in_progress' },
        { key: 'orphan', type: 'changeStatus', status: 'closed' },
        { key: 'end', type: 'end' },
      ],
      edges: [{ from: 'a', to: 'end' }],
    });
    const problems = validateGraph(graph);
    expect(problems.map((p) => p.code)).toContain('unreachable');
    expect(problems.find((p) => p.code === 'unreachable')?.message).toMatch(/would never run/);
  });

  it('a node with nothing after it, where a run would stop without saying so', () => {
    const graph = minimal({ edges: [] });
    expect(validateGraph(graph).map((p) => p.code)).toContain('dead_end');
  });

  it('a loop with no way out', () => {
    const graph = minimal({
      start: 'a',
      nodes: [
        { key: 'a', type: 'changeStatus', status: 'in_progress' },
        { key: 'b', type: 'changeStatus', status: 'on_hold' },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
    });
    expect(validateGraph(graph).map((p) => p.code)).toContain('endless_loop');
  });

  it('but allows a loop that can be left', () => {
    // A reminder that repeats until somebody replies is a real workflow.
    const graph = minimal({
      start: 'chase',
      nodes: [
        { key: 'chase', type: 'notify', template: 'ticket.reminder', to: 'assignee' },
        { key: 'replied', type: 'condition', when: { exists: { var: 'ticket.lastReplyAt' } } },
        { key: 'end', type: 'end' },
      ],
      edges: [
        { from: 'chase', to: 'replied' },
        { from: 'replied', to: 'end', when: { eq: [{ var: 'replied.result' }, true] } },
        { from: 'replied', to: 'chase', when: { eq: [{ var: 'replied.result' }, false] } },
      ],
    });
    expect(validateGraph(graph).filter((p) => p.code === 'endless_loop')).toEqual([]);
  });

  it('a step after the end, which would never be reached', () => {
    const graph = minimal({
      edges: [
        { from: 'a', to: 'end' },
        { from: 'end', to: 'a' },
      ],
    });
    expect(validateGraph(graph).map((p) => p.code)).toContain('after_end');
  });

  it('a wait for an event with no timeout, which could park a run for ever', () => {
    const graph = minimal({
      start: 'hold',
      nodes: [
        { key: 'hold', type: 'wait', event: 'ticket.task.completed' },
        { key: 'end', type: 'end' },
      ],
      edges: [{ from: 'hold', to: 'end' }],
    });
    expect(validateGraph(graph).map((p) => p.code)).toContain('wait_forever');
  });

  it('a wait that is neither a timer nor an event', () => {
    const graph = minimal({
      start: 'hold',
      nodes: [
        { key: 'hold', type: 'wait' },
        { key: 'end', type: 'end' },
      ],
      edges: [{ from: 'hold', to: 'end' }],
    });
    expect(validateGraph(graph).map((p) => p.code)).toContain('wait_shape');
  });

  it('an action step, which this phase cannot carry out', () => {
    // Refused at publish rather than skipped at run time: a workflow that
    // silently skips a step is worse than one that will not go live.
    const graph = minimal({
      start: 'call',
      nodes: [
        { key: 'call', type: 'action', action: 'http.entra.createUser', input: {} },
        { key: 'end', type: 'end' },
      ],
      edges: [{ from: 'call', to: 'end' }],
    });
    const problems = validateGraph(graph);
    expect(problems.map((p) => p.code)).toContain('not_yet_available');
    expect(problems.find((p) => p.code === 'not_yet_available')?.message).toMatch(/MOD-06-E2/);
  });
});

describe('unresolved variables', () => {
  it('finds a typo in a template before somebody receives the blank', () => {
    const graph = minimal({
      start: 'name-it',
      nodes: [
        { key: 'name-it', type: 'createTask', taskKey: 'x', title: 'Set up {{tickt.title}}' },
        { key: 'end', type: 'end' },
      ],
      edges: [{ from: 'name-it', to: 'end' }],
    });
    const problems = unresolvedPaths(graph, RUN_FACTS);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toMatch(/tickt\.title/);
  });

  it('says nothing about a key inside an open namespace, because it cannot know', () => {
    // Form answers are tenant-defined, so `answers.whatever` is unknowable at
    // publish — the same reason the expression checker leaves `fields.*` alone.
    // Claiming otherwise would mean refusing every workflow that reads a form.
    const graph = minimal({
      start: 'name-it',
      nodes: [
        { key: 'name-it', type: 'createTask', taskKey: 'x', title: 'Set up {{answers.emial}}' },
        { key: 'end', type: 'end' },
      ],
      edges: [{ from: 'name-it', to: 'end' }],
    });
    expect(unresolvedPaths(graph, RUN_FACTS)).toEqual([]);
  });

  it('accepts a path the trigger provides, and one an earlier node produces', () => {
    const graph = minimal({
      start: 'ask',
      nodes: [
        { key: 'ask', type: 'approval', policyKey: 'p' },
        { key: 'name-it', type: 'createTask', taskKey: 'x', title: '{{ticket.title}} approved by {{ask.decidedBy}}' },
        { key: 'end', type: 'end' },
      ],
      edges: [
        { from: 'ask', to: 'name-it' },
        { from: 'name-it', to: 'end' },
      ],
    });
    expect(unresolvedPaths(graph, RUN_FACTS)).toEqual([]);
  });
});

describe('choosing the next step', () => {
  const graph = minimal({
    start: 'check',
    nodes: [
      { key: 'check', type: 'condition', when: { always: true } },
      { key: 'yes', type: 'changeStatus', status: 'in_progress' },
      { key: 'no', type: 'changeStatus', status: 'on_hold' },
      { key: 'end', type: 'end' },
    ],
    edges: [
      { from: 'check', to: 'yes', when: { eq: [{ var: 'check.result' }, true] } },
      { from: 'check', to: 'no', when: { eq: [{ var: 'check.result' }, false] } },
      { from: 'yes', to: 'end' },
      { from: 'no', to: 'end' },
    ],
  });

  it('follows the branch whose condition holds', () => {
    expect(nextKeys(graph, 'check', { check: { result: true } }).keys).toEqual(['yes']);
    expect(nextKeys(graph, 'check', { check: { result: false } }).keys).toEqual(['no']);
  });

  it('follows no branch, and says nothing is wrong, when neither holds', () => {
    // The run stops rather than guessing. A branch exists to tell two outcomes
    // apart, and picking one silently defeats it.
    //
    // This found a real one: `eq` used to compare truthiness when either side
    // was a boolean, so `{ eq: [check.result, true] }` held for the string
    // "maybe" — and every condition node would have taken its "yes" edge
    // whatever the step actually returned.
    const result = nextKeys(graph, 'check', { check: { result: 'maybe' } });
    expect(result.keys).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('records, rather than follows, an edge whose condition cannot be evaluated', () => {
    const broken = minimal({
      start: 'check',
      nodes: [
        { key: 'check', type: 'condition', when: { always: true } },
        { key: 'end', type: 'end' },
      ],
      edges: [{ from: 'check', to: 'end', when: { gt: [{ var: 'ticket.title' }, 5] } }],
    });
    const result = nextKeys(broken, 'check', { ticket: { title: 'VPN will not connect' } });
    expect(result.keys).toEqual([]);
    expect(result.errors[0]).toMatch(/cannot compare string with number/);
  });
});
