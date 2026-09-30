// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, forwardRef, type AnchorHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { structuralVariables, themeVariables } from '@itsm/ui/tokens';

vi.mock('server-only', () => ({}));

let search = '';
const router = { refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), forward: vi.fn() };
vi.mock('next/navigation', () => ({
  usePathname: () => '/workflows/runs',
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(search),
}));

const run = vi.fn();
const runs = vi.fn();
const retry = vi.fn(async () => ({}));
const skip = vi.fn(async () => ({}));
const cancel = vi.fn(async () => ({}));
const publish = vi.fn(async () => ({ version: 2 }));
const rollback = vi.fn(async () => ({ version: 3, restoredFrom: 1 }));
const ticket = vi.fn(async () => ({ id: 't-1', number: 'INC-000005', title: 'VPN keeps dropping' }));
vi.mock('../client/api.js', () => ({
  api: { configure: { workflows: { run, runs, retry, skip, cancel, publish, rollback } }, observe: { ticket } },
}));

const { ItsmProvider } = await import('@itsm/ui');
const graph = await import('../components/workflows/graph.js');
const wf = await import('../components/workflows/presentation.js');
const { RunsTable } = await import('../components/workflows/RunsTable.js');
const { WorkflowDetail } = await import('../components/workflows/WorkflowDetail.js');
const { StepsOutline } = await import('../components/workflows/StepsOutline.js');
const { cleanupDocument, click, clickAsync, render, type } = await import('./support/render.js');

/**
 * Workflows (SPEC §6.1; F25): a graph read as steps and drawn as a diagram,
 * runs whose actions follow their state — retry and skip only for a failed
 * step, abandon for a failed or waiting run, nothing otherwise — bulk retry
 * for failed runs only, and a publish that waits for a clean check.
 */

const Link = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean | null }>(function Link(
  { prefetch: _prefetch, ...props },
  ref,
) {
  return <a ref={ref} {...props} />;
});

function Frame({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <ItsmProvider
      app="admin"
      Link={Link}
      router={router}
      usePathname={() => '/workflows/runs'}
      useSearchParams={() => new URLSearchParams(search)}
      locale="en-GB"
      timeZone="Europe/London"
    >
      {children}
    </ItsmProvider>
  );
}

beforeEach(() => {
  search = '';
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: /min-width/.test(query),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
});

afterEach(() => {
  cleanupDocument();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

const text = (element: Element | null | undefined): string => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const buttonNamed = (root: ParentNode, name: string): HTMLButtonElement | undefined =>
  [...root.querySelectorAll('button')].find((button) => text(button) === name) as HTMLButtonElement | undefined;
const dialogWith = (words: string): Element | undefined =>
  [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].find((element) => text(element).includes(words));

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** The seeded "Fulfil an approved request": a fork, a timeout path and a shared end. */
const FULFIL = graph.parseFlow({
  schemaVersion: 1,
  trigger: { kind: 'rule' },
  start: 'approve',
  nodes: [
    { key: 'approve', type: 'approval', label: 'Ask for approval', policyKey: 'request-approval', onTimeoutKey: 'give-up' },
    { key: 'do-the-work', type: 'createTask', label: 'Raise the fulfilment task', taskKey: 'fulfil', title: 'Fulfil the approved request' },
    { key: 'tell-requester', type: 'notify', label: 'Tell the requester', template: 'ticket.updated', to: 'requester' },
    { key: 'give-up', type: 'changeStatus', label: 'Nobody approved in time', status: 'on_hold' },
    { key: 'done', type: 'end' },
  ],
  edges: [
    { from: 'approve', to: 'do-the-work', when: { eq: [{ var: 'approve.decision' }, 'approved'] }, label: 'approved' },
    { from: 'approve', to: 'tell-requester', when: { eq: [{ var: 'approve.decision' }, 'rejected'] }, label: 'rejected' },
    { from: 'approve', to: 'do-the-work', when: { eq: [{ var: 'approve.decision' }, 'not_required'] }, label: 'no policy applies' },
    { from: 'do-the-work', to: 'tell-requester' },
    { from: 'tell-requester', to: 'done' },
    { from: 'give-up', to: 'done' },
  ],
})!;

const LOOP = graph.parseFlow({
  trigger: { kind: 'event', event: 'ticket.status.changed', when: { eq: [{ var: 'to' }, 'resolved'] } },
  start: 'settle',
  nodes: [
    { key: 'settle', type: 'wait', duration: 'P5D' },
    { key: 'check', type: 'condition', when: { eq: [{ var: 'ticket.status' }, 'resolved'] } },
    { key: 'orphan', type: 'notify', to: 'watchers' },
  ],
  edges: [
    { from: 'settle', to: 'check' },
    { from: 'check', to: 'settle', label: 'reopened' },
  ],
})!;

const RUN = {
  id: 'r1',
  workflowId: 'w1',
  workflowKey: 'request-fulfilment',
  workflowName: 'Fulfil an approved request',
  ticketId: 't-1',
  status: 'failed',
  currentKeys: ['do-the-work'],
  stepTitle: 'Raise the fulfilment task',
  error: 'The integration did not answer',
  triggeredBy: 'rule:vip-requester',
  startedAt: '2026-09-30T07:00:00.000Z',
  endedAt: null,
} as const;

/* ======================================================================= */

describe('a graph, read', () => {
  it('refuses what is not a graph, and reads timeouts as ways out', () => {
    expect(graph.parseFlow(null)).toBeNull();
    expect(graph.parseFlow({ nodes: 'x', start: 'a' })).toBeNull();
    expect(graph.flowEdges(FULFIL).find((edge) => edge.to === 'give-up')).toEqual({ from: 'approve', to: 'give-up', label: 'if it times out' });
  });

  it('lists the steps in running order, each saying what it does and where it goes', () => {
    const steps = graph.steps(FULFIL);
    expect(steps.map((step) => step.key)).toEqual(['approve', 'do-the-work', 'tell-requester', 'give-up', 'done']);
    expect(steps[0]!.next.map((next) => `${next.title}${next.condition ? ` (${next.condition})` : ''}`)).toEqual([
      'Raise the fulfilment task (approved)',
      'Tell the requester (rejected)',
      'Raise the fulfilment task (no policy applies)',
      'Nobody approved in time (if it times out)',
    ]);
    expect(steps.every((step) => step.reachable)).toBe(true);
    expect(steps[3]!.description).toBe('Move the ticket to on hold');
    expect(steps[4]!.title).toBe('Finish');
  });

  it('says what each step does without a key', () => {
    expect(graph.describeNode({ key: 'w', type: 'wait', duration: 'PT1H30M' })).toBe('Wait 1 hour 30 minutes');
    expect(graph.describeNode({ key: 'w', type: 'wait', event: 'ticket.comment.added', timeout: 'P2D' })).toBe('Wait until someone comments (at most 2 days)');
    expect(graph.describeNode({ key: 's', type: 'setField', field: 'priority', value: 'P1' })).toBe('Set the priority to P1 · Critical');
    expect(graph.describeNode({ key: 's', type: 'changeStatus', status: 'closed' })).toBe('Move the ticket to Closed');
    expect(graph.describeNode({ key: 'c', type: 'condition', when: { eq: [{ var: 'ticket.status' }, 'resolved'] } })).toBe('Check: Status is Resolved');
    expect(graph.nodeTitle({ key: 'raw-key', type: 'notify', to: 'assignee' })).toBe('Notify the assignee');
    expect(graph.durationWords('P5D')).toBe('5 days');
    expect(graph.triggerWords(LOOP.trigger)).toBe('When the status changes, if a condition holds');
    expect(graph.triggerWords({ kind: 'manual' })).toBe('Started by hand');
  });

  it('draws a loop up the side, a skipped layer round it, and joins two edges between the same steps', () => {
    const drawn = graph.layout(FULFIL);
    const at = (key: string) => drawn.nodes.find((node) => node.key === key)!;
    expect(at('approve').layer).toBe(0);
    expect(at('do-the-work').layer).toBe(1);
    expect(at('tell-requester').layer).toBe(2);
    expect(at('done').layer).toBe(3);
    const joined = drawn.edges.filter((edge) => edge.from === 'approve' && edge.to === 'do-the-work');
    expect(joined).toHaveLength(1);
    expect(joined[0]!.label).toBe('approved or no policy applies');
    const skip = drawn.edges.find((edge) => edge.from === 'approve' && edge.to === 'tell-requester')!;
    expect(skip.labelAnchor).not.toBe('middle');

    const looped = graph.layout(LOOP);
    expect(looped.edges.find((edge) => edge.from === 'check' && edge.to === 'settle')?.back).toBe(true);
    // Nothing reaches it, so it sits in a layer of its own at the end.
    expect(looped.nodes.find((node) => node.key === 'orphan')!.layer).toBe(2);
    expect(graph.steps(LOOP).find((step) => step.key === 'orphan')?.reachable).toBe(false);
  });
});

describe('runs, in words', () => {
  it('offers retry and skip on a failed step only, abandon on failed or waiting, nothing otherwise (F25)', () => {
    expect(wf.runActions({ status: 'failed', currentKeys: ['a'] }, true)).toEqual(['retry', 'skip', 'abandon']);
    expect(wf.runActions({ status: 'failed', currentKeys: [] }, true)).toEqual(['abandon']);
    expect(wf.runActions({ status: 'waiting', currentKeys: ['a'] }, true)).toEqual(['abandon']);
    for (const status of ['queued', 'running', 'completed', 'cancelled']) expect(wf.runActions({ status, currentKeys: ['a'] }, true)).toEqual([]);
    expect(wf.runActions({ status: 'failed', currentKeys: ['a'] }, false)).toEqual([]);
    expect(wf.isRetryable({ status: 'failed', currentKeys: ['a'] })).toBe(true);
    expect(wf.isRetryable({ status: 'waiting', currentKeys: ['a'] })).toBe(false);
  });

  it('names what a waiting run waits on, and the first line of an error', () => {
    expect(wf.runLook({ status: 'waiting', stepTitle: 'Manager approval' }).label).toBe('Waiting · Manager approval');
    expect(wf.runLook({ status: 'queued', stepTitle: null }).label).toBe('Queued');
    expect(wf.stepOrError({ status: 'failed', stepTitle: 'X', error: 'Timed out\nat stack' })).toBe('Timed out');
    expect(wf.stepOrError({ status: 'failed', stepTitle: 'X', error: null })).toBe('Failed at X');
    expect(wf.stepOrError({ status: 'cancelled', stepTitle: null, error: 'Raised twice' })).toBe('Abandoned: Raised twice');
    expect(wf.stepOrError({ status: 'completed', stepTitle: null, error: null })).toBe('Finished');
  });

  it('says why a run started, how long it took, and how the last runs went', () => {
    expect(wf.triggeredByWords('rule:vip-requester', { 'vip-requester': 'Flag a VIP' })).toBe('Started by the rule “Flag a VIP”');
    expect(wf.triggeredByWords('event:0190')).toBe('Started by an event on the ticket');
    expect(wf.triggeredByWords(null)).toBe('Started by hand');
    expect(wf.durationText({ startedAt: '2026-09-30T07:00:00Z', endedAt: '2026-09-30T07:00:40Z' }, null, 'en-GB')).toBe('Under a minute');
    // A run still going has no duration until the page knows the time.
    expect(wf.durationText({ startedAt: '2026-09-30T07:00:00Z', endedAt: null }, null, 'en-GB')).toBe('');
    expect(wf.durationText({ startedAt: '2026-09-30T07:00:00Z', endedAt: null }, Date.parse('2026-09-30T09:05:00Z'), 'en-GB')).toMatch(/2\s*h/);
    const mix = wf.runMix([{ status: 'completed' }, { status: 'failed' }, { status: 'waiting' }, { status: 'failed' }]);
    expect(mix).toEqual({ completed: 1, active: 1, failed: 2, cancelled: 0, total: 4 });
    expect(wf.mixWords(mix)).toBe('2 failed');
    expect(wf.mixWords(wf.runMix([]))).toBe('No runs yet');
    expect(wf.mixWords(wf.runMix([{ status: 'completed' }]))).toBe('All completed');
  });

  it('reads a workflow’s state and a run from the API', () => {
    expect(wf.workflowLook({ status: 'published', liveVersion: 3, hasDraft: false }).label).toBe('Live · v3');
    expect(wf.workflowLook({ status: 'published', liveVersion: 3, hasDraft: true }).label).toBe('Unpublished changes');
    expect(wf.workflowLook({ status: 'draft', liveVersion: null, hasDraft: true }).label).toBe('Draft');
    expect(wf.workflowScope('draft')).toBe('draft');
    expect(wf.inWorkflowScope({ status: 'published', liveVersion: 1, hasDraft: true }, 'draft')).toBe(true);
    const view = wf.runFrom(
      { id: 'r9', definitionId: 'w1', status: 'waiting', currentKeys: ['approve'], ticketId: null, startedAt: '2026-09-30T07:00:00Z', endedAt: null },
      { w1: { key: 'request-fulfilment', name: 'Fulfil an approved request' } },
      { 'request-fulfilment': FULFIL },
    );
    expect(view).toMatchObject({ workflowName: 'Fulfil an approved request', stepTitle: 'Ask for approval', startedAt: '2026-09-30T07:00:00.000Z' });
    expect(wf.stepRuns([{ stepKey: 'approve', attempt: 2, status: 'failed', error: 'x', startedAt: 'a', endedAt: null }, { nope: true }])).toHaveLength(1);
  });
});

/* ======================================================================= */

function table(props: Partial<Parameters<typeof RunsTable>[0]> = {}): ReactElement {
  return (
    <Frame>
      <RunsTable
        runs={[RUN]}
        caption="Workflow runs"
        urlKey=""
        graphs={{ 'request-fulfilment': FULFIL }}
        workflows={{ w1: { key: 'request-fulfilment', name: 'Fulfil an approved request' } }}
        ruleNames={{ 'vip-requester': 'Flag a VIP' }}
        canOperate
        canReadTickets
        workbenchOrigin="https://desk.test"
        empty={{ title: 'No runs yet' }}
        {...props}
      />
    </Frame>
  );
}

describe('the runs table', () => {
  it('names a run’s ticket by its number when the page could look it up, and says “Open” when it could not', async () => {
    render(table({ runs: [RUN, { ...RUN, id: 'r2', ticketId: 't-older' }], ticketNumbers: { [RUN.ticketId!]: 'INC-000005' } }));
    await settle();
    const known = [...document.querySelectorAll<HTMLAnchorElement>('a')].find((a) => a.textContent === 'INC-000005')!;
    expect(known.getAttribute('href')).toBe('https://desk.test/tickets/INC-000005');
    expect(known.getAttribute('aria-label')).toBe('Open INC-000005 in the workbench');
    expect([...document.querySelectorAll('a')].some((a) => a.textContent === 'Open')).toBe(true);
    cleanupDocument();
    render(table({ workbenchOrigin: undefined, ticketNumbers: { [RUN.ticketId!]: 'INC-000005' } }));
    await settle();
    const local = [...document.querySelectorAll<HTMLAnchorElement>('a')].find((a) => a.textContent === 'INC-000005')!;
    expect(local.getAttribute('href')).toBe('/tickets?open=ticket:INC-000005');
  });
});

describe('a run’s drawer', () => {
  it('offers Retry step, Skip step and Abandon on a failed run, and retries the step', async () => {
    run.mockResolvedValue({ id: 'r1', definitionId: 'w1', status: 'failed', currentKeys: ['do-the-work'], ticketId: 't-1', error: 'The integration did not answer', startedAt: RUN.startedAt, endedAt: null, triggeredBy: 'rule:vip-requester', steps: [{ stepKey: 'approve', attempt: 1, status: 'done', startedAt: RUN.startedAt, endedAt: RUN.startedAt }, { stepKey: 'do-the-work', attempt: 1, status: 'failed', error: 'The integration did not answer', startedAt: RUN.startedAt, endedAt: null }] });
    search = 'open=run:r1';
    window.history.replaceState(null, '', '/workflows/runs?open=run:r1');
    render(table());
    await settle();
    await settle();
    const drawer = dialogWith('A workflow run')!;
    expect(text(drawer)).toContain('INC-000005 · VPN keeps dropping');
    expect(text(drawer)).toContain('Started by the rule “Flag a VIP”');
    expect(text(drawer)).toContain('Raise the fulfilment task');
    expect(buttonNamed(drawer, 'Skip step…')).toBeDefined();
    expect(buttonNamed(drawer, 'Abandon run…')).toBeDefined();
    await clickAsync(buttonNamed(drawer, 'Retry step')!);
    expect(retry).toHaveBeenCalledWith('r1');
  });

  it('offers only Abandon on a waiting run, and asks why first', async () => {
    run.mockResolvedValue({ id: 'r1', definitionId: 'w1', status: 'waiting', currentKeys: ['approve'], ticketId: null, error: null, startedAt: RUN.startedAt, endedAt: null, triggeredBy: 'manual', steps: [] });
    search = 'open=run:r1';
    window.history.replaceState(null, '', '/workflows/runs?open=run:r1');
    render(table({ runs: [{ ...RUN, status: 'waiting', currentKeys: ['approve'], stepTitle: 'Ask for approval', error: null }] }));
    await settle();
    await settle();
    const drawer = dialogWith('A workflow run')!;
    expect(text(drawer)).toContain('Waiting on “Ask for approval”');
    expect(buttonNamed(drawer, 'Retry step')).toBeUndefined();
    expect(buttonNamed(drawer, 'Skip step…')).toBeUndefined();
    click(buttonNamed(drawer, 'Abandon run…')!);
    const confirm = dialogWith('Abandon this run?')!;
    type(confirm.querySelector('textarea') as HTMLTextAreaElement, 'Raised twice');
    await clickAsync(buttonNamed(confirm, 'Abandon run')!);
    expect(cancel).toHaveBeenCalledWith('r1', 'Raised twice');
  });

  it('offers nothing to someone who may not operate runs, and nothing on a finished run', async () => {
    run.mockResolvedValue({ id: 'r1', definitionId: 'w1', status: 'failed', currentKeys: ['do-the-work'], ticketId: null, error: 'x', startedAt: RUN.startedAt, endedAt: null, triggeredBy: null, steps: [] });
    search = 'open=run:r1';
    window.history.replaceState(null, '', '/workflows/runs?open=run:r1');
    render(table({ canOperate: false }));
    await settle();
    await settle();
    const drawer = dialogWith('A workflow run')!;
    for (const name of ['Retry step', 'Skip step…', 'Abandon run…']) expect(buttonNamed(drawer, name)).toBeUndefined();
  });

  it('says so when the run no longer exists', async () => {
    const { ApiError } = await import('@itsm/sdk');
    run.mockRejectedValue(new ApiError(404, null, 'not found'));
    search = 'open=run:gone';
    window.history.replaceState(null, '', '/workflows/runs?open=run:gone');
    render(table({ runs: [] }));
    await settle();
    await settle();
    expect(text(document.body)).toContain('That run no longer exists');
  });
});

describe('bulk retry', () => {
  it('retries the failed runs that name their step, one at a time, and says what it left alone', async () => {
    render(
      table({
        runs: [RUN, { ...RUN, id: 'r2', currentKeys: [], stepTitle: null }],
        selectable: true,
      }),
    );
    const selectAll = document.querySelector('thead input[type="checkbox"]') as HTMLInputElement;
    click(selectAll);
    click(buttonNamed(document, 'Retry')!);
    const confirm = dialogWith('Retry the selected runs?')!;
    await clickAsync(buttonNamed(confirm, 'Retry runs')!);
    await settle();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledWith('r1');
  });

  it('has no selection outside the failed runs, nor for someone who may not operate', () => {
    render(table({ selectable: false }));
    expect(document.querySelector('thead input[type="checkbox"]')).toBeNull();
    cleanupDocument();
    render(table({ selectable: true, canOperate: false }));
    expect(document.querySelector('thead input[type="checkbox"]')).toBeNull();
  });
});

describe('a workflow’s page', () => {
  const workflow = { id: 'w1', key: 'request-fulfilment', name: 'Fulfil an approved request', description: null, status: 'published', updatedAt: '2026-09-30T07:00:00Z', liveVersion: 1, hasDraft: true, trigger: 'Started by a rule' };
  const versions = [
    { version: 2, status: 'draft', changeNote: null, publishedAt: null, isCurrent: false },
    { version: 1, status: 'published', changeNote: 'Shipped with the platform', publishedAt: '2026-09-29T07:00:00Z', isCurrent: true },
  ];
  const detail = (check: Parameters<typeof WorkflowDetail>[0]['check'], extra: Partial<Parameters<typeof WorkflowDetail>[0]> = {}): ReactElement => (
    <Frame>
      <WorkflowDetail
        workflow={workflow}
        graph={FULFIL}
        versions={[...versions]}
        check={check}
        runs={[]}
        graphs={{ 'request-fulfilment': FULFIL }}
        workflows={{ w1: { key: 'request-fulfilment', name: 'Fulfil an approved request' } }}
        ruleNames={{}}
        canPublish
        canOperate
        canReadTickets
        breadcrumbs={[{ label: 'Workflows', href: '/workflows' }]}
        initialTab="history"
        {...extra}
      />
    </Frame>
  );

  it('keeps Publish unavailable, saying why, until the check is clean', () => {
    render(detail({ ok: true, value: { version: 2, problems: [{ message: 'give-up is never reached', where: 'give-up' }] } }));
    const publishButton = buttonNamed(document, 'Publish v2')!;
    expect(publishButton.getAttribute('aria-disabled')).toBe('true');
    expect(text(document.body)).toContain('One problem in version 2, the draft');
    expect(text(document.body)).toContain('Show “Nobody approved in time”');
  });

  it('publishes a clean draft after saying runs in progress stay on their version, and makes an old version current', async () => {
    render(detail({ ok: true, value: { version: 2, problems: [] } }));
    expect(text(document.body)).toContain('No problems in version 2, the draft');
    click(buttonNamed(document, 'Publish v2')!);
    const confirm = dialogWith('Publish version 2?')!;
    expect(text(confirm)).toContain('Runs already in progress stay on the version they started on.');
    await clickAsync(buttonNamed(confirm, 'Publish v2')!);
    expect(publish).toHaveBeenCalledTimes(1);

    // History: only a published version that is not current can be made current.
    expect(buttonNamed(document, 'Make current')).toBeUndefined();
  });

  it('offers Make current on an earlier published version, never a version number to type', async () => {
    render(
      detail(
        { ok: true, value: { version: 3, problems: [] } },
        {
          versions: [
            { version: 3, status: 'published', changeNote: null, publishedAt: '2026-09-30T07:00:00Z', isCurrent: true },
            { version: 2, status: 'published', changeNote: 'Faster approvals', publishedAt: '2026-09-29T07:00:00Z', isCurrent: false },
          ],
          workflow: { ...workflow, liveVersion: 3, hasDraft: false },
        },
      ),
    );
    expect(buttonNamed(document, 'Publish v3')).toBeUndefined();
    click(document.querySelector('button[aria-label="Make version 2 current"]')!);
    const confirm = dialogWith('Make version 2 current?')!;
    expect(text(confirm)).toContain('Runs in progress stay on their version.');
    await clickAsync(buttonNamed(confirm, 'Make current')!);
    expect(rollback).toHaveBeenCalledWith('request-fulfilment', 2);
  });

  it('shows the steps as a list, selectable, with problems marked', () => {
    let chosen = '';
    render(
      <Frame>
        <StepsOutline graph={FULFIL} problems={new Set(['give-up'])} onSelect={(key) => (chosen = key)} />
      </Frame>,
    );
    const items = [...document.querySelectorAll('.app-Steps__step')];
    expect(items).toHaveLength(5);
    expect(text(items[3])).toContain('Problem');
    click(buttonNamed(document, 'Tell the requester')!);
    expect(chosen).toBe('tell-requester');
  });
});

describe('the pages’ stylesheets', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const defined = new Set([...Object.keys(structuralVariables()), ...Object.keys(themeVariables('apple'))]);
  const sheets = ['rules/rules.css', 'workflows/workflows.css'].map((path) => ({ path, css: readFileSync(join(here, '..', 'components', path), 'utf8') }));

  it('spends only custom properties the design system emits', () => {
    for (const { path, css } of sheets) {
      const used = [...new Set([...css.matchAll(/var\((--itsm-[a-zA-Z0-9-]+)/g)].map((match) => match[1]!))];
      expect(used.length, path).toBeGreaterThan(3);
      expect(used.filter((variable) => !defined.has(variable)), path).toEqual([]);
    }
  });

  it('declares only app- classes', () => {
    for (const { path, css } of sheets) {
      for (const line of css.split('\n').filter((entry) => /^\.[a-zA-Z]/.test(entry.trim()))) {
        expect(line.trim().startsWith('.app-'), `${path}: ${line}`).toBe(true);
      }
    }
  });
});
