// @vitest-environment jsdom
import { act, forwardRef, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { structuralVariables, themeVariables } from '@itsm/ui/tokens';
import type { SettingType } from '@itsm/sdk';

vi.mock('server-only', () => ({}));

let search = '';
const router = { refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), forward: vi.fn() };
vi.mock('next/navigation', () => ({
  usePathname: () => '/settings',
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(search),
}));

const setSetting = vi.fn(async (_key: string, _value: unknown, _options?: unknown) => ({ settingId: 's1', version: 2 }));
const setFlag = vi.fn(async (key: string, value: boolean) => ({ key, value, scopeType: 'tenant' }));
const settingVersions = vi.fn(async (_key: string) => [
  { version: 2, value: 5, reason: 'Shorter queue', publishedAt: '2026-09-03T09:00:00Z', publishedBy: 'u-1' },
  { version: 1, value: 10, reason: null, publishedAt: '2026-09-01T09:00:00Z', publishedBy: 'u-1' },
]);
const rollbackSetting = vi.fn(async (_key: string, toVersion: number) => ({ version: 3, restoredFrom: toVersion }));
const users = vi.fn(async () => [{ id: 'u-1', displayName: 'Alex Administrator', email: 'alex@example.com' }]);
const setSoftLimit = vi.fn(async (meter: string, soft: number | null) => ({ meter, planKey: 'starter', soft, hard: null }));
const setModuleEnabled = vi.fn(async (moduleId: string, enabled: boolean) => ({ moduleId, enabled }));
vi.mock('../client/api.js', () => ({
  api: { tenant: { setSetting, setFlag, settingVersions, rollbackSetting, users, setSoftLimit, setModuleEnabled } },
}));

const { ItsmProvider } = await import('@itsm/ui');
const catalogue = await import('../settings/catalogue.js');
const { SettingRow, draftToValue } = await import('../components/settings/SettingRow.js');
const { FlagRow } = await import('../components/settings/FlagRow.js');
const { GeneralView } = await import('../components/settings/GeneralView.js');
const { UsageView } = await import('../components/settings/UsageView.js');
const { ModulesView } = await import('../components/settings/ModulesView.js');
const usage = await import('../components/settings/usage.js');
const data = await import('../app/(console)/(admin)/settings/data.js');
const { cleanupDocument, click, clickAsync, render, type } = await import('./support/render.js');

/**
 * Settings (SPEC §6.1 `/settings/**`, §6.4, X-11, F3, F30): the catalogue
 * that names and arranges every setting, rows that edit by type and check
 * what the API would refuse first, kill switches that ask and keep their
 * state, flags that show what the desk really gets and never stick, the
 * search across tabs (labels, keys, values, descriptions), history with
 * restore, and the usage meters' warning lines.
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
      usePathname={() => '/settings'}
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
  window.history.replaceState(null, '', '/settings');
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
const buttonNamed = (root: ParentNode, name: string | RegExp): HTMLButtonElement | undefined =>
  [...root.querySelectorAll('button')].find((button) => (typeof name === 'string' ? text(button) === name : name.test(text(button)))) as HTMLButtonElement | undefined;
const dialogWith = (words: string): Element | undefined => [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].find((dialog) => text(dialog).includes(words));

async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

type Item = import('../components/settings/types.js').SettingItem;
const INT = (min: number, max: number): SettingType => ({ kind: 'number', int: true, min, max });

function item(key: string, type: SettingType, value: unknown, defaultValue: unknown = value, overrides: Partial<Item> = {}): Item {
  const entry = catalogue.settingEntry(key);
  return {
    key,
    label: entry.label,
    description: 'What it does.',
    group: entry.group,
    type,
    value,
    default: defaultValue,
    changed: catalogue.isChanged(value, defaultValue),
    note: null,
    locked: false,
    ...overrides,
  };
}

/* ======================================================================= */

describe('the catalogue', () => {
  it('names every declared setting, puts it in a SPEC section, and gives an unknown key a readable label', () => {
    const declared = [
      'auth.session.idleMinutes', 'auth.session.absoluteHours', 'auth.requiredAcr', 'channel.email.maxPerSenderPerHour', 'channel.email.transport',
      'channel.chat.maxBytes', 'ticket.autoClose.days', 'ticket.reopen.windowDays', 'ticket.defaultPriority', 'rules.test.sampleSize',
      'workflow.maxActiveRuns', 'incident.updateIntervalMinutes', 'incident.reviewDueDays', 'problem.recurrenceThreshold', 'change.retrospectiveDueHours',
      'ai.tone', 'ai.language', 'ai.retainDays', 'ai.decision.triage.mode', 'ai.decision.autoThreshold', 'ai.decision.suggestThreshold',
      'knowledge.reviewIntervalDays', 'knowledge.requireApprovalToPublish', 'cmdb.impactDepth', 'assets.warrantyWarningDays', 'contracts.noticeWarningDays',
      'notification.email.enabled', 'approval.reminder.hours', 'workload.defaultCapacity', 'workload.defaultStrategy',
    ];
    expect(declared).toHaveLength(30);
    for (const key of declared) expect(catalogue.SETTINGS[key], key).toBeDefined();
    const sections = new Set(catalogue.GENERAL_GROUPS.map((group) => group.id));
    for (const key of declared) {
      const group = catalogue.settingEntry(key).group;
      expect(group === 'ai' || sections.has(group), key).toBe(true);
    }
    expect(catalogue.settingEntry('workflow.retry.maxAttempts')).toEqual({ label: 'Max attempts', group: 'workflows' });
    expect(catalogue.settingEntry('newthing.someValue').group).toBe('other');
  });

  it('chooses a control from the type, and the catalogue where the type alone would choose worse', () => {
    expect(catalogue.controlFor('knowledge.requireApprovalToPublish', { kind: 'boolean' })).toBe('switch');
    expect(catalogue.controlFor('ticket.defaultPriority', { kind: 'enum', options: ['P1', 'P2', 'P3', 'P4'] })).toBe('segmented');
    expect(catalogue.controlFor('workload.defaultStrategy', { kind: 'enum', options: ['round_robin', 'least_loaded', 'skill'] })).toBe('select');
    expect(catalogue.controlFor('auth.session.idleMinutes', INT(5, 1440))).toBe('duration');
    expect(catalogue.controlFor('ai.decision.autoThreshold', { kind: 'number', int: false, min: 0, minExclusive: true, max: 1 })).toBe('percent');
    expect(catalogue.controlFor('ticket.autoClose.days', INT(1, 90))).toBe('number');
    expect(catalogue.controlFor('channel.email.transport', { kind: 'string', min: 1 })).toBe('select');
    expect(catalogue.controlFor('ai.language', { kind: 'string', min: 2, max: 40 })).toBe('text');
    expect(catalogue.controlFor('incident.updateIntervalMinutes', { kind: 'record', keys: ['SEV1', 'SEV2'], value: INT(5, 1440) })).toBe('fields');
    expect(catalogue.controlFor('problem.recurrenceThreshold', { kind: 'object', fields: { tickets: INT(2, 500), withinDays: INT(1, 365) } })).toBe('fields');
    // Anything the page cannot draw a form for is shown, not edited (ADR-0049: no JSON text box).
    expect(catalogue.controlFor('x.y', { kind: 'json' })).toBe('readonly');
    expect(catalogue.controlFor('x.y', { kind: 'record', value: { kind: 'string' } })).toBe('readonly');
  });

  it('says values in words, and keeps an unknown current choice selectable', () => {
    expect(catalogue.valueText('ticket.autoClose.days', INT(1, 90), 7)).toBe('7 days');
    expect(catalogue.valueText('ticket.autoClose.days', INT(1, 90), 1)).toBe('1 day');
    expect(catalogue.valueText('auth.session.idleMinutes', INT(5, 1440), 90)).toBe('1 h 30 min');
    expect(catalogue.valueText('ai.decision.autoThreshold', undefined, 0.9)).toBe('90%');
    expect(catalogue.valueText('workload.defaultStrategy', undefined, 'least_loaded')).toBe('Least loaded first');
    expect(catalogue.valueText('notification.email.enabled', undefined, false)).toBe('Off');
    expect(catalogue.valueText('auth.requiredAcr', undefined, '')).toBe('Not set');
    expect(catalogue.valueText('incident.updateIntervalMinutes', { kind: 'record', keys: ['SEV1', 'SEV2'], value: INT(5, 1440) }, { SEV1: 30, SEV2: 60 })).toBe(
      'Severity 1: 30 minutes · Severity 2: 60 minutes',
    );
    expect(catalogue.choicesFor('channel.email.transport', { kind: 'string', min: 1 }, 'ses').map((choice) => choice.value)).toEqual([
      'development',
      'postmark',
      'microsoft-graph',
      'ses',
    ]);
  });

  it('calls a value changed only when it differs from the default, whatever the key order', () => {
    expect(catalogue.isChanged(7, 7)).toBe(false);
    expect(catalogue.isChanged(5, 7)).toBe(true);
    expect(catalogue.isChanged({ tickets: 5, withinDays: 30 }, { withinDays: 30, tickets: 5 })).toBe(false);
  });

  it('checks numbers, percentages and text by the API’s own rules', () => {
    expect(catalogue.numberProblem(INT(1, 90), 91)).toBe('Enter 90 or less.');
    expect(catalogue.numberProblem(INT(1, 90), 0)).toBe('Enter 1 or more.');
    expect(catalogue.numberProblem(INT(1, 90), 2.5)).toBe('Enter a whole number.');
    expect(catalogue.numberProblem(INT(1, 90), null)).toBe('Enter a number.');
    expect(catalogue.numberProblem(INT(1, 90), 30)).toBeNull();
    const confidence: SettingType = { kind: 'number', int: false, min: 0, minExclusive: true, max: 1 };
    expect(catalogue.percentProblem(confidence, 0)).toBe('Enter more than 0%.');
    expect(catalogue.percentProblem(confidence, 101)).toBe('Enter 100% or less.');
    expect(catalogue.percentProblem(confidence, 75)).toBeNull();
    expect(catalogue.textProblem({ kind: 'string', min: 2, max: 40 }, 'E')).toBe('Enter at least 2 characters.');
    expect(draftToValue({ key: 'ai.decision.autoThreshold', type: confidence }, 'percent', 85)).toEqual({ ok: true, value: 0.85 });
    expect(draftToValue({ key: 'problem.recurrenceThreshold', type: { kind: 'object', fields: { tickets: INT(2, 500), withinDays: INT(1, 365) } } }, 'fields', { tickets: 1, withinDays: 30 })).toEqual({
      ok: false,
      problem: 'Enter 2 or more.',
      field: 'tickets',
    });
  });

  it('finds settings and flags by label, key, value and description, across tabs', () => {
    const index = catalogue.searchIndex(
      [
        { key: 'workload.defaultStrategy', description: 'How work is shared out.', value: 'least_loaded', default: 'least_loaded', type: { kind: 'enum', options: ['least_loaded'] } },
        { key: 'ai.tone', description: 'How a drafted reply should read.', value: 'formal', default: 'plain', type: { kind: 'enum', options: ['plain', 'formal'] } },
        { key: 'channel.email.transport', description: 'Which email transport (OD-03).', value: 'development', default: 'development', type: { kind: 'string' } },
      ],
      [{ key: 'rules.engine.enabled', module: 'MOD-06', description: 'Evaluate business rules.', value: true, default: true }],
    );
    const find = (query: string) => index.filter((entry) => catalogue.matches(entry, query)).map((entry) => entry.key);
    expect(find('least loaded')).toEqual(['workload.defaultStrategy']);
    expect(find('ai.tone')).toEqual(['ai.tone']);
    expect(find('FORMAL')).toEqual(['ai.tone']);
    expect(find('email')).toEqual(['channel.email.transport']);
    expect(find('business rules')).toEqual(['rules.engine.enabled']);
    // The engineer's note in the module's description is replaced by the catalogue's words.
    expect(index.find((entry) => entry.key === 'channel.email.transport')?.description).not.toContain('OD-03');
    expect(index.find((entry) => entry.key === 'ai.tone')).toMatchObject({ tab: 'ai', changed: true });
    expect(index.find((entry) => entry.key === 'rules.engine.enabled')).toMatchObject({ tab: 'features', kind: 'flag', changed: false });
    expect(catalogue.hrefFor({ kind: 'setting', key: 'ai.tone', tab: 'ai' }, ' tone ', true)).toBe('/settings/ai?q=tone&changed=1#setting-ai-tone');
  });

  it('words flags’ owners and expiry, and marks the two kill switches', () => {
    expect(catalogue.ownerText('catalogue-workflow-squad')).toBe('Catalogue workflow squad');
    expect(catalogue.ownerText('ai')).toBe('AI');
    expect(catalogue.expiryText('permanent')).toBeNull();
    expect(catalogue.expiryText('PH-3')).toBe('Temporary · review by phase 3');
    expect(catalogue.flagEntry('ai.enabled').kill?.title).toBe('Turn off AI for everyone?');
    expect(catalogue.flagEntry('rules.engine.enabled').kill?.tone).toBe('danger');
    expect(catalogue.flagEntry('ai.capability.reply-draft').kill).toBeUndefined();
  });
});

/* ======================================================================= */

describe('a setting row', () => {
  it('saves a changed number once it reads as valid, with the note, and offers Undo', async () => {
    render(
      <Frame>
        <SettingRow item={item('ticket.autoClose.days', INT(1, 90), 7)} canManage />
      </Frame>,
    );
    const row = document.getElementById('setting-ticket-autoClose-days')!;
    expect(buttonNamed(row, 'Save')).toBeUndefined();
    const input = row.querySelector<HTMLInputElement>('input')!;
    type(input, '120');
    await clickAsync(buttonNamed(row, 'Save')!);
    expect(text(row.querySelector('[role="alert"]'))).toBe('Enter 90 or less.');
    expect(setSetting).not.toHaveBeenCalled();

    type(input, '5');
    click(buttonNamed(row, 'Add a note')!);
    type(row.querySelector<HTMLInputElement>('input[placeholder="Why it changed (optional)"]')!, 'Queue is too long');
    await clickAsync(buttonNamed(row, 'Save')!);
    await settle();
    expect(setSetting).toHaveBeenCalledWith('ticket.autoClose.days', 5, { reason: 'Queue is too long' });
    expect(router.refresh).toHaveBeenCalled();
  });

  it('puts the value back on Cancel and on Escape, and saves nothing', () => {
    render(
      <Frame>
        <SettingRow item={item('ticket.autoClose.days', INT(1, 90), 7)} canManage />
      </Frame>,
    );
    const row = document.getElementById('setting-ticket-autoClose-days')!;
    const input = row.querySelector<HTMLInputElement>('input')!;
    type(input, '9');
    click(buttonNamed(row, 'Cancel')!);
    expect(input.value).toBe('7');
    type(input, '9');
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(input.value).toBe('7');
    expect(setSetting).not.toHaveBeenCalled();
  });

  it('edits a confidence as a percentage and sends the 0–1 value', async () => {
    const confidence: SettingType = { kind: 'number', int: false, min: 0, minExclusive: true, max: 1 };
    render(
      <Frame>
        <SettingRow item={item('ai.decision.suggestThreshold', confidence, 0.6)} canManage />
      </Frame>,
    );
    const row = document.getElementById('setting-ai-decision-suggestThreshold')!;
    const input = row.querySelector<HTMLInputElement>('input')!;
    expect(input.value).toBe('60');
    type(input, '70');
    await clickAsync(buttonNamed(row, 'Save')!);
    await settle();
    expect(setSetting).toHaveBeenCalledWith('ai.decision.suggestThreshold', 0.7, {});
  });

  it('labels each part of a structured value and checks each one', async () => {
    const type_: SettingType = { kind: 'object', fields: { tickets: INT(2, 500), withinDays: INT(1, 365) } };
    render(
      <Frame>
        <SettingRow item={item('problem.recurrenceThreshold', type_, { tickets: 5, withinDays: 30 })} canManage />
      </Frame>,
    );
    const row = document.getElementById('setting-problem-recurrenceThreshold')!;
    expect(text(row)).toContain('Tickets in one category');
    expect(text(row)).toContain('Within (days)');
    const [tickets] = [...row.querySelectorAll<HTMLInputElement>('input')];
    type(tickets!, '8');
    await clickAsync(buttonNamed(row, 'Save')!);
    await settle();
    expect(setSetting).toHaveBeenCalledWith('problem.recurrenceThreshold', { tickets: 8, withinDays: 30 }, {});
  });

  it('asks before a switch that stops something for everyone, and keeps its state until answered', async () => {
    render(
      <Frame>
        <SettingRow item={item('notification.email.enabled', { kind: 'boolean' }, true)} canManage />
      </Frame>,
    );
    const toggle = document.querySelector<HTMLElement>('#setting-notification-email-enabled [role="switch"]')!;
    click(toggle);
    await settle(20);
    const dialog = dialogWith('Stop sending email notifications?')!;
    expect(dialog).toBeDefined();
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    await clickAsync(buttonNamed(dialog, 'Cancel')!);
    await settle();
    expect(setSetting).not.toHaveBeenCalled();
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('shows the value in words, with no control, to someone who may not change it', () => {
    render(
      <Frame>
        <SettingRow item={item('ticket.autoClose.days', INT(1, 90), 5, 7, { note: 'Changed by Alex Administrator · 3 Sept 2026' })} canManage={false} />
      </Frame>,
    );
    const row = document.getElementById('setting-ticket-autoClose-days')!;
    expect(row.querySelector('input')).toBeNull();
    expect(text(row)).toContain('5 days');
    expect(text(row)).toContain('Changed');
    expect(text(row)).toContain('Changed by Alex Administrator · 3 Sept 2026');
  });

  it('shows a structured value it cannot draw as JSON, changed through the API', () => {
    render(
      <Frame>
        <SettingRow item={item('x.mapping', { kind: 'json' }, { a: 1 })} canManage />
      </Frame>,
    );
    const row = document.getElementById('setting-x-mapping')!;
    expect(row.querySelector('input, textarea')).toBeNull();
    expect(text(row)).toContain('Changed through the API.');
  });

  it('resyncs from the server after a save, so a control never sticks (F30)', async () => {
    const { root } = render(
      <Frame>
        <SettingRow item={item('ticket.defaultPriority', { kind: 'enum', options: ['P1', 'P2', 'P3', 'P4'] }, 'P3')} canManage />
      </Frame>,
    );
    const radio = (label: string) => [...document.querySelectorAll<HTMLElement>('[role="radio"]')].find((entry) => text(entry) === label)!;
    act(() => {
      radio('P2').focus();
    });
    await act(async () => {
      radio('P2').dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    });
    await settle();
    expect(setSetting).toHaveBeenCalledWith('ticket.defaultPriority', 'P2', {});
    expect(radio('P2').getAttribute('aria-checked')).toBe('true');
    // Saved and undone before the page came back: the next render brings P3
    // again — the same value as before — and the row follows it.
    act(() => {
      root.render(
        <Frame>
          <SettingRow item={item('ticket.defaultPriority', { kind: 'enum', options: ['P1', 'P2', 'P3', 'P4'] }, 'P3')} canManage />
        </Frame>,
      );
    });
    expect(radio('P3').getAttribute('aria-checked')).toBe('true');
  });
});

/* ======================================================================= */

describe('a feature flag', () => {
  type Flag = import('../components/settings/types.js').FlagItem;
  function flag(key: string, value: boolean, overrides: Partial<Flag> = {}): Flag {
    const entry = catalogue.flagEntry(key);
    return { key, label: entry.label, description: '', group: entry.group, value, default: true, owner: 'AI', expiry: null, changed: false, ...overrides };
  }

  it('asks before the AI kill switch turns off, keeps aria-checked until confirmed, then writes { value }', async () => {
    render(
      <Frame>
        <FlagRow item={flag('ai.enabled', true)} canManage />
      </Frame>,
    );
    const toggle = document.querySelector<HTMLElement>('#flag-ai-enabled [role="switch"]')!;
    click(toggle);
    await settle(20);
    const dialog = dialogWith('Turn off AI for everyone?')!;
    expect(text(dialog)).toContain('Every AI feature stops at once');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(setFlag).not.toHaveBeenCalled();
    await clickAsync(buttonNamed(dialog, 'Turn off AI')!);
    await settle();
    expect(setFlag).toHaveBeenCalledWith('ai.enabled', false);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('moves an ordinary flag at once, and back with the reason when the API refuses', async () => {
    setFlag.mockRejectedValueOnce(Object.assign(new Error('refused'), { status: 403 }));
    render(
      <Frame>
        <FlagRow item={flag('ticket.customFields', false, { default: false })} canManage />
      </Frame>,
    );
    const toggle = document.querySelector<HTMLElement>('#flag-ticket-customFields [role="switch"]')!;
    click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    await settle();
    expect(setFlag).toHaveBeenCalledWith('ticket.customFields', true);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(document.querySelector('#flag-ticket-customFields [role="alert"]')).not.toBeNull();
  });

  it('shows what the desk gets in words, without a switch, to someone without admin.flag.manage', () => {
    render(
      <Frame>
        <FlagRow item={flag('rules.engine.enabled', true)} canManage={false} />
      </Frame>,
    );
    const row = document.getElementById('flag-rules-engine-enabled')!;
    expect(row.querySelector('[role="switch"]')).toBeNull();
    expect(text(row)).toContain('On');
    expect(text(row)).toContain('Default: on');
  });

  it('leaves the triage switch to AI triage, which owns the mode', () => {
    render(
      <Frame>
        <FlagRow item={flag('ai.decision.triage', false, { default: false })} canManage />
      </Frame>,
    );
    const row = document.getElementById('flag-ai-decision-triage')!;
    expect(row.querySelector('[role="switch"]')).toBeNull();
  });
});

/* ======================================================================= */

describe('the search', () => {
  const items = [
    item('ticket.autoClose.days', INT(1, 90), 7),
    item('channel.email.transport', { kind: 'string', min: 1 }, 'development'),
    item('workload.defaultStrategy', { kind: 'enum', options: ['round_robin', 'least_loaded', 'skill'] }, 'round_robin', 'least_loaded'),
  ];
  const index = catalogue.searchIndex(
    [...items.map((entry) => ({ key: entry.key, description: entry.description, value: entry.value, default: entry.default, type: entry.type })), { key: 'ai.tone', description: 'How a drafted reply should read.', value: 'plain', default: 'plain', type: { kind: 'enum', options: ['plain'] } as SettingType }],
    [{ key: 'ticket.customFields', module: 'MOD-04', description: 'Custom fields.', value: false, default: false }],
  );
  const view = (initial: { query: string; changedOnly: boolean }, tabs: ('general' | 'features' | 'ai')[] = ['general', 'features', 'ai']) =>
    render(
      <Frame>
        <GeneralView items={items} index={index} initial={initial} tabs={tabs} canManage reachable={[]} />
      </Frame>,
    );

  it('reads ?q= and shows only matching rows, in their sections', () => {
    view({ query: 'email', changedOnly: false });
    expect(document.getElementById('setting-channel-email-transport')).not.toBeNull();
    expect(document.getElementById('setting-ticket-autoClose-days')).toBeNull();
    expect(text(document.querySelector('[role="status"]'))).toBe('1 setting matches');
    expect([...document.querySelectorAll('h2')].map(text)).toContain('Email & chat');
  });

  it('offers matches on other tabs as links that keep the words and name the row', () => {
    view({ query: 'reply', changedOnly: false });
    const link = document.querySelector<HTMLAnchorElement>('.app-SettingsElsewhere a')!;
    expect(text(link)).toBe('Reply tone');
    expect(link.getAttribute('href')).toBe('/settings/ai?q=reply#setting-ai-tone');
  });

  it('never offers a tab the person cannot open', () => {
    view({ query: 'reply', changedOnly: false }, ['general']);
    expect(document.querySelector('.app-SettingsElsewhere')).toBeNull();
    expect(text(document.body)).toContain('No settings here match');
  });

  it('filters to what differs from the default, and writes the filters to the address', async () => {
    view({ query: '', changedOnly: false });
    const toggle = buttonNamed(document, 'Changed from default')!;
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(window.location.search).toBe('?changed=1');
    expect(document.getElementById('setting-workload-defaultStrategy')).not.toBeNull();
    expect(document.getElementById('setting-ticket-autoClose-days')).toBeNull();
  });
});

/* ======================================================================= */

describe('a setting’s history', () => {
  it('lists versions newest first with who and why, and restores one after asking', async () => {
    search = 'open=setting:ticket.autoClose.days';
    window.history.replaceState(null, '', '/settings?open=setting:ticket.autoClose.days');
    render(
      <Frame>
        <GeneralView items={[item('ticket.autoClose.days', INT(1, 90), 5, 7)]} index={[]} initial={{ query: '', changedOnly: false }} tabs={['general']} canManage reachable={[]} />
      </Frame>,
    );
    await settle(10);
    const sheet = dialogWith('Every version, newest first.')!;
    expect(settingVersions).toHaveBeenCalledWith('ticket.autoClose.days');
    expect(text(sheet)).toContain('Version 2');
    expect(text(sheet)).toContain('“Shorter queue”');
    expect(text(sheet)).toContain('By Alex Administrator');
    expect(text(sheet)).toContain('Default: 7 days');
    // The version in force has no Restore; the older one does, after a confirmation.
    expect(buttonNamed(sheet, 'Restore version 2')).toBeUndefined();
    click(buttonNamed(sheet, 'Restore version 1')!);
    await settle(10);
    const confirm = dialogWith('Restore version 1?')!;
    expect(text(confirm)).toContain('goes back to 10 days');
    await clickAsync(buttonNamed(confirm, 'Restore')!);
    await settle();
    expect(rollbackSetting).toHaveBeenCalledWith('ticket.autoClose.days', 1, 'Restored version 1');
  });
});

/* ======================================================================= */

describe('usage and plan', () => {
  it('writes meters in words: the period, the lines, GB for storage', () => {
    const storage = usage.meterView(
      { meter: 'storage', description: 'Attachments kept.', unit: 'bytes', shape: 'live', period: 'live', value: 2 * usage.GB, display: '2 GB', state: 'ok', soft: 8 * usage.GB, hard: 10 * usage.GB },
      'en-GB',
    );
    expect(storage).toMatchObject({ label: 'Storage', period: 'Now', lines: 'The plan stops at 10 GB. Administrators are warned at 8 GB.' });
    const tickets = usage.meterView(
      { meter: 'tickets', description: '', unit: 'tickets', shape: 'counted', period: '2026-09', value: 10, display: '10 tickets', state: 'warned', soft: null, hard: null },
      'en-GB',
    );
    expect(tickets).toMatchObject({ label: 'Tickets this month', period: 'September 2026', lines: 'The plan sets no limit. No warning line.' });
    expect(usage.softProblem({ unit: 'people', hard: 50 }, 60)).toBe('The plan stops at 50, so a warning above it would never arrive. Choose something lower.');
    expect(usage.softProblem({ unit: 'people', hard: 50 }, 2.5)).toBe('Enter a whole number.');
    expect(usage.softProblem({ unit: 'bytes', hard: 10 * usage.GB }, 9.5)).toBeNull();
  });

  it('moves the warning line in the meter’s own units, and refuses one above the limit first', async () => {
    const meter = usage.meterView(
      { meter: 'storage', description: '', unit: 'bytes', shape: 'live', period: 'live', value: usage.GB, display: '1 GB', state: 'ok', soft: 8 * usage.GB, hard: 10 * usage.GB },
      'en-GB',
    );
    render(
      <Frame>
        <UsageView meters={[meter]} canEdit locale="en-GB" />
      </Frame>,
    );
    const input = document.querySelector<HTMLInputElement>('.app-UsageMeter__warn input')!;
    expect(input.value).toBe('8');
    type(input, '12');
    await clickAsync(buttonNamed(document, 'Save')!);
    expect(text(document.querySelector('.app-UsageMeter__warn'))).toContain('The plan stops at 10 GB');
    expect(setSoftLimit).not.toHaveBeenCalled();
    type(input, '9');
    await clickAsync(buttonNamed(document, 'Save')!);
    await settle();
    expect(setSoftLimit).toHaveBeenCalledWith('storage', 9 * usage.GB);
  });
});

/* ======================================================================= */

describe('modules', () => {
  const rows = [
    { id: '1', moduleId: 'MOD-08-E1', version: '1', enabled: true, seededAt: null, installedAt: '', updatedAt: '', name: 'Major incident management', phase: null, optional: true, dependsOn: ['MOD-04'] },
    { id: '2', moduleId: 'MOD-23', version: '1', enabled: true, seededAt: null, installedAt: '', updatedAt: '', name: 'Status page', phase: null, optional: true, dependsOn: ['MOD-08-E1'] },
    { id: '3', moduleId: 'MOD-04', version: '1', enabled: true, seededAt: null, installedAt: '', updatedAt: '', name: 'Ticket and interaction core', phase: null, optional: false, dependsOn: [] },
  ];

  it('says which modules another is built on, and which it needs that are off', () => {
    const views = data.moduleViews(rows);
    expect(views.find((view) => view.id === 'MOD-08-E1')?.neededBy).toEqual(['Status page']);
    expect(views.find((view) => view.id === 'MOD-23')?.neededBy).toEqual([]);
    expect(data.moduleViews([{ ...rows[0]!, enabled: false }, rows[1]!]).find((view) => view.id === 'MOD-23')?.needsOff).toEqual(['Major incident management']);
  });

  it('offers a switch only where the API would let it turn off, and asks first', async () => {
    render(
      <Frame>
        <ModulesView modules={data.moduleViews(rows)} />
      </Frame>,
    );
    const switches = [...document.querySelectorAll<HTMLElement>('[role="switch"]')];
    expect(switches).toHaveLength(1);
    expect(text(document.body)).toContain('Can’t be turned off while Status page is built on it.');
    click(switches[0]!);
    await settle(20);
    const dialog = dialogWith('Turn off Status page?')!;
    await clickAsync(buttonNamed(dialog, 'Turn off')!);
    await settle();
    expect(setModuleEnabled).toHaveBeenCalledWith('MOD-23', false);
  });
});

/* ======================================================================= */

describe('the pages', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const page = (path: string) => readFileSync(join(here, '..', 'app', '(console)', '(admin)', 'settings', path), 'utf8');

  it('gates flag switches on admin.flag.manage and settings on admin.setting.manage (F3)', () => {
    expect(page('features/page.tsx')).toContain("holds(me, 'admin.flag.manage')");
    expect(page('page.tsx')).toContain("holds(me, 'admin.setting.manage')");
    for (const path of ['page.tsx', 'features/page.tsx', 'ai/page.tsx', 'modules/page.tsx', 'usage/page.tsx']) expect(page(path)).not.toContain('admin.settings.manage');
  });

  it('writes when a setting changed, and who changed it, on the server', () => {
    const me = { locale: 'en-GB', timeZone: 'Europe/London' } as never;
    const row = {
      key: 'ticket.autoClose.days',
      module: 'MOD-04',
      scopes: ['tenant'] as ('tenant')[],
      default: 7,
      description: 'Days after resolution.',
      value: 5,
      source: 'tenant' as const,
      scopeId: null,
      version: 2,
      publishedAt: '2026-09-03T09:00:00Z',
      publishedBy: 'u-1',
      type: INT(1, 90),
    };
    expect(data.settingItem(row, new Map([['u-1', { name: 'Alex Administrator' }]]), me)).toMatchObject({ changed: true, note: expect.stringMatching(/^Changed by Alex Administrator · 3 Sept? 2026$/), locked: false });
    expect(data.settingItem({ ...row, value: 7 }, new Map(), me).note).toBeNull();
    expect(data.settingItem({ ...row, source: 'organisation' }, new Map(), me)).toMatchObject({ note: 'Set for your organisation', locked: true });
    expect(data.searchState({ q: 'email', changed: '1' })).toEqual({ query: 'email', changedOnly: true });
  });

  it('sums the three switches behind triage into one mode in words', () => {
    const settingsRow = [item('ai.decision.triage.mode', { kind: 'enum', options: ['off', 'shadow', 'suggest', 'auto'] }, 'suggest')];
    const flags = (ai: boolean, triage: boolean) => [
      { key: 'ai.enabled', label: '', description: '', group: 'ai' as const, value: ai, default: true, owner: '', expiry: null, changed: false },
      { key: 'ai.decision.triage', label: '', description: '', group: 'ai' as const, value: triage, default: false, owner: '', expiry: null, changed: false },
    ];
    expect(data.triageSummary(flags(true, true), settingsRow, '/ai-triage')).toMatchObject({ label: 'Suggest', tone: 'success', href: '/ai-triage' });
    expect(data.triageSummary(flags(true, false), settingsRow, undefined)).toMatchObject({ label: 'Off' });
    expect(data.triageSummary(flags(false, true), settingsRow, undefined)?.sentence).toContain('AI is off for this workspace');
  });

  it('spends only custom properties the design system emits, and declares only app- classes', () => {
    const defined = new Set([...Object.keys(structuralVariables()), ...Object.keys(themeVariables('apple'))]);
    for (const path of ['settings/settings.css', 'platform/platform.css']) {
      const css = readFileSync(join(here, '..', 'components', path), 'utf8');
      const used = [...new Set([...css.matchAll(/var\((--itsm-[a-zA-Z0-9-]+)/g)].map((match) => match[1]!))];
      expect(used.filter((variable) => !defined.has(variable)), path).toEqual([]);
      for (const line of css.split('\n').filter((entry) => /^\.[a-zA-Z]/.test(entry.trim()))) expect(line.trim().startsWith('.app-'), `${path}: ${line}`).toBe(true);
    }
  });
});
