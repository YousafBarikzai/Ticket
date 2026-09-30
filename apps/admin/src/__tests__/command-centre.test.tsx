// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, forwardRef, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Admin, DashboardRow, MetricResult } from '@itsm/sdk';
import { structuralVariables, themeVariables } from '@itsm/ui/tokens';
import type { Grants } from '../permissions.js';

vi.mock('server-only', () => ({}));

let search = '';
const router = { refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), forward: vi.fn() };
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(search),
}));

const rotateCredential = vi.fn(async (ref: string) => ({ ref }));
vi.mock('../client/api.js', () => ({ api: { observe: { integrations: { rotateCredential } } } }));

const { ItsmProvider } = await import('@itsm/ui');
const { AttentionCard } = await import('../components/command-centre/AttentionCard.js');
const { BriefingLead, SetupChecklist } = await import('../components/command-centre/SetupChecklist.js');
const { VolumeView, rangeHref } = await import('../components/command-centre/VolumeView.js');
const { updatedText } = await import('../components/command-centre/UpdatedAt.js');
const { WithheldSections } = await import('../components/command-centre/WithheldSections.js');
const presentation = await import('../components/command-centre/presentation.js');
const data = await import('../components/command-centre/data.js');
const insights = await import('../components/insights/presentation.js');
const { orderDashboards, pickDashboard, dashboardHref } = await import('../components/insights/Dashboards.js');
const { periodLabel } = await import('../components/insights/Widget.js');
const { csvFileName, csvHref } = await import('../components/insights/ReportsTable.js');
const { useDrawer } = await import('../client/useDrawer.js');
const { withheldNav } = await import('../navigation.js');
const { cleanupDocument, click, render } = await import('./support/render.js');

/**
 * The Command centre (SPEC §6.1, X-30) and the Insights helpers: the
 * briefing's cards render every state the blueprint names — rows with one
 * action each, the success state, sources that could not be read, the
 * first-run checklist (hidden per person, recovered with `?setup=1`), the
 * volume card's period changing in place — and the words, numbers and
 * loaders behind them.
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
      usePathname={() => '/'}
      useSearchParams={() => new URLSearchParams(search)}
      locale="en-GB"
      timeZone="Europe/London"
    >
      {children}
    </ItsmProvider>
  );
}

function person(...keys: string[]): Grants {
  return { permissions: keys.map((key) => ({ key, scope: 'any' })) };
}

const CHECKED = '2026-09-30T08:59:00Z';
const STORAGE_KEY = 'itsm-dismissed:admin.setup-checklist';

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
  window.localStorage.clear();
});

afterEach(() => {
  cleanupDocument();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const text = (element: Element | null | undefined): string => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

/* ======================================================================= */

describe('Needs attention', () => {
  const items = [
    {
      id: 'failed-runs' as const,
      tone: 'danger' as const,
      icon: 'workflow' as const,
      title: '3 workflow runs failed',
      detail: 'Each stopped part way.',
      at: CHECKED,
      when: 'Latest',
      action: { label: 'Review', href: '/workflows' },
    },
    {
      id: 'urgent-unowned' as const,
      tone: 'warning' as const,
      icon: 'ticket' as const,
      title: '1 urgent ticket has no owner',
      rows: [{ id: 't1', label: 'INC-000004 · Email is down', meta: 'P2', at: CHECKED, when: 'Raised', href: '/tickets?open=ticket:INC-000004' }],
      action: { label: 'Open', href: '/tickets?status=open&assignee=none' },
    },
    {
      id: 'credentials' as const,
      tone: 'info' as const,
      icon: 'key' as const,
      title: 'Credential slack-bot expires soon',
      action: { label: 'Rotate', href: '/integrations', rotate: { ref: 'slack-bot' } },
    },
  ];

  it('lists each row with its tone in words and exactly one action, named by the row', () => {
    const { container } = render(
      <Frame>
        <AttentionCard items={items} failures={[]} checkedAt={CHECKED} />
      </Frame>,
    );
    const rows = [...container.querySelectorAll('.app-Attention__item')];
    expect(rows.map((row) => row.getAttribute('data-source'))).toEqual(['failed-runs', 'urgent-unowned', 'credentials']);
    // The tone is an icon with a name, never colour alone.
    expect(rows.map((row) => row.querySelector('.app-Attention__tone')?.getAttribute('aria-label'))).toEqual([
      'Urgent',
      'Needs attention soon',
      'For information',
    ]);
    for (const row of rows) expect(row.querySelectorAll('.app-Attention__action a, .app-Attention__action button')).toHaveLength(1);
    const review = rows[0]!.querySelector('.app-Attention__action a')!;
    expect(review.getAttribute('href')).toBe('/workflows');
    expect(text(review)).toBe('Review: 3 workflow runs failed');
    expect(rows[1]!.querySelector('.app-Attention__rows a')?.getAttribute('href')).toBe('/tickets?open=ticket:INC-000004');
    // Rotate opens a sheet in place rather than leaving the page.
    const rotate = rows[2]!.querySelector('.app-Attention__action button')!;
    expect(text(rotate)).toBe('Rotate: Credential slack-bot expires soon');
    expect(rotate.getAttribute('aria-haspopup')).toBe('dialog');
    expect(container.querySelector('.app-Attention')?.getAttribute('data-state')).toBe('items');
  });

  it('is the success state when every source answered and nothing needs doing', () => {
    const { container } = render(
      <Frame>
        <AttentionCard items={[]} failures={[]} checkedAt={CHECKED} />
      </Frame>,
    );
    expect(container.querySelector('.app-Attention')?.getAttribute('data-state')).toBe('clear');
    expect(text(container)).toContain('Nothing needs you right now');
    expect(text(container)).toContain('Checked');
  });

  it('never claims all is well while a source went unread, and offers to try again', () => {
    const { container } = render(
      <Frame>
        <AttentionCard
          items={[]}
          failures={[
            { id: 'failed-deliveries', label: 'failed deliveries', problem: { status: 503, retryable: true } },
            { id: 'usage', label: 'usage and plan', problem: { status: 500 } },
          ]}
          checkedAt={CHECKED}
        />
      </Frame>,
    );
    expect(text(container)).not.toContain('Nothing needs you');
    expect(container.querySelector('.app-Attention')?.getAttribute('data-state')).toBe('unknown');
    expect(text(container)).toContain('Couldn’t check failed deliveries and usage and plan.');
    const retry = [...container.querySelectorAll('button')].find((button) => text(button) === 'Try again')!;
    click(retry);
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });
});

describe('Rotate, in place', () => {
  it('asks for the new value in a password field, refuses an empty one, and rotates', async () => {
    const { RotateCredential } = await import('../components/command-centre/RotateCredential.js');
    const { container } = render(
      <Frame>
        <RotateCredential credential="slack-bot" context="Credential slack-bot expires soon" />
      </Frame>,
    );
    click(container.querySelector('button')!);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(text(dialog.querySelector('h2'))).toBe('Rotate slack-bot');
    const field = dialog.querySelector('input[name="value"]') as HTMLInputElement;
    expect(field.type).toBe('password');
    expect(field.autocomplete).toBe('off');
    const submit = [...dialog.querySelectorAll('button')].find((button) => text(button) === 'Rotate') as HTMLButtonElement;
    expect(submit.getAttribute('type')).toBe('submit');
    const form = dialog.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(rotateCredential).not.toHaveBeenCalled();
    expect(text(dialog)).toContain('New value is required');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(field, 'xoxb-new');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(rotateCredential).toHaveBeenCalledWith('slack-bot', 'xoxb-new');
    expect(router.refresh).toHaveBeenCalled();
  });
});

/* ======================================================================= */

describe('the first-run checklist', () => {
  const steps = presentation.setupSteps(
    { services: 1, publishedRequestTypes: 1, publishedPolicies: 0, calendars: 0, activePeople: 1, emailConnected: false },
    (step) => `/${step}`,
  );
  const clear = { items: [], failures: [], checkedAt: CHECKED };
  const busy = {
    items: [{ id: 'failed-runs' as const, tone: 'danger' as const, icon: 'workflow' as const, title: '1 workflow run failed' }],
    failures: [],
    checkedAt: CHECKED,
  };

  it('replaces an empty Needs attention on a new desk', () => {
    const { container } = render(
      <Frame>
        <BriefingLead steps={steps} force={false} attention={clear} />
      </Frame>,
    );
    expect(container.querySelector('.app-Setup')).not.toBeNull();
    expect(container.querySelector('.app-Attention')).toBeNull();
  });

  it('never hides a problem: Needs attention comes first when it has rows', () => {
    const { container } = render(
      <Frame>
        <BriefingLead steps={steps} force={false} attention={busy} />
      </Frame>,
    );
    const order = [...container.querySelectorAll('.app-Attention, .app-Setup')].map((node) => node.className.split(' ')[0]);
    expect(order).toEqual(['app-Attention', 'app-Setup']);
  });

  it('lists what is left, folds what is done, and says how far along it is', () => {
    const { container } = render(
      <Frame>
        <SetupChecklist steps={steps} />
      </Frame>,
    );
    expect([...container.querySelectorAll('.app-Setup__step')].map((node) => node.getAttribute('data-step'))).toEqual([
      'service-levels',
      'business-hours',
      'people',
      'email',
    ]);
    expect(text(container.querySelector('.app-Setup__done summary'))).toBe('1 already done');
    expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBeDefined();
    expect(text(container)).toContain('1 of 5 done');
    expect(container.querySelector('[data-step="email"] a')?.getAttribute('href')).toBe('/email');
  });

  it('hides for this person on this device, and stays hidden', () => {
    const first = render(
      <Frame>
        <BriefingLead steps={steps} force={false} attention={clear} />
      </Frame>,
    );
    const hide = [...first.container.querySelectorAll('button')].find((button) => text(button) === 'Hide setup checklist')!;
    click(hide);
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    // With the checklist gone, the (clear) Needs attention takes its place.
    expect(first.container.querySelector('.app-Setup')).toBeNull();
    expect(first.container.querySelector('.app-Attention')?.getAttribute('data-state')).toBe('clear');
    first.unmount();

    const again = render(
      <Frame>
        <BriefingLead steps={steps} force={false} attention={clear} />
      </Frame>,
    );
    expect(again.container.querySelector('.app-Setup')).toBeNull();
  });

  it('comes back from ⌘K "Setup checklist" (?setup=1), all steps listed, and forgets the dismissal', () => {
    window.localStorage.setItem(STORAGE_KEY, CHECKED);
    const { container } = render(
      <Frame>
        <BriefingLead steps={steps} force attention={clear} />
      </Frame>,
    );
    expect(container.querySelectorAll('.app-Setup__step')).toHaveLength(5);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('is not shown once every step this person can see is done', () => {
    const done = presentation.setupSteps(
      { services: 2, publishedRequestTypes: 3, publishedPolicies: 1, calendars: 1, activePeople: 9, emailConnected: true },
      (step) => `/${step}`,
    );
    expect(presentation.setupIncomplete(done)).toBe(false);
    const { container } = render(
      <Frame>
        <BriefingLead steps={done} force={false} attention={clear} />
      </Frame>,
    );
    expect(container.querySelector('.app-Setup')).toBeNull();
  });

  it('sets nobody homework they cannot do: a step without a page for this person is left out', () => {
    const facts = { services: 0, publishedRequestTypes: 0, publishedPolicies: 0, calendars: 0, activePeople: 1, emailConnected: false };
    const hrefFor = data.setupHref(person('identity.user.read', 'identity.user.manage', 'sla.policy.read'));
    expect(presentation.setupSteps(facts, hrefFor).map((step) => [step.id, step.href])).toEqual([['people', '/people?new=1']]);
    const administrator = data.setupHref(person('catalogue.manage', 'sla.policy.read', 'sla.policy.manage', 'admin.setting.read', 'admin.setting.manage'));
    expect(presentation.setupSteps(facts, administrator).map((step) => [step.id, step.href])).toEqual([
      ['catalogue', '/catalogue?new=service'],
      ['service-levels', '/sla?new=1'],
      // Calendars is still being built: Service levels itself.
      ['business-hours', '/sla'],
      ['email', '/settings?q=email'],
    ]);
  });
});

/* ======================================================================= */

describe('the Volume card', () => {
  function volume() {
    return render(
      <Frame>
        <VolumeView range="30d" views={{ time: <p data-view="time">lines</p>, channel: <p data-view="channel">channels</p>, team: <p data-view="team">teams</p> }} />
      </Frame>,
    );
  }

  it('switches between its three views without fetching anything', () => {
    const { container } = volume();
    expect(container.querySelector('[data-view]')?.getAttribute('data-view')).toBe('time');
    const byTeam = [...container.querySelectorAll('[role="radio"]')].find((radio) => text(radio) === 'By team')!;
    click(byTeam);
    expect(container.querySelector('[data-view]')?.getAttribute('data-view')).toBe('team');
    expect(text(container.querySelector('.app-Volume__range'))).toBe('Raised, by team · last 30 days');
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('keeps its period in the URL as real links, and changes it in place without scrolling or adding history', () => {
    const { container } = volume();
    const links = [...container.querySelectorAll('nav[aria-label="Period for the volume chart"] a')];
    expect(links.map((link) => [text(link), link.getAttribute('href'), link.getAttribute('aria-current')])).toEqual([
      ['7 days', '/?range=7d', null],
      ['30 days', '/?range=30d', 'page'],
      ['90 days', '/?range=90d', null],
    ]);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    act(() => {
      links[0]!.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(router.replace).toHaveBeenCalledWith('/?range=7d', { scroll: false });
    expect(router.push).not.toHaveBeenCalled();
  });

  it('leaves a modified click to the browser (a new tab keeps working)', () => {
    const { container } = volume();
    const link = container.querySelector('nav[aria-label="Period for the volume chart"] a')!;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, metaKey: true });
    // jsdom would navigate; stop it at the document after the card has decided.
    document.addEventListener('click', (e) => e.preventDefault(), { once: true });
    act(() => {
      link.dispatchEvent(event);
    });
    expect(router.replace).not.toHaveBeenCalled();
    expect(rangeHref('90d')).toBe('/?range=90d');
  });
});

/* ======================================================================= */

describe('what a person cannot open', () => {
  it('lists withheld sections with the permission in words, collapsed unless it is the whole story', () => {
    const withheld = withheldNav(person('ticket.read'));
    const { container } = render(
      <Frame>
        <WithheldSections withheld={withheld} />
      </Frame>,
    );
    const details = container.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(text(details.querySelector('summary'))).toBe(`${withheld.length} sections aren’t available to you`);
    const rules = [...details.querySelectorAll('.app-Withheld__item')].find((item) => text(item.querySelector('.app-Withheld__label')) === 'Rules');
    expect(text(rules?.querySelector('.app-Withheld__needs'))).toBe('Needs Read rules');
    // Keys only for people who asked to see them.
    expect(details.querySelector('code')).toBeNull();
  });

  it('opens when nothing else is reachable, and says nothing when nothing is withheld', () => {
    const { container } = render(
      <Frame>
        <WithheldSections withheld={withheldNav(person())} open />
        <div data-empty="">
          <WithheldSections withheld={[]} />
        </div>
      </Frame>,
    );
    expect(container.querySelector('details')?.open).toBe(true);
    expect(container.querySelector('[data-empty]')?.childElementCount).toBe(0);
  });
});

/* ======================================================================= */

describe('the briefing’s words', () => {
  it('greets by the time of day where the person is', () => {
    const at = new Date('2026-09-30T07:30:00Z');
    expect(presentation.greeting('Alex Administrator', at, 'Europe/London')).toBe('Good morning, Alex');
    expect(presentation.greeting('Alex Administrator', at, 'America/Los_Angeles')).toBe('Good evening, Alex');
    expect(presentation.greeting(null, new Date('2026-09-30T13:00:00Z'), 'UTC')).toBe('Good afternoon');
    expect(presentation.greeting('Priya', at, 'Not/AZone')).toBe('Good morning, Priya');
  });

  it('sums up Needs attention in one line, honestly', () => {
    const tone = (...tones: ('danger' | 'warning' | 'info')[]) => tones.map((value) => ({ tone: value }));
    expect(presentation.statusLine({ items: [], failures: [], consulted: 0 })).toBeNull();
    expect(presentation.statusLine({ items: [], failures: [], consulted: 4 })).toBe('Nothing needs you right now.');
    expect(presentation.statusLine({ items: [], failures: [{}], consulted: 4 })).toBe('Some checks couldn’t run just now.');
    expect(presentation.statusLine({ items: tone('info'), failures: [], consulted: 4 })).toBe('One thing needs you.');
    expect(presentation.statusLine({ items: tone('danger'), failures: [], consulted: 4 })).toBe('One urgent thing needs you.');
    expect(presentation.statusLine({ items: tone('danger', 'warning', 'info'), failures: [], consulted: 4 })).toBe('Three things need you, one of them urgent.');
    expect(presentation.statusLine({ items: tone('danger', 'danger'), failures: [], consulted: 4 })).toBe('Two things need you, all of them urgent.');
    expect(presentation.statusLine({ items: tone(...Array<'info'>(12).fill('info')), failures: [], consulted: 4 })).toBe('12 things need you.');
  });

  it('writes a configuration change as a sentence, with the thing’s name when the event has one', () => {
    expect(presentation.describeChange('rule.published', 'VIP requester')).toEqual({ verb: 'published the rule', object: { label: 'VIP requester' } });
    expect(presentation.describeChange('config.published')).toEqual({ verb: 'changed a setting' });
    expect(presentation.describeChange('sla.policy.targets.changed')).toEqual({ verb: 'changed SLA targets' });
    expect(presentation.describeChange('sla.policy.created')).toEqual({ verb: 'created an SLA policy' });
    expect(presentation.describeChange('integration.credential.rotated')).toEqual({ verb: 'rotated a credential' });
    expect(presentation.describeChange('user.provisioned', 'Owen Owner')).toEqual({ verb: 'added the person', object: { label: 'Owen Owner' } });
    expect(presentation.describeChange('analytics.dashboard.created')).toEqual({ verb: 'created a dashboard' });
    expect(presentation.describeChange('feature_flag.set')).toEqual({ verb: 'changed a feature' });
    expect(presentation.describeChange('integration.action.published')).toEqual({ verb: 'published an integration action' });
    expect(presentation.nameFrom(null, { key: 'x' }, { title: ' Weekly review ' })).toBe('Weekly review');
  });

  it('keeps the desk working out of "recent changes": tickets, sign-ins and applied rules are not configuration', () => {
    for (const action of ['rule.published', 'config.published', 'sla.policy.created', 'role.assignment.granted', 'user.provisioned', 'catalogue.item.published']) {
      expect(presentation.isConfigurationChange(action), action).toBe(true);
    }
    for (const action of ['ticket.created', 'rule.applied', 'auth.login.failed', 'sla.escalated', 'approval.decided', 'ai.decision.recorded']) {
      expect(presentation.isConfigurationChange(action), action).toBe(false);
    }
  });

  it('says how fresh the page is: the time before the clock is known, then relative', () => {
    const at = '2026-09-30T08:00:00Z';
    expect(updatedText(at, null, 'en-GB', 'Europe/London')).toBe('Updated 09:00');
    expect(updatedText(at, Date.parse(at) + 20_000, 'en-GB', 'Europe/London')).toBe('Updated just now');
    expect(updatedText(at, Date.parse(at) + 3 * 60_000, 'en-GB', 'Europe/London')).toBe('Updated 3 min ago');
  });
});

/* ======================================================================= */

describe('the loaders', () => {
  const result = (value: number | null, extra: Partial<MetricResult> = {}): MetricResult => ({
    metric: { key: 'm', name: 'M', unit: 'count', aggregate: 'count', fact: 'ticket' },
    period: { from: '2026-09-01T00:00:00Z', to: '2026-10-01T00:00:00Z' },
    value,
    source: 'facts',
    ...extra,
  });

  it('reads desk health from analytics: four stats, SLA with its breaches, first reply against the month before', async () => {
    const asked: unknown[] = [];
    const values: Record<string, MetricResult> = {
      'tickets.open': result(184),
      'tickets.created': result(null, { series: [{ at: 'a', value: 12 }, { at: 'b', value: 18 }] }),
      'sla.attainment': result(94.2),
      'sla.breaches': result(3),
    };
    const api = {
      observe: {
        insights: {
          query: vi.fn(async (body: { metricKey: string; filters?: unknown[]; range: string }) => {
            asked.push(body);
            if (body.metricKey === 'tickets.open' && body.filters) return result(17);
            if (body.metricKey === 'tickets.first_response') return result(body.range === 'custom' ? 60 : 72);
            return values[body.metricKey] ?? result(null);
          }),
        },
      },
    } as unknown as Admin;
    const health = await data.loadDeskHealth(person('analytics.read', 'ticket.read'), api, new Date('2026-09-30T09:00:00Z'));
    expect(health.source).toBe('analytics');
    expect(health.empty).toBe(false);
    expect(health.stats.map((stat) => [stat.label, stat.value])).toEqual([
      ['Open · last 90 days', 184],
      ['Unassigned · last 90 days', 17],
      ['SLA met · 30 days', 94.2],
      ['First reply · 30 days', 72],
    ]);
    expect(health.stats[0]).toMatchObject({ href: '/tickets?status=open', trend: [12, 18] });
    expect(health.stats[2]).toMatchObject({ secondary: '· 3 breached', status: 'attention' });
    expect(health.stats[3]?.delta?.value).toBeCloseTo(0.2);
    expect(asked).toContainEqual({ metricKey: 'tickets.first_response', range: 'custom', from: '2026-08-02T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' });
  });

  it('says "no data yet" rather than four dashes when the projection has nothing', async () => {
    const api = { observe: { insights: { query: vi.fn(async () => result(null, { series: [{ at: 'a', value: 0 }] })) } } } as unknown as Admin;
    const health = await data.loadDeskHealth(person('analytics.read'), api);
    expect(health.empty).toBe(true);
  });

  it('counts the open lists without analytics, as "50+" when a page is full', async () => {
    const page = (length: number, more: boolean) => ({ data: Array.from({ length }, (_, id) => ({ id })), nextCursor: more ? 'next' : null });
    const api = {
      observe: { tickets: vi.fn(async (filter: { assignee?: string }) => (filter.assignee === 'none' ? page(7, false) : page(50, true))) },
    } as unknown as Admin;
    const health = await data.loadDeskHealth(person('ticket.read'), api);
    expect(health.source).toBe('counts');
    expect(health.stats.map((stat) => [stat.label, stat.value, stat.approx ?? false])).toEqual([
      ['Open', 50, true],
      ['Unassigned', 7, false],
    ]);
  });

  it('shows no desk health to someone who can read neither analytics nor tickets', async () => {
    expect((await data.loadDeskHealth(person('audit.read'), {} as Admin)).source).toBe('none');
  });

  it('reads the checklist’s facts only where the person may read them', async () => {
    const api = {
      configure: {
        catalogue: { services: vi.fn(async () => [{}]), requestTypes: vi.fn(async () => [{ status: 'published' }]) },
        sla: { policies: vi.fn(async () => []), calendars: vi.fn(async () => []) },
      },
      tenant: { users: vi.fn(async () => []), setting: vi.fn(async () => ({ value: 'smtp' })) },
    } as unknown as Admin;
    const steps = await data.loadSetup(person('catalogue.manage', 'admin.setting.read', 'admin.setting.manage'), api);
    expect(steps.map((step) => [step.id, step.done])).toEqual([
      ['catalogue', true],
      ['email', true],
    ]);
    expect(api.configure.sla.policies).not.toHaveBeenCalled();
    expect(api.tenant.users).not.toHaveBeenCalled();
  });

  it('takes a volume period only from the three the card offers', () => {
    expect([data.volumeRange('7d'), data.volumeRange('90d'), data.volumeRange('12m'), data.volumeRange(undefined)]).toEqual(['7d', '90d', '30d', '30d']);
  });
});

/* ======================================================================= */

describe('Insights numbers and words', () => {
  it('writes percentages as ratios, minutes as durations, and money without a guessed currency', () => {
    expect(insights.statValue('percent', 94.2)).toBeCloseTo(0.942);
    expect(insights.statValue('count', null)).toBeNull();
    expect(insights.statFormat('minutes')).toEqual({ duration: 'minutes' });
    expect(insights.statFormat('money')).toEqual({ minimumFractionDigits: 2, maximumFractionDigits: 2 });
  });

  it('moves a duration axis to hours and days once minutes stop being readable', () => {
    expect(insights.chartScale('minutes', [30, 90]).factor).toBe(1);
    expect(insights.chartScale('minutes', [30, 300])).toMatchObject({ factor: 1 / 60, format: { unit: 'hour' } });
    expect(insights.chartScale('minutes', [5000])).toMatchObject({ factor: 1 / 1440, format: { unit: 'day' } });
    expect(insights.chartScale('percent', [50]).factor).toBe(0.01);
  });

  it('names groups in words, channels with their glyph, and an empty key as "Not set"', () => {
    const groups = [
      { key: 'email', value: 12, label: 'email' },
      { key: null, value: 3, label: null },
      { key: 'pending_requester', value: 1, label: null },
    ];
    expect(insights.toBars(groups, 1, 'channel')).toEqual([
      { id: 'email', label: 'Email', value: 12, icon: 'mail' },
      { id: 'none-1', label: 'Not set', value: 3 },
      { id: 'pending_requester', label: 'Pending requester', value: 1, icon: 'message-square' },
    ]);
    expect(insights.toBars([{ key: 't1', value: 0.5, label: 'Service desk' }], 2, 'teamId')).toEqual([{ id: 't1', label: 'Service desk', value: 1 }]);
  });

  it('says what a metric measures in a sentence', () => {
    expect(insights.measureSentence({ aggregate: 'avg', field: 'timeToResolveMinutes', fact: 'ticket' })).toBe('Average time to resolve, over tickets');
    expect(insights.measureSentence({ aggregate: 'count', fact: 'sla_timer' })).toBe('Count of SLA targets');
    expect(insights.measureSentence({ aggregate: 'p90', field: 'timeToResolveMinutes', fact: 'ticket' })).toBe('90th percentile of time to resolve, over tickets');
    expect(insights.dimensionLabel('teamId')).toBe('Team');
    expect(insights.dimensionLabel('somethingNewId')).toBe('Something new');
  });

  it('treats a result of zeros as no data', () => {
    const base = { metric: { key: 'm', name: 'M', unit: 'count' as const, aggregate: 'count', fact: 'ticket' }, period: { from: '', to: '' }, source: 'facts' as const };
    expect(insights.hasData({ ...base, value: 0 })).toBe(false);
    expect(insights.hasData({ ...base, series: [{ at: 'a', value: 0 }, { at: 'b', value: null }] })).toBe(false);
    expect(insights.hasData({ ...base, groups: [{ key: 'P1', value: 2, label: 'P1' }] })).toBe(true);
  });

  it('opens a seeded desk on Service desk overview, the desk’s own before a person’s', () => {
    const row = (key: string, name: string, extra: Partial<DashboardRow> = {}): DashboardRow => ({
      id: `id-${key}`,
      key,
      name,
      description: null,
      personal: false,
      seeded: true,
      version: 1,
      updatedAt: CHECKED,
      widgetCount: 1,
      ...extra,
    });
    const ordered = orderDashboards([
      row('mine', 'My queue', { personal: true, seeded: false }),
      row('sla', 'SLA'),
      row('custom', 'Change board', { seeded: false }),
      row('service-desk', 'Service desk overview'),
      row('teams', 'Teams'),
    ]);
    expect(ordered.map((dashboard) => dashboard.key)).toEqual(['service-desk', 'teams', 'sla', 'custom', 'mine']);
    expect(pickDashboard(ordered, 'sla')?.key).toBe('sla');
    expect(pickDashboard(ordered, 'id-teams')?.key).toBe('teams');
    expect(pickDashboard(ordered, 'gone')?.key).toBe('service-desk');
    expect(dashboardHref(ordered[0]!, true)).toBe('/insights');
    expect(dashboardHref(ordered[2]!, false)).toBe('/insights?dashboard=sla');
  });

  it('names periods and report files by the last day they cover', () => {
    expect(periodLabel({ from: '2026-09-01T00:00:00Z', to: '2026-10-01T00:00:00Z' }, 'en-GB')).toBe('Last 30 days');
    expect(periodLabel({ from: '2026-01-01T00:00:00Z', to: '2026-10-01T00:00:00Z' }, 'en-GB')).toBe('1 Jan 2026 – 30 Sept 2026');
    expect(csvFileName('weekly-review', { periodTo: '2026-10-01T00:00:00.000Z' })).toBe('report-weekly-review-2026-09-30.csv');
    expect(csvHref('run 1')).toBe('/api/proxy/api/v1/analytics/report-runs/run%201/csv');
    expect(insights.rangeFrom('90d')).toBe('90d');
    expect(insights.rangeFrom('forever')).toBe('30d');
  });
});

/* ======================================================================= */

describe('a drawer opened by a table row', () => {
  it('does not push a second history entry when the table already pushed its address', () => {
    let drawer: ReturnType<typeof useDrawer> | null = null;
    function Probe(): ReactNode {
      drawer = useDrawer('metric');
      return null;
    }
    window.history.replaceState(null, '', '/');
    render(<Probe />);
    // What DataTable does before calling onActivate:
    window.history.pushState(null, '', '/?open=metric%3Atickets.created');
    const before = window.history.length;
    const push = vi.spyOn(window.history, 'pushState');
    act(() => drawer!.open('tickets.created'));
    expect(push).not.toHaveBeenCalled();
    expect(window.history.length).toBe(before);
    // …and closing still goes Back, off the drawer.
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    act(() => drawer!.close());
    expect(back).toHaveBeenCalledTimes(1);
  });
});

/* ======================================================================= */

describe('the pages’ stylesheets', () => {
  // Resolved by hand: Vite rewrites `new URL(template, import.meta.url)` as an asset lookup.
  const here = dirname(fileURLToPath(import.meta.url));
  const sheets = ['command-centre/command-centre.css', 'command-centre/shared.css', 'insights/insights.css'].map((path) => ({
    path,
    css: readFileSync(join(here, '..', 'components', path), 'utf8'),
  }));
  const defined = new Set([...Object.keys(structuralVariables()), ...Object.keys(themeVariables('apple'))]);

  it('spend only custom properties the design system emits', () => {
    for (const { path, css } of sheets) {
      const used = [...new Set([...css.matchAll(/var\((--itsm-[a-zA-Z0-9-]+)/g)].map((match) => match[1]!))];
      expect(used.length, path).toBeGreaterThan(3);
      expect(used.filter((variable) => !defined.has(variable)), path).toEqual([]);
    }
  });

  it('add only app- classes, never the design system’s own', () => {
    for (const { path, css } of sheets) {
      const declared = [...css.matchAll(/(?:^|[\s,}])\.([a-zA-Z][\w-]*)/gm)].map((match) => match[1]!);
      expect(declared.filter((name) => !name.startsWith('app-') && !name.startsWith('itsm-')), path).toEqual([]);
      // `itsm-` appears only as a descendant of an app- rule (a DS control placed in an app layout).
      for (const line of css.split('\n').filter((entry) => /^\.itsm-/.test(entry.trim()))) expect(line, path).toBe('');
    }
  });
});
