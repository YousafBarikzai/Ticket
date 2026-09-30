// @vitest-environment jsdom
import { act, forwardRef, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiBudget, DecisionQuestionScore, DecisionRow } from '@itsm/sdk';

vi.mock('server-only', () => ({}));

let search = '';
const router = { refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), forward: vi.fn() };
vi.mock('next/navigation', () => ({
  usePathname: () => '/ai-triage',
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(search),
}));

const calls: string[] = [];
const setSetting = vi.fn(async (key: string, value: unknown) => {
  calls.push(`setting:${key}=${String(value)}`);
  return { settingId: 's1', version: 2 };
});
const setFlag = vi.fn(async (key: string, value: boolean) => {
  calls.push(`flag:${key}=${String(value)}`);
  return { key, value, scopeType: 'tenant' };
});
const setBudget = vi.fn(async (input: { limitPence: number | null; warnPence: number | null }) => ({ ...input, periodKey: '2026-09', spentDisplay: '£1.23', state: 'ok' as const }));
vi.mock('../client/api.js', () => ({
  api: { tenant: { setSetting, setFlag }, observe: { ai: { setBudget } } },
}));

const { ItsmProvider } = await import('@itsm/ui');
const { ModeControl, OffState } = await import('../components/ai-triage/ModeControl.js');
const { BudgetCard } = await import('../components/ai-triage/BudgetCard.js');
const { DecisionsView } = await import('../components/ai-triage/DecisionsView.js');
const { decisionView } = await import('../components/ai-triage/decisions.js');
const { readiness } = await import('../triage.js');
const { cleanupDocument, click, clickAsync, render, type } = await import('./support/render.js');

/**
 * AI triage (SPEC §6.1 `/ai-triage/**`, X-31): the mode is a real control
 * that never changes anything until Apply, writes in the order that never
 * runs a desk in the mode it is leaving, and refuses to pretend when the
 * workspace's AI is off; the budget is edited in pounds with the API's rule
 * said first; the decisions download under a name that says what they are.
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
      usePathname={() => '/ai-triage'}
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
  calls.length = 0;
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
const dialogWith = (words: string): Element | undefined => [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].find((dialog) => text(dialog).includes(words));

async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

function question(overrides: Partial<DecisionQuestionScore> = {}): DecisionQuestionScore {
  return {
    question: 'category',
    scored: 140,
    accuracy: 0.92,
    brier: 0.1,
    calibration: [],
    autoGate: { eligible: true, considered: 240, agreement: 0.97, reason: '97.0% agreement over 240 answers' },
    responses: { accepted: 0, dismissed: 0 },
    applied: { applied: 0, overridden: 0 },
    ...overrides,
  };
}

const questions = [question(), question({ question: 'group', accuracy: 0.92, autoGate: { eligible: false, considered: 50, agreement: null, reason: '50 scored answers at or above 0.9; 200 are needed' } })];

function context(mode: 'off' | 'shadow' | 'suggest' | 'auto', parts: { aiEnabled?: boolean | null; flag?: boolean | null; stored?: 'off' | 'shadow' | 'suggest' | 'auto' | null } = {}) {
  return {
    state: { aiEnabled: true, flag: true, stored: mode, effective: mode, ...parts },
    readiness: readiness({ mode, questions, settled: 140 }),
    suggestAt: 60,
    stepDown: { limit: 0.05, window: 100 },
    settingsHref: '/settings/ai',
  };
}

function choose(label: string): void {
  const radio = [...document.querySelectorAll<HTMLElement>('[role="radio"]')].find((entry) => text(entry) === label)!;
  click(radio);
}

/* ======================================================================= */

describe('the mode control', () => {
  it('changes nothing until Apply, and says what the record shows first', async () => {
    render(
      <Frame>
        <ModeControl context={context('shadow')} canChange />
      </Frame>,
    );
    expect(document.querySelector('[role="radiogroup"]')?.getAttribute('aria-label')).toBe('AI triage mode');
    choose('Suggest');
    const dialog = dialogWith('Switch AI triage to Suggest?')!;
    expect(text(dialog)).toContain('Agents see answers at or above 60% confidence. So far: right 92% of the time on 140 scored tickets.');
    expect(text(dialog)).toContain('Sets the triage mode to Suggest');
    expect(setSetting).not.toHaveBeenCalled();
    // Still on the mode the desk is actually in.
    const checked = document.querySelector('[role="radiogroup"] [aria-checked="true"]');
    expect(text(checked)).toBe('Shadow');
    await clickAsync(buttonNamed(dialog, 'Apply')!);
    await settle();
    expect(calls).toEqual(['setting:ai.decision.triage.mode=suggest']);
    expect(setFlag).not.toHaveBeenCalled();
    expect(router.refresh).toHaveBeenCalled();
  });

  it('writes the mode before turning the triage switch on', async () => {
    render(
      <Frame>
        <ModeControl context={context('off', { flag: false, stored: 'auto' })} canChange />
      </Frame>,
    );
    choose('Shadow');
    const dialog = dialogWith('Turn on AI triage in Shadow?')!;
    expect(text(dialog)).toContain('Turns the triage switch on');
    type(dialog.querySelector('textarea')!, 'Trial starts Monday');
    await clickAsync(buttonNamed(dialog, 'Apply')!);
    await settle();
    expect(calls).toEqual(['setting:ai.decision.triage.mode=shadow', 'flag:ai.decision.triage=true']);
    expect(setSetting).toHaveBeenCalledWith('ai.decision.triage.mode', 'shadow', { reason: 'Trial starts Monday' });
  });

  it('shows the fields’ gates and the step-down rule before Auto', () => {
    render(
      <Frame>
        <ModeControl context={context('suggest')} canChange />
      </Frame>,
    );
    choose('Auto');
    const dialog = dialogWith('Switch AI triage to Auto?')!;
    expect(text(dialog)).toContain('1 of 2 fields have earned auto-apply.');
    expect(text(dialog)).toContain('Category: Earned');
    expect(text(dialog)).toContain('Team: Not yet (needs 150 more)');
    expect(text(dialog)).toContain('more than 5% of the last 100 values it set');
  });

  it('offers no Apply when the workspace’s AI is off, and says where to turn it on', () => {
    render(
      <Frame>
        <ModeControl context={context('off', { aiEnabled: false, stored: 'off' })} canChange />
      </Frame>,
    );
    choose('Suggest');
    const dialog = dialogWith('Turn on AI triage in Suggest?')!;
    expect(buttonNamed(dialog, 'Apply')).toBeUndefined();
    expect(text(dialog)).toContain('AI is switched off for this whole workspace');
    expect(dialog.querySelector('a[href="/settings/ai"]')).not.toBeNull();
  });

  it('writes nothing on Cancel', () => {
    render(
      <Frame>
        <ModeControl context={context('suggest')} canChange />
      </Frame>,
    );
    choose('Off');
    click(buttonNamed(dialogWith('Turn off AI triage?')!, 'Cancel')!);
    expect(setSetting).not.toHaveBeenCalled();
    expect(dialogWith('Turn off AI triage?')).toBeUndefined();
  });

  it('shows the mode in words, with no control, to someone who may not change it', () => {
    render(
      <Frame>
        <ModeControl context={context('suggest')} canChange={false} />
      </Frame>,
    );
    expect(document.querySelector('[role="radiogroup"]')).toBeNull();
    expect(text(document.body)).toContain('Suggest');
    expect(text(document.body)).toContain('Agents see confident answers on the ticket');
  });

  it('starts a desk in Shadow from the empty state, behind the same confirmation', async () => {
    render(
      <Frame>
        <OffState context={context('off', { flag: false, stored: 'off' })} canChange />
      </Frame>,
    );
    expect(text(document.body)).toContain('AI triage is off');
    await clickAsync(buttonNamed(document, 'Turn on in Shadow')!);
    const dialog = dialogWith('Turn on AI triage in Shadow?')!;
    await clickAsync(buttonNamed(dialog, 'Apply')!);
    await settle();
    expect(calls).toEqual(['setting:ai.decision.triage.mode=shadow', 'flag:ai.decision.triage=true']);
  });
});

/* ======================================================================= */

describe('the budget', () => {
  const budget: AiBudget = { periodKey: '2026-09', limitPence: 25_000, warnPence: 20_000, spentMicros: '12300000000', spentDisplay: '£123.00', state: 'ok' };

  it('shows the spend against the cap and the warning line', () => {
    render(
      <Frame>
        <BudgetCard budget={budget} canEdit={false} locale="en-GB" />
      </Frame>,
    );
    const meter = document.querySelector('[role="meter"]')!;
    expect(meter.getAttribute('aria-valuetext')).toMatch(/£123\.00 of £250\.00/);
    expect(text(document.body)).toContain('Administrators are told at £200.00; calls stop at £250.00.');
    expect(buttonNamed(document, 'Edit budget')).toBeUndefined();
  });

  it('says plainly when there is no cap, and when the cap is reached', () => {
    render(
      <Frame>
        <BudgetCard budget={{ ...budget, limitPence: null, warnPence: null }} canEdit={false} locale="en-GB" />
      </Frame>,
    );
    expect(document.querySelector('[role="meter"]')).toBeNull();
    expect(text(document.body)).toContain('No monthly cap: spend is counted and never refused.');
    cleanupDocument();
    render(
      <Frame>
        <BudgetCard budget={{ ...budget, state: 'blocked', spentMicros: '25000000000', spentDisplay: '£250.00' }} canEdit={false} locale="en-GB" />
      </Frame>,
    );
    expect(text(document.body)).toContain('Budget reached');
    expect(text(document.body)).toContain('AI calls are refused until the month ends or the cap is raised.');
  });

  it('edits the lines in pounds, refusing a warning above the cap before asking the API', async () => {
    render(
      <Frame>
        <BudgetCard budget={budget} canEdit locale="en-GB" />
      </Frame>,
    );
    await clickAsync(buttonNamed(document, 'Edit budget')!);
    const dialog = dialogWith('Edit AI budget')!;
    const [limit, warn] = [dialog.querySelector<HTMLInputElement>('input[name="limit"]')!, dialog.querySelector<HTMLInputElement>('input[name="warn"]')!];
    expect(limit.value).toBe('250.00');
    type(warn, '300');
    await clickAsync(buttonNamed(dialog, 'Save budget')!);
    expect(setBudget).not.toHaveBeenCalled();
    expect(text(dialog)).toContain('a warning above it would never be reached');
    type(warn, '');
    type(limit, '400');
    await clickAsync(buttonNamed(dialog, 'Save budget')!);
    await settle();
    expect(setBudget).toHaveBeenCalledWith({ limitPence: 40_000, warnPence: null });
  });
});

/* ======================================================================= */

describe('the decisions', () => {
  const row: DecisionRow = {
    id: 'd1',
    purpose: 'triage',
    subjectType: 'ticket',
    subjectId: 't-1',
    mode: 'suggest',
    outcome: 'suggested',
    provider: 'jev',
    model: 'jev-latest',
    latencyMs: 280,
    costMicros: '0',
    costDisplay: '£0.00',
    answers: { category: { value: 'Hardware', confidence: 0.83 } },
    attempts: [
      { provider: 'anthropic', outcome: 'skipped', reason: 'residency', model: null, ms: 0 },
      { provider: 'jev', outcome: 'answered', reason: null, model: 'jev-latest', ms: 280 },
    ],
    createdAt: '2026-09-30T08:00:00.000Z',
  };
  const view = { ...decisionView(row, new Map([['t-1', { number: 'INC-7', title: 'Printer offline' }]])), ticketHref: 'https://workbench.example/tickets/INC-7' };

  it('downloads the rows as a CSV under the name it was given', async () => {
    const created: string[] = [];
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:decisions'), revokeObjectURL: vi.fn() }));
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      created.push(`${this.download}|${this.href}`);
    });
    render(
      <Frame>
        <DecisionsView rows={[view]} days={30} capped={false} fileName="ai-triage-decisions-acme-last-30-days-2026-09-30.csv" />
      </Frame>,
    );
    click([...document.querySelectorAll('button')].find((button) => text(button).startsWith('Download CSV'))!);
    expect(created).toEqual(['ai-triage-decisions-acme-last-30-days-2026-09-30.csv|blob:decisions']);
    const blob = (URL.createObjectURL as unknown as { mock: { calls: [Blob][] } }).mock.calls[0]![0];
    expect(blob.type).toBe('text/csv;charset=utf-8');
    clicked.mockRestore();
  });

  it('opens a decision with each answer’s confidence and who was passed over, in words', () => {
    search = 'open=decision:d1';
    render(
      <Frame>
        <DecisionsView rows={[view]} days={30} capped={false} fileName="x.csv" />
      </Frame>,
    );
    const sheet = dialogWith('Who was asked, in order')!;
    expect(text(sheet)).toContain('INC-7 · triage');
    expect(text(sheet)).toContain('Hardware');
    expect(sheet.querySelector('[role="meter"]')?.getAttribute('aria-valuetext')).toMatch(/^83%/);
    expect(text(sheet)).toContain('Claude');
    expect(text(sheet)).toContain('outside this workspace’s allowed regions');
    expect(text(sheet)).not.toContain('jev-latest');
    expect(sheet.querySelector('a[href="https://workbench.example/tickets/INC-7"]')).not.toBeNull();
  });

  it('says when older decisions in the range are not listed', () => {
    render(
      <Frame>
        <DecisionsView rows={[view]} days={90} capped fileName="x.csv" />
      </Frame>,
    );
    expect(text(document.body)).toContain('The newest 100 decisions are listed. Older ones in the last 90 days aren’t');
  });
});
