// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, forwardRef, type AnchorHTMLAttributes } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AreaModel } from '@itsm/contracts/areas';
import { LiveProvider } from '@itsm/pwa/live';
import type { SlaTimer, TimelineEntry } from '@itsm/sdk';
import { ItsmProvider } from '@itsm/ui';
import { AreasProvider } from '@itsm/ui/shell';
import { directoryKeys, type TicketBundle } from '../client/desk-ticket.js';
import { deskKeys } from '../client/query-client.js';
import { lifecycleModel } from '../workspace/Lifecycle.js';
import { agoText, headlineTimer, slaBlockReading } from '../workspace/SlaBlock.js';
import { phaseOf, requesterView, stepText } from '../workspace/TicketHero.js';
import { TicketWorkspace } from '../workspace/TicketWorkspace.js';
import { FakeEventSource, fakeFetch, noIdle, pointerDown, type Call } from './support/inbox.js';
import { cleanupDocument, click, render } from './support/render.js';
import { ADA, HISTORY, JO, ME, TEAM, TIMERS, bundle, flush, menuItem, ticket, until } from './support/workspace.js';

/**
 * The ticket hero (v3 §7.1.4, A6 §5.6.2, §11 row 6): the identity line, the
 * title, the toned chips, the lifecycle, the SLA block in its five states
 * with "Update 3 · next due …" from the timer's cycle, the condensed row,
 * the phone's SLA chip, "View as requester" and its demo guard, the triage's
 * "Sample" badge, and Assist locked in the demo — rendered as the inbox pane
 * and the ticket page render it.
 */

/* ------------------------------------------------------------------ Rules */

const NOW = Date.parse('2026-10-02T13:30:00.000Z');
const CONTEXT = { now: NOW, locale: 'en-GB', timeZone: 'Europe/London' } as const;

function timer(overrides: Partial<SlaTimer> = {}): SlaTimer {
  return {
    id: 't-res',
    targetType: 'resolution',
    state: 'running',
    startedAt: '2026-10-02T08:00:00.000Z',
    dueAt: '2026-10-02T15:01:00.000Z',
    remainingMs: 155 * 60_000,
    elapsedMs: 253 * 60_000,
    warningsFired: 0,
    metAt: null,
    breachedAt: null,
    ...overrides,
  };
}

describe('the SLA block, in words', () => {
  it('names the deadline by what meets it, with the time left and the share used', () => {
    const reading = slaBlockReading([timer()], CONTEXT);
    expect(reading.state).toBe('running');
    expect(reading.line1).toBe('Resolve by 16:01');
    expect(reading.line2).toBe('2 h 35 min left · 62% used');
    expect(reading.used).toBeCloseTo(0.62, 2);
    expect(slaBlockReading([timer({ targetType: 'response', dueAt: '2026-10-02T09:25:00.000Z' })], { ...CONTEXT, now: Date.parse('2026-10-02T08:30:00.000Z') }).line1).toBe(
      'Reply by 10:25',
    );
  });

  it('says which update is owed next, from the timer’s cycle (F1)', () => {
    const update = timer({ id: 't-upd', targetType: 'update', dueAt: '2026-10-02T13:30:00.000Z', remainingMs: 60 * 60_000, cycle: 3, cycleStartedAt: '2026-10-02T12:30:00.000Z' });
    expect(slaBlockReading([timer(), { ...update, dueAt: '2026-10-02T14:30:00.000Z' }], { ...CONTEXT, now: Date.parse('2026-10-02T12:45:00.000Z') }).update).toBe(
      'Update 3 · next due 15:30',
    );
    // An API that predates cycles still says when the next update is due.
    const { cycle: _cycle, ...old } = update;
    expect(slaBlockReading([old], { ...CONTEXT, now: Date.parse('2026-10-02T12:45:00.000Z') }).update).toBe('Next update due 14:30');
  });

  it('is at risk inside the hour, and breached once the target passes', () => {
    expect(slaBlockReading([timer({ remainingMs: 40 * 60_000 })], CONTEXT).state).toBe('due_soon');
    const breached = slaBlockReading([timer({ state: 'breached', breachedAt: '2026-10-01T12:10:00.000Z', remainingMs: 0 })], CONTEXT);
    expect(breached.state).toBe('breached');
    expect(breached.line1).toBe('Resolution target passed 1 d ago (Thu 13:10)');
    // A running clock already past its due time is breached too, whatever the server last said.
    expect(slaBlockReading([timer({ dueAt: '2026-10-02T13:00:00.000Z' })], CONTEXT).state).toBe('breached');
  });

  it('says what a paused clock waits for, all targets met, and no service levels', () => {
    const paused = slaBlockReading([timer({ state: 'paused' })], { ...CONTEXT, status: 'pending_requester' });
    expect(paused.state).toBe('paused');
    expect(paused.line1).toBe('SLA paused while waiting on the requester');
    expect(slaBlockReading([timer({ state: 'met', metAt: '2026-10-02T09:12:00.000Z' })], CONTEXT).line1).toBe('All targets met');
    expect(slaBlockReading([], CONTEXT)).toMatchObject({ state: 'none', line1: 'No service levels apply' });
  });

  it('speaks for the running timer due soonest, and floors “ago” so it never rounds up', () => {
    const soon = timer({ id: 'soon', dueAt: '2026-10-02T14:00:00.000Z' });
    expect(headlineTimer([timer(), soon])?.id).toBe('soon');
    expect(agoText(NOW - 119 * 60_000, NOW)).toBe('1 h ago');
    expect(agoText(NOW - 30_000, NOW)).toBe('just now');
  });
});

describe('the lifecycle, in steps', () => {
  const at = (value: string): string => value.slice(11, 16);
  const changed = (id: string, when: string, from: string, to: string): TimelineEntry => ({
    kind: 'event',
    id,
    at: when,
    type: 'status.changed',
    actorType: 'user',
    actorId: ME,
    payload: { from, to },
  });

  it('times each stage reached and marks the current one', () => {
    const model = lifecycleModel(ticket(), HISTORY, at);
    expect(model?.kind).toBe('steps');
    if (model?.kind !== 'steps') return;
    expect(model.steps.map((step) => [step.label, step.status, step.description ?? ''])).toEqual([
      ['New', 'complete', '08:00'],
      ['In progress', 'current', '09:01'],
      ['Waiting', 'upcoming', ''],
      ['Resolved', 'upcoming', ''],
      ['Closed', 'upcoming', ''],
    ]);
  });

  it('names the wait while the ticket waits, marks a stage it went past as skipped, and counts reopens', () => {
    const entries = [...HISTORY, changed('e-w', '2026-09-30T10:00:00.000Z', 'in_progress', 'pending_requester')];
    const waiting = lifecycleModel(ticket({ status: 'pending_requester', statusCategory: 'paused' }), entries, at);
    expect(waiting?.kind === 'steps' && waiting.steps[2]).toMatchObject({ label: 'Waiting on requester', status: 'waiting', description: '10:00' });

    const straight = lifecycleModel(
      ticket({ status: 'resolved', statusCategory: 'resolved', reopenCount: 1 }),
      [changed('e-r', '2026-09-30T10:00:00.000Z', 'new', 'resolved')],
      at,
    );
    expect(straight?.kind === 'steps' && straight.steps.map((step) => step.status)).toEqual(['complete', 'skipped', 'skipped', 'current', 'upcoming']);
    expect(straight?.kind === 'steps' && straight.reopened).toBe(1);
  });

  it('leaves the path for a cancelled ticket, and finishes it for a closed one', () => {
    expect(lifecycleModel(ticket({ status: 'cancelled', statusCategory: 'closed' }), [changed('e-c', '2026-09-30T14:02:00.000Z', 'new', 'cancelled')], at)).toEqual({
      kind: 'cancelled',
      at: '2026-09-30T14:02:00.000Z',
    });
    const closed = lifecycleModel(ticket({ status: 'closed', statusCategory: 'closed' }), [changed('e-x', '2026-09-30T15:00:00.000Z', 'resolved', 'closed')], at);
    expect(closed?.kind === 'steps' && closed.steps[4]?.status).toBe('complete');
  });

  it('places a tenant’s own state by its category, and says the step in the pane', () => {
    expect(phaseOf('awaiting_parts', 'paused')).toBe('waiting');
    expect(phaseOf('cancelled')).toBeNull();
    expect(stepText(ticket())).toBe('Step 2 of 5');
  });
});

describe('“View as requester”', () => {
  const portal = { id: 'portal', name: 'Help Portal', description: '', icon: 'home', href: '', origin: 'https://portal.test', current: false } as const;
  const desk = { id: 'workbench', name: 'Service Desk', description: '', icon: 'inbox', href: '/overview', origin: null, current: true } as const;
  const real = { product: 'IT Service Management', current: 'workbench', demo: false, visible: true, areas: [portal, desk] } as unknown as AreaModel;
  const demo = {
    ...real,
    demo: true,
    areas: [{ ...portal, persona: { key: 'employee', name: 'Emma Clarke', title: 'Finance Manager' } }, desk],
  } as unknown as AreaModel;

  it('is offered on the person’s own requests, and not otherwise, outside the demo', () => {
    expect(requesterView({ areas: real, requesterId: ME, viewerId: ME, employeeId: null })).toEqual({ kind: 'offer' });
    expect(requesterView({ areas: real, requesterId: ADA, viewerId: ME, employeeId: null })).toBeNull();
    // No Help Portal among the areas, no requester: nothing to offer.
    expect(requesterView({ areas: { ...real, areas: [desk] } as unknown as AreaModel, requesterId: ME, viewerId: ME, employeeId: null })).toBeNull();
    expect(requesterView({ areas: null, requesterId: ME, viewerId: ME, employeeId: null })).toBeNull();
  });

  it('in the demo, is offered only on Emma Clarke’s tickets and says why elsewhere', () => {
    expect(requesterView({ areas: demo, requesterId: ADA.toUpperCase(), viewerId: ME, employeeId: ADA })).toEqual({ kind: 'offer' });
    expect(requesterView({ areas: demo, requesterId: JO, viewerId: ME, employeeId: ADA })).toEqual({
      kind: 'disabled',
      reason: 'In the demo, only tickets raised by Emma Clarke can be opened as the requester',
    });
  });
});

/* -------------------------------------------------------------- Rendered */

const axe = createRequire(createRequire(import.meta.url).resolve('@itsm/ui'))('axe-core') as {
  run(context: Element, options: Record<string, unknown>): Promise<{ violations: { id: string; nodes: { html: string }[] }[] }>;
};
const OFF = ['region', 'color-contrast', 'color-contrast-enhanced', 'target-size'];
async function audit(container: Element): Promise<string[]> {
  const results = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
    rules: Object.fromEntries(OFF.map((rule) => [rule, { enabled: false }])),
  });
  return results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.html).join(' | ')}`);
}

const Link = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean | null }>(function Link(
  { prefetch: _prefetch, ...props },
  ref,
) {
  return <a ref={ref} {...props} />;
});
const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() };

interface World {
  employee: string;
  disabled: readonly string[];
  provider: string;
}
let world: World;
let wire: ReturnType<typeof fakeFetch>;

function answer(call: Call): { status?: number; body?: unknown } | undefined {
  if (call.url.endsWith('/api/v1/me')) {
    return {
      body: {
        actor: { id: ME, type: 'user', displayName: 'Alex Morgan' },
        permissions: [],
        teamIds: [TEAM],
        demo: {
          persona: 'agent',
          area: 'workbench',
          generation: 3,
          company: 'Northwind Traders (UK)',
          disabledFeatures: world.disabled,
          personaUserIds: { employee: world.employee, agent: ME, admin: JO },
          agentTeamIds: [TEAM],
        },
      },
    };
  }
  if (call.url.includes('/ai/triage/')) {
    return {
      body: {
        data: {
          decisionId: 'd-1',
          provider: world.provider,
          model: null,
          createdAt: '2026-09-30T09:00:00.000Z',
          suggestions: [{ question: 'category', field: 'categoryId', kind: 'apply', value: 'c-1', display: 'Access / VPN', confidence: 0.9 }],
          applied: [],
        },
      },
    };
  }
  if (call.url.includes('/ai/capabilities')) {
    return { body: { provider: 'sample', capabilities: [{ key: 'ticket-summary', name: 'Summary', description: '', callsAModel: true, available: true, unavailableBecause: null }] } };
  }
  if (call.url.includes('/ai/suggestions?')) return { body: { data: [] } };
  return undefined;
}

const DEMO_AREAS = {
  product: 'IT Service Management',
  current: 'workbench',
  demo: true,
  visible: true,
  areas: [
    { id: 'portal', name: 'Help Portal', description: '', icon: 'home', href: '', origin: 'https://portal.test', current: false, persona: { key: 'employee', name: 'Emma Clarke', title: 'Finance Manager' } },
    { id: 'workbench', name: 'Service Desk', description: '', icon: 'inbox', href: '/overview', origin: null, current: true },
  ],
} as unknown as AreaModel;

/** The workspace inside the frame's areas, as the `(desk)` layout mounts it. */
async function mount({ seeded = bundle(), mode = 'page', areas = null }: { seeded?: TicketBundle; mode?: 'pane' | 'page'; areas?: AreaModel | null } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } } });
  client.setQueryData(deskKeys.ticket(seeded.ticket.number), seeded);
  client.setQueryData(directoryKeys.teams(), [{ id: TEAM, name: 'Network' }]);
  client.setQueryData(directoryKeys.categories(), null);
  const rendered = render(
    <ItsmProvider
      app="workbench"
      Link={Link}
      router={router}
      usePathname={() => (mode === 'page' ? `/tickets/${seeded.ticket.number}` : '/inbox/mine')}
      useSearchParams={() => new URLSearchParams()}
      locale="en-GB"
      timeZone="Europe/London"
    >
      <AreasProvider value={areas}>
        <QueryClientProvider client={client}>
          <LiveProvider topics={[`group:${TEAM}`]}>
            <TicketWorkspace ticketId={seeded.ticket.number} mode={mode} />
          </LiveProvider>
        </QueryClientProvider>
      </AreasProvider>
    </ItsmProvider>,
  );
  await flush(2);
  return rendered;
}

/** A future deadline, so the clock is running when the test runs. */
function running(minutesLeft = 130): SlaTimer[] {
  return TIMERS.map((entry) => ({ ...entry, dueAt: new Date(Date.now() + minutesLeft * 60_000).toISOString(), remainingMs: minutesLeft * 60_000 }));
}

function hero(): HTMLElement {
  const found = document.querySelector<HTMLElement>('.app-TicketHero');
  if (!found) throw new Error('no hero');
  return found;
}

beforeEach(() => {
  FakeEventSource.opened = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  noIdle();
  world = { employee: ADA, disabled: [], provider: 'openai' };
  wire = fakeFetch(answer);
  vi.stubGlobal('fetch', wire.fetch);
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  cleanupDocument();
  vi.unstubAllGlobals();
});

describe('the hero on the page', () => {
  it('shows the type’s neutral tile, the identity line and the title as the page’s h1, in a card', async () => {
    await mount({ seeded: bundle({ timers: running() }) });
    expect(hero().dataset.mode).toBe('page');
    expect(hero().querySelector('.app-WsHeader__tile')?.getAttribute('data-tone')).toBe('neutral');
    expect(hero().querySelector('.app-WsHeader__tile [data-icon]')).not.toBeNull();
    expect(hero().querySelector('.app-WsHeader__meta')?.textContent).toMatch(/^INC-000123 · Incident · Email · raised .+ by Ada Lovelace$/);
    expect(hero().querySelector('h1')?.textContent).toBe('VPN keeps dropping');
  });

  it('tones the status and priority chips, and keeps the others neutral', async () => {
    await mount({ seeded: bundle({ timers: running() }) });
    const status = hero().querySelector('[data-field="status"] .itsm-StatusPill');
    expect(status?.textContent).toContain('In progress');
    expect(status?.getAttribute('data-tone')).toBe('info');
    const priority = hero().querySelector('[data-field="priority"] .itsm-PriorityChip');
    expect(priority?.getAttribute('data-priority')).toBe('P3');
    expect(hero().querySelector('[data-field="priority"]')?.textContent).toMatch(/^Priority: P3 · Medium\s*3, medium$/);
    expect(hero().querySelector('[data-field="team"] .itsm-StatusPill')).toBeNull();
    // A wait is `hold`, never amber (D5).
    cleanupDocument();
    await mount({ seeded: bundle({ ticket: ticket({ status: 'pending_requester', statusCategory: 'paused' }), timers: running() }) });
    expect(hero().querySelector('[data-field="status"] .itsm-StatusPill')?.getAttribute('data-tone')).toBe('hold');
  });

  it('draws the lifecycle on the page, loaded after the hero', async () => {
    await mount({ seeded: bundle({ timers: running() }) });
    await until(() => expect(hero().querySelector('.app-Lifecycle .itsm-Stepper')).not.toBeNull());
    const steps = [...hero().querySelectorAll('.itsm-Stepper__step')];
    expect(steps).toHaveLength(5);
    expect(steps[1]?.getAttribute('aria-current')).toBe('step');
    expect(hero().querySelector('.itsm-Stepper ol')?.getAttribute('aria-label')).toBe('Ticket progress');
  });

  it('shows the SLA block with a 44 px ring, the deadline, a time-used bullet and the next update', async () => {
    const dueSoon = new Date(Date.now() + 40 * 60_000).toISOString();
    const timers = [...running(), { ...TIMERS[0]!, id: 'sla-u', targetType: 'update', dueAt: dueSoon, remainingMs: 40 * 60_000, elapsedMs: 20 * 60_000, cycle: 3 }];
    await mount({ seeded: bundle({ timers }) });
    const block = hero().querySelector<HTMLElement>('.app-SlaBlock')!;
    expect(block.dataset.compact).toBeUndefined();
    expect(block.querySelector('.itsm-SlaClock')?.getAttribute('data-ring-size')).toBe('lg');
    // The update owed is the soonest running timer, so the block speaks for it, and says its cycle.
    expect(block.querySelector('.app-SlaBlock__line1')?.textContent).toMatch(/^Update by \d\d:\d\d/);
    expect(block.querySelector('.app-SlaBlock__bullet[role="img"]')).not.toBeNull();
    expect(block.querySelector('.app-SlaBlock__update')?.textContent).toMatch(/^Update 3 · next due \d\d:\d\d$/);
    // The phone's chip is there for the narrow layout, its words spoken as a timer.
    expect(hero().querySelector('.app-TicketHero__slaChip .itsm-SlaClock[data-display="chip"]')?.getAttribute('role')).toBe('timer');
  });

  it('opens and focuses the Service levels card from the block’s button', async () => {
    class Wide {
      constructor(private readonly callback: (entries: { contentRect: { width: number } }[]) => void) {}
      observe(): void {
        this.callback([{ contentRect: { width: 1280 } }]);
      }
      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal('ResizeObserver', Wide);
    await mount({ seeded: bundle({ timers: running() }) });
    const card = document.getElementById('ticket-sla') as HTMLDetailsElement;
    card.open = false;
    click(hero().querySelector<HTMLButtonElement>('.app-SlaBlock__open')!);
    await flush(2);
    expect(card.open).toBe(true);
    expect(document.activeElement).toBe(card.querySelector('summary'));
  });

  it('says when no service levels apply, and draws no block when the timers could not be read', async () => {
    await mount({ seeded: bundle({ timers: [] }) });
    expect(hero().querySelector('.app-SlaBlock')?.getAttribute('data-state')).toBe('none');
    expect(hero().querySelector('.app-SlaBlock__line1')?.textContent).toBe('No service levels apply');
    cleanupDocument();
    await mount({ seeded: bundle({ timers: null }) });
    expect(hero().querySelector('.app-SlaBlock')).toBeNull();
  });

  it('condenses to one row as the conversation scrolls, every control still in place', async () => {
    await mount({ seeded: bundle({ timers: running() }) });
    const buttonsBefore = hero().querySelectorAll('button').length;
    const conversation = document.getElementById('ticket-conversation')!;
    Object.defineProperty(conversation, 'scrollTop', { value: 120, configurable: true });
    act(() => {
      conversation.dispatchEvent(new Event('scroll'));
    });
    await flush(1);
    expect(hero().hasAttribute('data-condensed')).toBe(true);
    expect(hero().querySelector('.app-SlaBlock')?.hasAttribute('data-compact')).toBe(true);
    expect(hero().querySelector('.itsm-SlaClock[data-ring-size]')?.getAttribute('data-ring-size')).toBe('sm');
    expect(hero().querySelectorAll('button').length).toBe(buttonsBefore);
  });

  it('is axe clean', async () => {
    const { container } = await mount({ seeded: bundle({ timers: running() }) });
    await until(() => expect(hero().querySelector('.itsm-Stepper')).not.toBeNull());
    expect(await audit(container)).toEqual([]);
  });
});

describe('the hero in the pane', () => {
  it('has the title as h2, no lifecycle, a compact block, and says the step with the status', async () => {
    await mount({ seeded: bundle({ timers: running() }), mode: 'pane' });
    expect(hero().querySelector('h2.app-WsHeader__title')?.textContent).toBe('VPN keeps dropping');
    expect(hero().querySelector('h1')).toBeNull();
    expect(hero().querySelector('.app-TicketHero__lifecycle')).toBeNull();
    expect(hero().querySelector('.app-SlaBlock')?.hasAttribute('data-compact')).toBe(true);
    expect(hero().querySelector('.app-SlaBlock__bullet')).toBeNull();
    expect(hero().querySelector('[data-field="status"]')?.textContent).toContain('step 2 of 5');
  });
});

describe('“View as requester” in the ⋯ menu', () => {
  async function openMore(): Promise<void> {
    pointerDown(document.querySelector<HTMLButtonElement>('button[aria-label="More actions for INC-000123"]')!);
    await flush(2);
  }

  it('is offered in the demo on Emma Clarke’s tickets', async () => {
    world.employee = ADA;
    await mount({ areas: DEMO_AREAS });
    await until(() => expect(wire.calls.some((call) => call.url.endsWith('/api/v1/me'))).toBe(true));
    await flush(2);
    await openMore();
    const item = menuItem(/View as requester/)!;
    expect(item).not.toBeNull();
    expect(item.getAttribute('aria-disabled')).not.toBe('true');
  });

  it('is shown disabled, with the reason, on anybody else’s', async () => {
    world.employee = JO;
    await mount({ areas: DEMO_AREAS });
    await until(() => expect(wire.calls.some((call) => call.url.endsWith('/api/v1/me'))).toBe(true));
    await flush(2);
    await openMore();
    const item = menuItem(/View as requester/)!;
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(document.body.textContent).toContain('In the demo, only tickets raised by Emma Clarke can be opened as the requester');
  });

  it('is not offered outside a frame that lists the Help Portal, and reads no /me outside the demo', async () => {
    await mount();
    await openMore();
    expect(menuItem(/View as requester/)).toBeNull();
    expect(wire.calls.some((call) => call.url.endsWith('/api/v1/me'))).toBe(false);
  });
});

describe('AI in the inspector', () => {
  class Wide {
    constructor(private readonly callback: (entries: { contentRect: { width: number } }[]) => void) {}
    observe(): void {
      this.callback([{ contentRect: { width: 1280 } }]);
    }
    unobserve(): void {}
    disconnect(): void {}
  }

  it('marks the demo’s sample triage “Sample”, and a provider’s answer not', async () => {
    vi.stubGlobal('ResizeObserver', Wide);
    world.provider = 'sample';
    await mount({ seeded: bundle({ timers: running(), can: { aiRead: true, ai: true } }) });
    await until(() => expect(document.querySelector('.app-Triage')).not.toBeNull());
    const sample = document.querySelector('.app-Triage__sample');
    expect(sample?.textContent).toContain('Sample');
    expect(sample?.querySelector('.itsm-StatusPill')?.getAttribute('data-tone')).toBe('neutral');
    expect(sample?.querySelector('button')?.getAttribute('aria-label')).toBe('About Sample');
    cleanupDocument();
    world.provider = 'openai';
    await mount({ seeded: bundle({ timers: running(), can: { aiRead: true, ai: true } }) });
    await until(() => expect(document.querySelector('.app-Triage')).not.toBeNull());
    expect(document.querySelector('.app-Triage__sample')).toBeNull();
  });

  it('locks every Assist chip with the demo’s sentence when the demo turns AI off', async () => {
    vi.stubGlobal('ResizeObserver', Wide);
    world.disabled = ['ai'];
    await mount({ seeded: bundle({ timers: running(), can: { aiRead: true, ai: true } }) });
    const assist = document.querySelector<HTMLDetailsElement>('details[data-card="assist"]')!;
    act(() => {
      assist.open = true;
      assist.dispatchEvent(new Event('toggle'));
    });
    await until(() => expect(assist.querySelector('.app-Assist__chips button')).not.toBeNull());
    await until(() => expect(assist.textContent).toContain('This is a shared demo, so calling a live AI model is turned off.'));
    const chip = assist.querySelector<HTMLButtonElement>('.app-Assist__chips button')!;
    expect(chip.getAttribute('aria-disabled')).toBe('true');
  });
});
