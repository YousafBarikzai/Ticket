// @vitest-environment jsdom
import { act, forwardRef, useState, type AnchorHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type RuleRow } from '@itsm/sdk';
import { buildAreaModel, CROSS_AREA_DEMO_TEAM_NOTE, type AreaModel } from '@itsm/contracts/areas';

vi.mock('server-only', () => ({}));

let search = '';
const router = { refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), forward: vi.fn() };
vi.mock('next/navigation', () => ({
  usePathname: () => '/rules',
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(search),
}));

const create = vi.fn();
const update = vi.fn();
const publish = vi.fn();
const archive = vi.fn();
const dryRun = vi.fn();
const test = vi.fn();
const rollback = vi.fn();
vi.mock('../client/api.js', () => ({
  api: { configure: { rules: { create, update, publish, archive, dryRun, test, rollback } } },
}));

const { ItsmProvider } = await import('@itsm/ui');
const { RuleBuilder, headerActions } = await import('../components/rules/RuleBuilder.js');
const { RulesView } = await import('../components/rules/RulesView.js');
const { ActionsEditor } = await import('../components/rules/ActionsEditor.js');
const presentation = await import('../components/rules/presentation.js');
const draftModule = await import('../components/rules/draft.js');
const events = await import('../rules/events.js');
const { cleanupDocument, click, clickAsync, render, type } = await import('./support/render.js');

/**
 * Rules (SPEC §6.1; F28, R1, X-42): what a rule reads as, what the builder
 * sends — the unsaved canvas to the dry run, never the key in a patch, a
 * custom action exactly as stored — and the buttons a person sees on a live
 * rule, which is where R1 bites: editing takes it offline.
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
      usePathname={() => '/rules'}
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
});

const text = (element: Element | null | undefined): string => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const buttonNamed = (root: ParentNode, name: string): HTMLButtonElement | undefined =>
  [...root.querySelectorAll('button')].find((button) => text(button) === name) as HTMLButtonElement | undefined;
const dialogWith = (words: string): Element | undefined =>
  [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].find((element) => text(element).includes(words));

const NOW = '2026-09-30T09:00:00.000Z';

type View = Parameters<typeof presentation.ruleState>[0] & import('../components/rules/types.js').RuleView;

function rule(overrides: Partial<View> = {}): View {
  return {
    id: '0190aaaa-0000-7000-8000-000000000001',
    key: 'vip-requester',
    name: 'Flag a ticket raised by a VIP',
    description: 'Tags the ticket.',
    event: 'ticket.created',
    conditions: { eq: [{ var: 'requester.vip' }, true] },
    actions: [{ type: 'addTag', tag: 'vip' }],
    order: 20,
    mode: 'continue',
    status: 'published',
    version: 2,
    publishedAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const row = (view: View): RuleRow => ({ ...view, actions: [...view.actions], orgId: null, createdAt: NOW }) as RuleRow;

const names = { teams: { 'team-1': 'Service desk' }, workflows: { joiner: { name: 'Set up a joiner', live: true } } };

/** The areas fixtures (A2 §3.3): someone who works tickets in the Service Desk, and Jordan Lee in the demo. */
const ORIGINS = { portal: 'https://help.test', workbench: 'https://desk.test', admin: 'https://admin.test' };
const deskAreas: AreaModel = buildAreaModel({ app: 'admin', held: ['ticket.update', 'rules.rule.manage'], session: { kind: 'oidc' }, origins: ORIGINS });
const demoAreas: AreaModel = buildAreaModel({ app: 'admin', held: [], session: { kind: 'demo', persona: 'admin' }, origins: ORIGINS, agentTeamIds: ['team-1'] });

function builder(props: Partial<Parameters<typeof RuleBuilder>[0]> = {}): ReactElement {
  return (
    <Frame>
      <RuleBuilder
        rule={rule()}
        versions={[]}
        siblings={[rule(), rule({ key: 'major-incident-p1', name: 'Treat an outage as P1', order: 10 })]}
        facts={[]}
        events={[]}
        names={names}
        workflows={[{ value: 'joiner', label: 'Set up a joiner' }]}
        teams={[{ value: 'team-1', label: 'Service desk' }]}
        canManage
        canPublish
        sampleSize={null}
        breadcrumbs={[{ label: 'Rules', href: '/rules' }]}
        areas={deskAreas}
        {...props}
      />
    </Frame>
  );
}

/* ======================================================================= */

describe('a rule in words', () => {
  it('reads conditions as chips, with every time and custom said plainly', () => {
    expect(presentation.conditionSummary({ always: true })).toEqual({ kind: 'every' });
    expect(presentation.conditionSummary({ not: { eq: [{ var: 'ticket.priority' }, 'P1'] } })).toEqual({ kind: 'custom' });
    expect(presentation.conditionSummary({ and: [{ eq: [{ var: 'ticket.impact' }, 'high'] }, { eq: [{ var: 'ticket.urgency' }, 'high'] }] })).toEqual({
      kind: 'rows',
      join: 'and',
      chips: ['Impact is High', 'Urgency is High'],
    });
    expect(presentation.conditionChip({ fact: 'requester.vip', operator: 'eq', value: 'true' })).toBe('Requester is a VIP');
    expect(presentation.conditionChip({ fact: 'ticket.hasAssignee', operator: 'eq', value: 'false' })).toBe('Has an assignee: no');
    expect(presentation.conditionChip({ fact: 'ticket.assigneeId', operator: 'exists', value: '' })).toBe('Assignee is set');
    // An id never prints: a team by its name, anything else as what it is.
    expect(presentation.conditionChip({ fact: 'ticket.groupId', operator: 'eq', value: 'team-1' }, names)).toBe('Team is Service desk');
    expect(presentation.conditionChip({ fact: 'ticket.serviceId', operator: 'eq', value: '0190' })).toBe('Service is a specific service');
    expect(presentation.conditionChip({ fact: 'ticket.ageMinutes', operator: 'gt', value: '30' })).toBe('Age is greater than 30 minutes');
  });

  it('reads actions as chips, naming workflows and teams, and marks the ones it does not draw', () => {
    expect(presentation.actionChip({ type: 'setPriority', priority: 'P1', reason: '' }).label).toBe('Set priority → P1 · Critical');
    expect(presentation.actionChip({ type: 'setStatus', status: 'in_progress' }).label).toBe('Set status → In progress');
    expect(presentation.actionChip({ type: 'sendNotification', template: 'x', to: 'group' }).label).toBe('Notify the team');
    expect(presentation.actionChip({ type: 'startWorkflow', definitionKey: 'joiner' }, names).label).toBe('Start “Set up a joiner”');
    expect(presentation.actionChip({ type: 'assignGroup', groupId: 'team-1' }, names).label).toBe('Assign to Service desk');
    expect(presentation.actionChip({ type: 'assignGroup', groupId: 'gone' }, names).label).toBe('Assign to a team');
    expect(presentation.actionChip({ type: 'setField', field: 'urgency', value: 'low' }).label).toBe('Set urgency → Low');
    expect(presentation.actionChip({ type: 'setField', field: 'categoryId', value: 'x' })).toMatchObject({ custom: true });
    expect(presentation.actionChip({ type: 'addWatcher', userId: 'x' })).toMatchObject({ custom: true });
  });

  it('says Unpublished changes for a live rule taken offline by an edit (R1), and scopes the list the Command centre’s way', () => {
    expect(presentation.ruleState({ status: 'published', publishedAt: NOW })).toBe('live');
    expect(presentation.ruleState({ status: 'draft', publishedAt: null })).toBe('draft');
    expect(presentation.ruleState({ status: 'draft', publishedAt: NOW })).toBe('changes');
    expect(presentation.ruleState({ status: 'archived', publishedAt: NOW })).toBe('archived');
    expect(presentation.RULE_STATES.changes.label).toBe('Unpublished changes');
    expect(presentation.scopeFrom('draft')).toBe('draft');
    expect(presentation.scopeFrom('published')).toBe('live');
    expect(presentation.scopeFrom('nonsense')).toBe('all');
    expect(presentation.inScope({ status: 'draft', publishedAt: NOW }, 'draft')).toBe(true);
    expect(presentation.headerMeta([rule(), rule({ status: 'draft' }), rule({ status: 'draft', publishedAt: null })])).toBe('1 live · 2 drafts');
  });

  it('names the events in words, and says which do not run yet', () => {
    expect(events.eventInfo('ticket.comment.added').label).toBe('Someone comments');
    expect(events.eventInfo('ticket.created').heading).toBe('When a ticket is created');
    expect(events.eventInfo('something.new').label).toBe('something.new');
    expect(events.eventsFrom(['schedule.tick', 'ticket.created']).map((event) => event.value)).toEqual(['ticket.created', 'schedule.tick']);
    expect(presentation.groupHeading('ticket.created')).toBe('When a ticket is created · run in this order');
    expect(presentation.groupHeading('request.submitted')).toBe('When a request is submitted · not evaluated yet');
    expect(events.factAppliesTo('comment.visibility', 'ticket.created')).toBe(false);
    expect(events.factAppliesTo('comment.visibility', 'ticket.comment.added')).toBe(true);
  });

  it('places a rule among its event’s rules without renumbering the others', () => {
    const rules = [
      { key: 'a', name: 'A', event: 'ticket.created', order: 10, status: 'published' },
      { key: 'b', name: 'B', event: 'ticket.created', order: 20, status: 'published' },
      { key: 'c', name: 'C', event: 'ticket.created', order: 21, status: 'draft' },
      { key: 'old', name: 'Old', event: 'ticket.created', order: 5, status: 'archived' },
      { key: 'x', name: 'X', event: 'ticket.updated', order: 1, status: 'published' },
    ];
    const middle = presentation.placement(rules, 'ticket.created', 'b', 20, 'B');
    expect(middle).toMatchObject({ position: 2, total: 3, earlier: 0, later: 31 });
    expect(middle.before?.key).toBe('a');
    expect(middle.after?.key).toBe('c');
    expect(presentation.placementSentence(middle)).toBe('Runs 2nd of 3 for this event — after “A”, before “C”.');
    // Between 10 and 20 there is room: 15.
    expect(presentation.placement(rules, 'ticket.created', 'c', 21, 'C').earlier).toBe(15);
    const first = presentation.placement(rules, 'ticket.created', 'a', 10, 'A');
    expect(first).toMatchObject({ position: 1, earlier: null });
    expect(presentation.placement(rules, 'ticket.created', null, 20, 'New').tie?.key).toBe('b');
    expect(presentation.placementSentence(presentation.placement(rules, 'ticket.updated', 'x', 1, 'X'))).toBe('The only rule for this event.');
    expect(presentation.lastOrder(rules, 'ticket.created')).toBe(31);
    expect(presentation.lastOrder(rules, 'schedule.tick')).toBe(100);
    expect(presentation.positions(rules).get('old')).toBeUndefined();
    expect(presentation.ordinal(11)).toBe('11th');
    expect(presentation.ordinal(22)).toBe('22nd');
  });

  it('reads a dry run: effects as chips, a zero result neutrally, errors where they belong', () => {
    expect(
      presentation.effectChips(
        { patch: { priority: 'P1', groupId: 'team-1' }, status: { status: 'resolved' }, tags: ['vip'], watchers: [], notifications: [{ to: 'assignee' }], links: [], workflows: [{ definitionKey: 'joiner' }] },
        names,
      ),
    ).toEqual(['Priority → P1 · Critical', 'Team → Service desk', 'Status → Resolved', 'Tag “vip”', 'Notify the assignee', 'Start “Set up a joiner”']);
    expect(presentation.effectChips([{ type: 'addTag', tag: 'vip' }])).toEqual(['Add tag “vip”']);
    expect(presentation.testSummary({ sampled: 100, wouldChange: [] })).toBe('Wouldn’t change any of the last 100 tickets.');
    expect(presentation.testSummary({ sampled: 100, wouldChange: [1, 2, 3, 4, 5, 6, 7] })).toBe('Would change 7 of the last 100 tickets.');
    expect(presentation.errorTarget('definition.actions.2.tag')).toEqual({ kind: 'action', index: 2 });
    expect(presentation.errorTarget('conditions.ticket.nope')).toEqual({ kind: 'conditions' });
    expect(presentation.errorTarget('key')).toEqual({ kind: 'field', field: 'key' });
    expect(presentation.lastFiredByKey([
      { after: { ruleKey: 'a' }, occurredAt: '2026-09-30T08:00:00Z' },
      { after: { ruleKey: 'a' }, occurredAt: '2026-09-29T08:00:00Z' },
      { after: null, occurredAt: '2026-09-28T08:00:00Z' },
    ])).toEqual({ a: '2026-09-30T08:00:00Z' });
  });
});

describe('what the builder sends', () => {
  it('keeps an action it cannot draw exactly as stored, and a team action as custom when teams cannot be named', () => {
    const stored = rule({ actions: [{ type: 'setCategory', categoryId: 'c-1' }, { type: 'assignGroup', groupId: 'team-1' }, { type: 'addTag', tag: 'vip' }] });
    const withTeams = draftModule.draftFrom(stored, { teams: true });
    expect(withTeams.actions.map((item) => draftModule.isCustom(item))).toEqual([true, false, false]);
    const withoutTeams = draftModule.draftFrom(stored, { teams: false });
    expect(withoutTeams.actions.map((item) => draftModule.isCustom(item))).toEqual([true, true, false]);
    expect(draftModule.actionsOf(withoutTeams)).toEqual(stored.actions);
    // Ids from the position, so the server's render and the browser's agree.
    expect(withTeams.actions.map((item) => item.id)).toEqual(['stored-0', 'stored-1', 'stored-2']);
  });

  it('creates with the key, patches without it, and clears an emptied description', () => {
    const draft = { ...draftModule.draftFrom(rule(), { teams: true }), description: '  ' };
    expect(draftModule.createPayload(draft)).not.toHaveProperty('description');
    expect(draftModule.createPayload(draft)).toMatchObject({ key: 'vip-requester', name: 'Flag a ticket raised by a VIP', order: 20, mode: 'continue' });
    const patch = draftModule.patchPayload(draft);
    expect(patch).not.toHaveProperty('key');
    expect(patch.description).toBe('');
  });

  it('dry-runs the canvas without a key or name it could not save', () => {
    const draft = { ...draftModule.emptyDraft(100), key: 'Not A Key', name: '' };
    const definition = draftModule.definitionOf(draft);
    expect(definition).not.toHaveProperty('key');
    expect(definition).not.toHaveProperty('name');
    expect(definition).toMatchObject({ event: 'ticket.created', conditions: { always: true }, actions: [], order: 100, mode: 'continue' });
  });

  it('checks what the API would refuse before anything is sent', () => {
    const empty = draftModule.checkDraft(draftModule.emptyDraft(100), { keyState: 'empty', isNew: true }).map((issue) => issue.message);
    expect(empty).toEqual(['Give the rule a name.', 'Add at least one action — a rule with none does nothing.']);
    const taken = draftModule.checkDraft({ ...draftModule.emptyDraft(100), name: 'VIP' }, { keyState: 'taken', isNew: true });
    expect(taken[0]!.message).toContain('Another rule already uses this key');
    const badAction = draftModule.checkDraft(
      { ...draftModule.draftFrom(rule(), { teams: true }), actions: [{ id: 'x', draft: { type: 'setStatus', value: '', reason: '', to: '' } }] },
      { keyState: 'ok', isNew: false },
    );
    expect(badAction).toEqual([{ target: { action: 'x' }, message: 'Choose the status to set.' }]);
    const noValue = draftModule.checkDraft(
      { ...draftModule.draftFrom(rule(), { teams: true }), conditions: { eq: [{ var: 'ticket.title' }, ''] } },
      { keyState: 'ok', isNew: false },
    );
    expect(noValue[0]!.message).toBe('Condition 1 (Title) needs a value.');
  });
});

describe('the buttons a person sees (R1)', () => {
  const base = { isNew: false, dirty: true, canManage: true, canPublish: true, online: true, key: 'vip-requester' } as const;

  it('offers a publisher “Publish changes” for an edited live rule, with saving a draft second', () => {
    const actions = headerActions({ ...base, state: 'live' });
    expect(actions.primary?.label).toBe('Publish changes');
    expect(actions.secondary.map((action) => action.label)).toEqual(['Save as draft', 'Discard changes']);
    expect(actions.overflow.map((action) => action.id)).toEqual(['duplicate', 'archive']);
  });

  it('offers someone who may only manage “Save as draft”, and never Publish', () => {
    const actions = headerActions({ ...base, state: 'live', canPublish: false });
    expect(actions.primary?.label).toBe('Save as draft');
    expect([actions.primary, ...actions.secondary].some((action) => action?.id === 'publish')).toBe(false);
  });

  it('offers nothing to save on a clean live rule, Publish to a publisher on a draft, Restore on an archived one', () => {
    expect(headerActions({ ...base, state: 'live', dirty: false }).primary).toBeNull();
    expect(headerActions({ ...base, state: 'draft', dirty: false, canManage: false }).primary?.label).toBe('Publish');
    expect(headerActions({ ...base, state: 'changes', dirty: false }).primary?.label).toBe('Publish changes');
    expect(headerActions({ ...base, state: 'archived', dirty: false }).primary?.id).toBe('restore');
    expect(headerActions({ ...base, isNew: true, state: null, canPublish: false }).primary?.label).toBe('Save draft');
    expect(headerActions({ ...base, state: 'live', online: false }).primary?.disabledReason).toContain('offline');
  });
});

describe('the builder', () => {
  it('warns someone who may only manage that saving takes a live rule offline, and asks before it does', async () => {
    update.mockResolvedValue(row(rule({ status: 'draft', actions: [{ type: 'addTag', tag: 'vip-plus' }] })));
    render(builder({ canPublish: false }));
    expect(text(document.body)).toContain('Saving takes this rule offline until someone with publish permission publishes it.');
    expect(buttonNamed(document, 'Publish')).toBeUndefined();

    type(document.querySelector('[data-row="stored-0"] input') as HTMLInputElement, 'vip-plus');
    click(buttonNamed(document, 'Save as draft')!);
    const confirm = dialogWith('Take this rule offline?')!;
    expect(text(confirm)).toContain('Until then it won’t act on any ticket.');
    await clickAsync(buttonNamed(confirm, 'Save as draft')!);
    expect(update).toHaveBeenCalledWith('vip-requester', expect.not.objectContaining({ key: expect.anything() }));
    expect(update.mock.calls[0]![1]).toMatchObject({ actions: [{ type: 'addTag', tag: 'vip-plus' }] });
    expect(publish).not.toHaveBeenCalled();
  });

  it('saves then publishes when a publisher publishes changes, telling them the last test', async () => {
    update.mockResolvedValue(row(rule({ status: 'draft' })));
    publish.mockResolvedValue(row(rule({ version: 3 })));
    render(builder());
    type(document.querySelector('[data-row="stored-0"] input') as HTMLInputElement, 'vip-2');
    click(buttonNamed(document, 'Publish changes')!);
    const confirm = dialogWith('Publish the changes to')!;
    expect(text(confirm)).toContain('It hasn’t been tried on recent tickets.');
    expect(text(confirm)).toContain('as version 3');
    await clickAsync(buttonNamed(confirm, 'Publish changes')!);
    expect(update).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith('vip-requester');
    expect(update.mock.invocationCallOrder[0]!).toBeLessThan(publish.mock.invocationCallOrder[0]!);
  });

  it('tries the unsaved canvas on recent tickets without saving it', async () => {
    dryRun.mockResolvedValue({
      sampled: 100,
      wouldChange: [{ ticketId: 't1', number: 'INC-000042', title: 'VPN down', matched: ['vip-requester'], effects: { patch: {}, tags: ['vip-2'], watchers: [], notifications: [], links: [], workflows: [] } }],
      errors: [],
    });
    render(builder());
    type(document.querySelector('[data-row="stored-0"] input') as HTMLInputElement, 'vip-2');
    await clickAsync(buttonNamed(document, 'Run test')!);
    expect(dryRun).toHaveBeenCalledTimes(1);
    expect(dryRun.mock.calls[0]![0]).toMatchObject({ key: 'vip-requester', event: 'ticket.created', actions: [{ type: 'addTag', tag: 'vip-2' }] });
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    const panel = document.querySelector('.app-TryIt')!;
    expect(text(panel)).toContain('Would change 1 of the last 100 tickets.');
    expect(panel.querySelector('a')?.getAttribute('href')).toBe('https://desk.test/tickets/INC-000042');
    expect(text(panel)).toContain('Tag “vip-2”');

    expect(text(panel)).not.toContain(CROSS_AREA_DEMO_TEAM_NOTE);

    // Changing the canvas makes the answer stale rather than passing it off as current.
    type(document.querySelector('[data-row="stored-0"] input') as HTMLInputElement, 'vip-3');
    expect(text(panel)).toContain('The rule has changed since this test.');
  });

  it('in the demo, leaves the tried tickets’ numbers as text and says why once (X-B2)', async () => {
    dryRun.mockResolvedValue({
      sampled: 100,
      wouldChange: [
        { ticketId: 't1', number: 'INC-000042', title: 'VPN down', matched: ['vip-requester'], effects: { patch: {}, tags: ['vip'], watchers: [], notifications: [], links: [], workflows: [] } },
        { ticketId: 't2', number: 'INC-000043', title: 'Laptop slow', matched: ['vip-requester'], effects: { patch: {}, tags: ['vip'], watchers: [], notifications: [], links: [], workflows: [] } },
      ],
      errors: [],
    });
    render(builder({ areas: demoAreas }));
    await clickAsync(buttonNamed(document, 'Run test')!);
    const panel = document.querySelector('.app-TryIt')!;
    expect(text(panel)).toContain('INC-000042');
    expect(panel.querySelector('ol a')).toBeNull();
    expect(text(panel).split(CROSS_AREA_DEMO_TEAM_NOTE)).toHaveLength(2);
  });

  it('without the Service Desk, leaves the tried tickets’ numbers as text, with no demo note', async () => {
    dryRun.mockResolvedValue({
      sampled: 100,
      wouldChange: [{ ticketId: 't1', number: 'INC-000042', title: 'VPN down', matched: ['vip-requester'], effects: { patch: {}, tags: ['vip'], watchers: [], notifications: [], links: [], workflows: [] } }],
      errors: [],
    });
    render(builder({ areas: undefined }));
    await clickAsync(buttonNamed(document, 'Run test')!);
    const panel = document.querySelector('.app-TryIt')!;
    expect(panel.querySelector('ol a')).toBeNull();
    expect(text(panel)).not.toContain(CROSS_AREA_DEMO_TEAM_NOTE);
  });

  it('marks the action card the dry run refused', async () => {
    dryRun.mockRejectedValue(
      new ApiError(422, { type: 'about:blank', title: 'Invalid', status: 422, errors: [{ field: 'definition.actions.0.tag', code: 'too_big', message: 'Tags are at most 40 characters.' }] } as never, 'invalid'),
    );
    render(builder());
    await clickAsync(buttonNamed(document, 'Run test')!);
    const card = document.querySelector('[data-row="stored-0"]')!;
    expect(card.hasAttribute('data-invalid')).toBe(true);
    expect(text(card)).toContain('Tags are at most 40 characters.');
    expect(text(document.querySelector('.app-TryIt'))).toContain('The test couldn’t run');
  });

  it('keeps a custom action through an edit, and never sends a new rule with problems', async () => {
    update.mockResolvedValue(row(rule({ status: 'draft' })));
    render(builder({ rule: rule({ status: 'draft', publishedAt: null, actions: [{ type: 'addWatcher', userId: 'u-1' }] }) }));
    expect(text(document.querySelector('[data-row="stored-0"]'))).toContain('Custom action');
    type(document.getElementById('rule-name') as HTMLInputElement, 'Watch VIP tickets');
    await clickAsync(buttonNamed(document, 'Save draft')!);
    expect(update.mock.calls[0]![1]).toMatchObject({ name: 'Watch VIP tickets', actions: [{ type: 'addWatcher', userId: 'u-1' }] });

    cleanupDocument();
    render(builder({ rule: null, canPublish: true }));
    click(buttonNamed(document, 'Publish')!);
    expect(text(document.body)).toContain('Give the rule a name.');
    expect(text(document.body)).toContain('Add at least one action');
    expect(dialogWith('Publish “')).toBeUndefined();
    expect(create).not.toHaveBeenCalled();
  });

  it('is read-only for someone who may only read rules', () => {
    render(builder({ canManage: false, canPublish: false, viewOnly: { label: 'Rules', permission: 'Manage rules', key: 'rules.rule.manage' } }));
    expect(buttonNamed(document, 'Run test')).toBeUndefined();
    expect(buttonNamed(document, 'Add action')).toBeUndefined();
    expect((document.querySelector('.app-RuleBuilder__fieldset') as HTMLFieldSetElement).disabled).toBe(true);
  });
});

describe('the action cards', () => {
  function Editor({ onChange }: { readonly onChange: (ids: string[]) => void }): ReactNode {
    const [items, setItems] = useState<import('../components/rules/draft.js').ActionItem[]>([
      { id: 'one', draft: { type: 'addTag', value: 'first', reason: '', to: '' } },
      { id: 'two', draft: { type: 'addTag', value: 'second', reason: '', to: '' } },
      { id: 'three', custom: { type: 'addWatcher', userId: 'u-1' } },
    ]);
    return (
      <ActionsEditor
        items={items}
        workflows={null}
        teams={null}
        errors={{}}
        onChange={(next) => {
          setItems(next);
          onChange(next.map((item) => item.id));
        }}
      />
    );
  }

  it('moves a card with Alt+↓ keeping focus on the same control, and removes one with ×', () => {
    const order: string[][] = [];
    render(
      <Frame>
        <Editor onChange={(ids) => order.push(ids)} />
      </Frame>,
    );
    const tag = document.querySelector('[data-row="one"] input') as HTMLInputElement;
    tag.focus();
    act(() => {
      tag.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true }));
    });
    expect(order.at(-1)).toEqual(['two', 'one', 'three']);
    expect(document.activeElement).toBe(document.querySelector('[data-row="one"] [data-control="value"]'));
    // A custom action moves and goes like any other, and is never edited.
    expect(text(document.querySelector('[data-row="three"]'))).toContain('Custom action · Add a watcher');
    click(document.querySelector('button[aria-label="Remove action 3"]')!);
    expect(order.at(-1)).toEqual(['two', 'one']);
    // Without the team list, a team can't be chosen by name, so it isn't offered.
    expect([...document.querySelectorAll('[data-row="two"] select option')].map((option) => option.textContent)).not.toContain('Assign to a team');
  });
});

describe('the list', () => {
  const scopeHrefs = { all: '/rules', live: '/rules?status=live', draft: '/rules?status=draft', archived: '/rules?status=archived' };

  it('has no Running switch: a draft has Publish (after asking), an edited live rule says it is not running', async () => {
    publish.mockResolvedValue(row(rule({ key: 'draft-rule' })));
    render(
      <Frame>
        <RulesView
          rules={[rule(), rule({ key: 'draft-rule', name: 'Draft rule', status: 'draft', publishedAt: null, order: 30 }), rule({ key: 'edited', name: 'Edited rule', status: 'draft', order: 40 })]}
          scope="all"
          scopeHrefs={scopeHrefs}
          names={names}
          lastFired={{ 'vip-requester': NOW }}
          canManage
          canPublish
        />
      </Frame>,
    );
    expect(document.querySelector('[role="switch"]')).toBeNull();
    expect(text(document.body)).toContain('When a ticket is created · run in this order');
    expect(text(document.body)).toContain('Not running until published');
    expect(text(document.body)).toContain('1 live · 2 drafts');
    click(document.querySelector('button[aria-label="Publish Draft rule"]')!);
    const confirm = dialogWith('Publish “Draft rule”?')!;
    await clickAsync(buttonNamed(confirm, 'Publish')!);
    expect(publish).toHaveBeenCalledWith('draft-rule');
  });

  it('offers Publish only to people who may publish', () => {
    render(
      <Frame>
        <RulesView rules={[rule({ key: 'draft-rule', name: 'Draft rule', status: 'draft', publishedAt: null })]} scope="all" scopeHrefs={scopeHrefs} names={names} lastFired={null} canManage canPublish={false} />
      </Frame>,
    );
    expect(document.querySelector('button[aria-label="Publish Draft rule"]')).toBeNull();
    // Without the audit trail there is no Last fired column rather than a guess.
    expect(text(document.body)).not.toContain('Last fired');
  });

  it('says what an empty scope means, with the way back', () => {
    render(
      <Frame>
        <RulesView rules={[rule()]} scope="draft" scopeHrefs={scopeHrefs} names={names} lastFired={null} canManage canPublish />
      </Frame>,
    );
    expect(text(document.body)).toContain('No drafts. Everything written has been published or archived.');
    expect([...document.querySelectorAll('a')].some((link) => link.getAttribute('href') === '/rules' && text(link) === 'Show all rules')).toBe(true);
  });
});

