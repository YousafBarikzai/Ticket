// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, forwardRef, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionRow, CredentialRow, ErrorQueueRow } from '@itsm/sdk';
import { structuralVariables, themeVariables } from '@itsm/ui/tokens';

vi.mock('server-only', () => ({}));

let search = '';
const router = { refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), forward: vi.fn() };
vi.mock('next/navigation', () => ({
  usePathname: () => '/integrations',
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(search),
}));

const replay = vi.fn(async (_id: string) => ({ ok: true, output: {} }) as { ok: boolean; output: object; error?: string });
const dismiss = vi.fn(async () => ({ status: 'dismissed' as const }));
const publishAction = vi.fn(async (key: string) => ({ key, status: 'published' }));
const createCredential = vi.fn(async (input: { ref: string }) => ({ ref: input.ref }));
const rotateCredential = vi.fn(async (ref: string) => ({ ref }));
const deleteCredential = vi.fn(async () => undefined);
const createWebhook = vi.fn(async (input: { name: string }) => ({ id: 'w9', name: input.name, url: 'https://x', secret: 'whsec_123' }));
const deleteWebhook = vi.fn(async () => undefined);
vi.mock('../client/api.js', () => ({
  api: {
    observe: { integrations: { replay, dismiss, publishAction, createCredential, rotateCredential, deleteCredential } },
    tenant: { createWebhook, deleteWebhook },
  },
}));

const { ItsmProvider } = await import('@itsm/ui');
const integrations = await import('../components/integrations/presentation.js');
const { DeliveriesView } = await import('../components/integrations/DeliveriesView.js');
const { ActionsView } = await import('../components/integrations/ActionsView.js');
const { CredentialsView } = await import('../components/integrations/CredentialsView.js');
const { AddCredentialSheet, RotateCredentialDialog, expiryInstant } = await import('../components/integrations/CredentialDialogs.js');
const { WebhooksView } = await import('../components/integrations/WebhooksView.js');
const { cleanupDocument, click, clickAsync, render, type } = await import('./support/render.js');

/**
 * Integrations (SPEC §6.1 `/integrations/**`; §6.4 "Failed deliveries"):
 * a failed delivery can be replayed or dismissed, one or many; a credential
 * says how near it is to expiring in words; an action's health reads its
 * credential and its failures; secrets never reach a viewer.
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
      usePathname={() => '/integrations'}
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
const dialogWith = (words: string): Element | undefined => [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].find((dialog) => text(dialog).includes(words));

async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

function openMenu(container: HTMLElement, label: string): HTMLElement[] {
  const row = [...container.querySelectorAll('tbody tr')].find((entry) => text(entry.querySelector('.itsm-DataTable__primaryCell')).startsWith(label))!;
  const primary = row.querySelector<HTMLElement>('[data-itsm-control="primary"]')!;
  act(() => primary.focus());
  act(() => {
    primary.dispatchEvent(new KeyboardEvent('keydown', { key: '.', bubbles: true, cancelable: true }));
  });
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}

const NOW = Date.parse('2026-09-30T12:00:00.000Z');
const days = (n: number): string => new Date(NOW + n * 86_400_000).toISOString();

function queueRow(overrides: Partial<ErrorQueueRow> = {}): ErrorQueueRow {
  return {
    id: 'e1',
    source: 'workflow',
    sourceId: 'run-1',
    actionKey: 'create-account',
    payload: { input: { email: 'sam@example.com', token: 'abc123' }, headers: { Authorization: 'Bearer secret-token' } },
    idempotencyKey: 'idem-1',
    error: 'that endpoint answered 503\nat gateway.call (gateway.ts:12)',
    attempts: 3,
    status: 'open',
    dismissedReason: null,
    createdAt: days(-1),
    resolvedAt: null,
    resolvedBy: null,
    ...overrides,
  };
}

function action(overrides: Partial<ActionRow> = {}): ActionRow {
  return {
    id: 'a1',
    key: 'create-account',
    name: 'Create an account',
    description: 'Makes the starter’s account in the directory.',
    kind: 'http',
    config: { method: 'POST', url: 'https://directory.example.com/users?api_key=zzz', headers: { 'X-Api-Key': '{{secrets.key}}' } },
    credentialRef: 'directory-bot',
    credentialHeader: 'Authorization',
    retryMax: 3,
    timeoutMs: 15_000,
    responseMapping: { id: 'body.id' },
    status: 'published',
    createdAt: days(-30),
    updatedAt: days(-2),
    ...overrides,
  };
}

function credential(overrides: Partial<CredentialRow> = {}): CredentialRow {
  return {
    ref: 'directory-bot',
    kind: 'generic',
    description: 'The directory’s service account',
    fingerprint: 'sha256:ab12cd34',
    createdAt: days(-100),
    rotatedAt: null,
    lastUsedAt: days(-1),
    expiresAt: days(9),
    needsRewrap: false,
    ...overrides,
  };
}

const header = { tabs: [{ id: 'deliveries', label: 'Failed deliveries', href: '/integrations' }] };
const scopes = [
  { value: 'open', label: 'Open', href: '/integrations', count: 2 },
  { value: 'replayed', label: 'Replayed', href: '/integrations?status=replayed' },
  { value: 'dismissed', label: 'Dismissed', href: '/integrations?status=dismissed' },
];
const context = { actionNames: new Map([['create-account', 'Create an account']]), runWorkflows: new Map([['run-1', 'Starter onboarding']]) };

/* ======================================================================= */

describe('integrations in words', () => {
  it('says how near a credential is to its expiry, always in words', () => {
    expect(integrations.expiryLook(null, NOW)).toMatchObject({ state: 'none', label: 'Doesn’t expire', tone: 'neutral' });
    expect(integrations.expiryLook(days(90), NOW)).toMatchObject({ state: 'ok', label: 'Expires in 90 days', tone: 'neutral' });
    expect(integrations.expiryLook(days(9), NOW)).toMatchObject({ state: 'soon', label: 'Expires in 9 days', tone: 'warning', days: 9 });
    expect(integrations.expiryLook(days(0.5), NOW)).toMatchObject({ state: 'soon', label: 'Expires within a day' });
    expect(integrations.expiryLook(days(-2), NOW)).toMatchObject({ state: 'expired', label: 'Expired 2 days ago', tone: 'danger' });
    expect(integrations.expiryLook(days(-0.2), NOW)).toMatchObject({ state: 'expired', label: 'Expired today' });
  });

  it('puts an expiry before the encryption key when judging a credential', () => {
    expect(integrations.credentialHealth(credential({ expiresAt: days(-1), needsRewrap: true }), NOW)).toMatchObject({ tone: 'danger' });
    expect(integrations.credentialHealth(credential({ expiresAt: null, needsRewrap: true }), NOW)).toMatchObject({ label: 'Needs re-encrypting', tone: 'warning' });
    expect(integrations.credentialHealth(credential({ expiresAt: days(200) }), NOW)).toMatchObject({ label: 'Healthy', tone: 'success' });
  });

  it('judges an action by its credential first, then its failures, then whether it is live', () => {
    const health = (row: Partial<ActionRow>, cred: CredentialRow | null, failures = 0, known = true) => integrations.actionHealth(action(row), cred, failures, NOW, known).label;
    expect(health({}, null)).toBe('Credential missing');
    // A credential list this person could not read is unknown, never "missing".
    expect(health({}, null, 0, false)).toBe('Healthy');
    expect(health({}, credential({ expiresAt: days(-1) }), 4)).toBe('Credential expired');
    expect(health({}, credential({ expiresAt: days(200) }), 2)).toBe('2 failed deliveries');
    expect(health({}, credential())).toBe('Credential expires in 9 days');
    expect(health({ status: 'draft' }, credential({ expiresAt: null }))).toBe('Not live yet');
    expect(health({ credentialRef: null }, null)).toBe('Healthy');
  });

  it('hides values that look like secrets, wherever they are, and changes nothing it was given', () => {
    const payload = { input: { email: 'sam@example.com', token: 'abc123', nested: [{ password: 'p' }] }, headers: { Authorization: 'Bearer x', 'X-Trace': 'Basic dXNlcjpwYXNz' }, url: 'https://x.example/hook?token=abc&page=2' };
    const shown = integrations.redact(payload) as typeof payload;
    expect(shown.input.email).toBe('sam@example.com');
    expect(shown.input.token).toBe(integrations.REDACTED);
    expect(shown.input.nested[0]!.password).toBe(integrations.REDACTED);
    expect(shown.headers.Authorization).toBe(integrations.REDACTED);
    expect(shown.headers['X-Trace']).toBe(integrations.REDACTED);
    expect(shown.url).toBe('https://x.example/hook?token=hidden&page=2');
    expect(payload.input.token).toBe('abc123');
  });

  it('shows the first line of an error, cut at a word', () => {
    expect(integrations.firstLine('that endpoint answered 503\nat gateway.call')).toBe('that endpoint answered 503');
    expect(integrations.firstLine('word '.repeat(60), 40)).toMatch(/^(word ){6,}?word…$/);
  });

  it('names a failure’s action and where it came from, and replays only what an action produced', () => {
    const view = integrations.deliveryView(queueRow(), { ...context, hrefFor: () => '/workflows/runs?open=run:run-1' });
    expect(view).toMatchObject({ actionName: 'Create an account', from: 'Workflow · Starter onboarding', fromHref: '/workflows/runs?open=run:run-1', errorLine: 'that endpoint answered 503', replayable: true });
    expect((view.payload as { input: { token: string } }).input.token).toBe(integrations.REDACTED);
    expect(integrations.deliveryView(queueRow({ actionKey: null }), context)).toMatchObject({ actionName: 'Unnamed action', replayable: false });
    expect(integrations.deliveryView(queueRow({ status: 'dismissed' }), context).replayable).toBe(false);
    expect(integrations.deliveryView(queueRow({ source: 'rule' }), context).from).toBe('Rule');
  });

  it('says what a bulk run did, in one sentence', () => {
    expect(integrations.replaySummary({ done: 3, failed: 0 })).toEqual({ text: 'Delivered 3', tone: 'success' });
    expect(integrations.replaySummary({ done: 2, failed: 1, skipped: 1 })).toEqual({ text: 'Delivered 2 · 1 failed again · 1 has no action to replay', tone: 'warning' });
    expect(integrations.replaySummary({ done: 0, failed: 2 })).toEqual({ text: '2 failed again', tone: 'danger' });
    expect(integrations.replaySummary({ done: 1, failed: 0, left: 2 })).toEqual({ text: 'Delivered 1 · 2 left as they were', tone: 'warning' });
    expect(integrations.dismissSummary({ done: 4, failed: 0 })).toEqual({ text: 'Dismissed 4', tone: 'success' });
  });

  it('checks a credential reference as the API does, and refuses one in use', () => {
    expect(integrations.credentialRefProblem('', [])).toBe('Enter a reference.');
    expect(integrations.credentialRefProblem('1bot', [])).toBe('Start with a lowercase letter.');
    expect(integrations.credentialRefProblem('Slack_Bot', [])).toBe('Start with a lowercase letter.');
    expect(integrations.credentialRefProblem('slack_bot', [])).toMatch(/lowercase letters, digits and hyphens/);
    expect(integrations.credentialRefProblem('slack-bot', ['slack-bot'])).toMatch(/already exists/);
    expect(integrations.credentialRefProblem('slack-bot', [])).toBeNull();
    expect(expiryInstant('2026-10-12')).toBe('2026-10-12T23:59:59Z');
  });

  it('sums up credentials, deliveries and webhooks honestly', () => {
    expect(integrations.credentialsSummary(integrations.countCredentials([credential({ expiresAt: days(-1) }), credential(), credential({ expiresAt: null, needsRewrap: true })], NOW))).toEqual({
      text: '1 expired · 1 expiring soon · 1 to re-encrypt',
      tone: 'critical',
    });
    expect(integrations.credentialsSummary({ total: 3, expired: 0, soon: 0, rewrap: 0 })).toEqual({ text: 'All 3 healthy', tone: 'default' });
    expect(integrations.failuresByAction([queueRow(), queueRow({ id: 'e2' }), queueRow({ id: 'e3', status: 'dismissed' }), queueRow({ id: 'e4', actionKey: null })])).toEqual(new Map([['create-account', 2]]));
    expect(integrations.webhookHealth({ status: 'active', failureCount: 0 }).label).toBe('Delivering');
    expect(integrations.webhookHealth({ status: 'active', failureCount: 2 }).label).toBe('2 deliveries failing');
    expect(integrations.webhookUrlProblem('ftp://x')).toBe('Use an https:// address.');
    expect(integrations.timeoutText(15_000)).toBe('15 s');
    expect(integrations.timeoutText(90_000)).toBe('1 min 30 s');
  });
});

/* ======================================================================= */

describe('failed deliveries', () => {
  const rows = [
    integrations.deliveryView(queueRow(), context),
    integrations.deliveryView(queueRow({ id: 'e2', actionKey: null, attempts: 1, error: 'no action' }), context),
  ];

  it('offers Replay and Dismiss per row, and Replay only where an action can be sent again', () => {
    const { container } = render(
      <Frame>
        <DeliveriesView header={header} status="open" scopes={scopes} rows={rows} capped={false} canReplay />
      </Frame>,
    );
    const items = openMenu(container, 'Create an account');
    expect(items.map((item) => text(item))).toEqual(['View details', 'Replay', 'Dismiss…']);
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    cleanupDocument();
    const again = render(
      <Frame>
        <DeliveriesView header={header} status="open" scopes={scopes} rows={rows} capped={false} canReplay />
      </Frame>,
    );
    // Disabled with its reason written beside it, not hidden in a tooltip.
    const replayItem = openMenu(again.container, 'Unnamed action').find((item) => text(item).startsWith('Replay'))!;
    expect(replayItem.getAttribute('aria-disabled') ?? replayItem.getAttribute('data-disabled')).not.toBeNull();
    expect(text(replayItem)).toContain('didn’t come from an action');
  });

  it('marks three or more attempts as a warning, in words', () => {
    const { container } = render(
      <Frame>
        <DeliveriesView header={header} status="open" scopes={scopes} rows={rows} capped={false} canReplay />
      </Frame>,
    );
    expect(text(container)).toContain('3 attempts');
  });

  it('replays from the drawer and closes it when the call goes through', async () => {
    search = 'open=delivery:e1';
    render(
      <Frame>
        <DeliveriesView header={header} status="open" scopes={scopes} rows={rows} capped={false} canReplay />
      </Frame>,
    );
    const sheet = dialogWith('What went wrong')!;
    expect(text(sheet)).toContain('Workflow · Starter onboarding');
    expect(text(sheet)).toContain('idem-1');
    // The payload's secrets never reach the viewer.
    expect(text(sheet)).not.toContain('abc123');
    expect(text(sheet)).not.toContain('secret-token');
    await clickAsync(buttonNamed(sheet, 'Replay')!);
    expect(replay).toHaveBeenCalledWith('e1');
    expect(router.refresh).toHaveBeenCalled();
  });

  it('keeps the new error in the drawer when a replay fails again', async () => {
    search = 'open=delivery:e1';
    replay.mockResolvedValueOnce({ ok: false, output: {}, error: 'that endpoint answered 502' });
    render(
      <Frame>
        <DeliveriesView header={header} status="open" scopes={scopes} rows={rows} capped={false} canReplay />
      </Frame>,
    );
    await clickAsync(buttonNamed(dialogWith('What went wrong')!, 'Replay')!);
    expect(text(dialogWith('What went wrong'))).toContain('Replayed just now and failed again: that endpoint answered 502');
  });

  it('replays the selected rows one at a time, after asking, and leaves those with no action alone', async () => {
    const three = [...rows, integrations.deliveryView(queueRow({ id: 'e3' }), context)];
    const { container } = render(
      <Frame>
        <DeliveriesView header={header} status="open" scopes={scopes} rows={three} capped={false} canReplay />
      </Frame>,
    );
    click(container.querySelector('thead input[type="checkbox"]')!);
    click([...container.querySelectorAll('[role="toolbar"] button')].find((button) => text(button) === 'Replay')!);
    const confirm = dialogWith('Replay the selected deliveries?')!;
    expect(text(confirm)).toContain('original idempotency key');
    expect(replay).not.toHaveBeenCalled();
    await clickAsync(buttonNamed(confirm, 'Replay deliveries')!);
    await settle(10);
    expect(replay.mock.calls.map(([id]) => id)).toEqual(['e1', 'e3']);
    expect(router.refresh).toHaveBeenCalled();
  });

  it('dismisses only with a reason', async () => {
    const { container } = render(
      <Frame>
        <DeliveriesView header={header} status="open" scopes={scopes} rows={rows} capped={false} canReplay />
      </Frame>,
    );
    const dismissItem = openMenu(container, 'Create an account').find((item) => text(item) === 'Dismiss…')!;
    await act(async () => {
      dismissItem.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const confirm = dialogWith('Dismiss this Create an account failure?')!;
    const button = buttonNamed(confirm, 'Dismiss failure')!;
    expect(button.getAttribute('aria-disabled')).toBe('true');
    type(confirm.querySelector('textarea')!, 'Sent by hand');
    await clickAsync(buttonNamed(confirm, 'Dismiss failure')!);
    await settle();
    expect(dismiss).toHaveBeenCalledWith('e1', 'Sent by hand');
  });

  it('has no selection or actions outside the open list, or for someone who may not replay', () => {
    const replayed = [integrations.deliveryView(queueRow({ status: 'replayed', resolvedAt: days(0) }), context)];
    render(
      <Frame>
        <DeliveriesView header={header} status="replayed" scopes={scopes} rows={replayed} capped={false} canReplay />
      </Frame>,
    );
    expect(document.querySelector('thead input[type="checkbox"]')).toBeNull();
    cleanupDocument();
    const { container } = render(
      <Frame>
        <DeliveriesView header={header} status="open" scopes={scopes} rows={rows} capped={false} canReplay={false} />
      </Frame>,
    );
    expect(document.querySelector('thead input[type="checkbox"]')).toBeNull();
    expect(openMenu(container, 'Create an account').map((item) => text(item))).toEqual(['View details']);
  });

  it('says an empty open queue is good news', () => {
    render(
      <Frame>
        <DeliveriesView header={header} status="open" scopes={scopes} rows={[]} capped={false} canReplay />
      </Frame>,
    );
    expect(text(document.body)).toContain('No failed deliveries');
    expect(text(document.body)).toContain('Every outbound call has gone through.');
  });
});

/* ======================================================================= */

describe('actions', () => {
  const credentials = new Map([['directory-bot', credential({ expiresAt: days(200) })]]);

  it('shows each action’s health beside its credential, and hides secrets in its configuration', () => {
    search = 'open=action:create-account';
    const rows = [
      integrations.actionView(action(), { credentials, failures: new Map(), now: NOW }),
      integrations.actionView(action({ key: 'notify', name: 'Notify chat', credentialRef: 'chat-bot', status: 'draft' }), { credentials, failures: new Map(), now: NOW }),
    ];
    render(
      <Frame>
        <ActionsView header={header} rows={rows} canPublish />
      </Frame>,
    );
    expect(text(document.body)).toContain('Credential missing');
    const sheet = dialogWith('Configuration')!;
    expect(text(sheet)).toContain('POST https://directory.example.com/users?api_key=hidden');
    expect(text(sheet)).not.toContain('zzz');
  });

  it('publishes a draft only after asking', async () => {
    const rows = [integrations.actionView(action({ status: 'draft' }), { credentials, failures: new Map(), now: NOW })];
    const { container } = render(
      <Frame>
        <ActionsView header={header} rows={rows} canPublish />
      </Frame>,
    );
    const publish = openMenu(container, 'Create an account').find((item) => text(item) === 'Publish…')!;
    await act(async () => {
      publish.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const confirm = dialogWith('Publish Create an account?')!;
    expect(publishAction).not.toHaveBeenCalled();
    await clickAsync(buttonNamed(confirm, 'Publish action')!);
    await settle();
    expect(publishAction).toHaveBeenCalledWith('create-account');
  });
});

/* ======================================================================= */

describe('credentials', () => {
  const rows = [credential({ ref: 'old-bot', expiresAt: days(-2) }), credential()].map((row) => integrations.credentialView(row, NOW, [action()]));

  it('says expired and expiring in words, never by colour alone', () => {
    render(
      <Frame>
        <CredentialsView header={header} rows={rows} canManage />
      </Frame>,
    );
    expect(text(document.body)).toContain('Expired 2 days ago');
    expect(text(document.body)).toContain('Expires in 9 days');
  });

  it('deletes only when the reference is typed back, naming the actions that use it', async () => {
    const { container } = render(
      <Frame>
        <CredentialsView header={header} rows={rows} canManage actionsHref="/integrations/actions" />
      </Frame>,
    );
    const item = openMenu(container, 'directory-bot').find((entry) => text(entry) === 'Delete…')!;
    await act(async () => {
      item.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const confirm = document.querySelector('[role="alertdialog"]')!;
    expect(text(confirm)).toContain('Used by the action Create an account');
    expect(buttonNamed(confirm, 'Delete credential')!.getAttribute('aria-disabled')).toBe('true');
    type(confirm.querySelector('input')!, 'directory-bot');
    await clickAsync(buttonNamed(confirm, 'Delete credential')!);
    await settle();
    expect(deleteCredential).toHaveBeenCalledWith('directory-bot');
  });

  it('stores a new credential as a password field never autocompleted, and checks the reference first', async () => {
    const onSaved = vi.fn();
    render(
      <Frame>
        <AddCredentialSheet open taken={['directory-bot']} onClose={() => undefined} onSaved={onSaved} />
      </Frame>,
    );
    const sheet = dialogWith('never shown again')!;
    const [ref, value] = [sheet.querySelector<HTMLInputElement>('input[name="ref"]')!, sheet.querySelector<HTMLInputElement>('input[name="value"]')!];
    expect(value.type).toBe('password');
    expect(value.autocomplete).toBe('off');
    type(ref, 'directory-bot');
    type(value, 's3cret');
    await clickAsync(buttonNamed(sheet, 'Store credential')!);
    expect(createCredential).not.toHaveBeenCalled();
    expect(text(sheet)).toContain('already exists');
    type(ref, 'slack-bot');
    await clickAsync(buttonNamed(sheet, 'Store credential')!);
    await settle();
    expect(createCredential).toHaveBeenCalledWith({ ref: 'slack-bot', value: 's3cret', kind: 'generic' });
    expect(onSaved).toHaveBeenCalledWith('slack-bot');
  });

  it('rotates by value only, and says the expiry date stays', async () => {
    render(
      <Frame>
        <RotateCredentialDialog credential={rows[1]!} onClose={() => undefined} />
      </Frame>,
    );
    const dialog = dialogWith('Rotate directory-bot')!;
    expect(text(dialog)).toMatch(/Rotating changes the value only: its expiry date, 9 Oct 2026, stays as it is\./);
    type(dialog.querySelector('input')!, 'n3w');
    await clickAsync(buttonNamed(dialog, 'Rotate credential')!);
    await settle();
    expect(rotateCredential).toHaveBeenCalledWith('directory-bot', 'n3w');
  });
});

/* ======================================================================= */

describe('webhooks', () => {
  it('shows the signing secret once, after the webhook is made', async () => {
    search = 'new=1';
    render(
      <Frame>
        <WebhooksView header={header} rows={[]} events={[{ type: 'ticket.created', description: 'A ticket was raised.' }]} canManage />
      </Frame>,
    );
    const sheet = dialogWith('Add webhook')!;
    type(sheet.querySelector<HTMLInputElement>('input[name="name"]')!, 'Warehouse');
    type(sheet.querySelector<HTMLInputElement>('input[name="url"]')!, 'https://warehouse.example/hook');
    await clickAsync(buttonNamed(sheet, 'Add webhook')!);
    // No events chosen: refused before any request.
    expect(createWebhook).not.toHaveBeenCalled();
    expect(text(sheet)).toContain('Choose at least one event to send.');

    const events = sheet.querySelector<HTMLInputElement>('input[role="combobox"]')!;
    act(() => events.focus());
    type(events, 'ticket');
    await settle(250);
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((entry) => text(entry).startsWith('ticket.created'))!;
    await act(async () => {
      option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      option.click();
    });
    await clickAsync(buttonNamed(dialogWith('Add webhook')!, 'Add webhook')!);
    await settle();
    expect(createWebhook).toHaveBeenCalledWith({ name: 'Warehouse', url: 'https://warehouse.example/hook', eventTypes: ['ticket.created'] });
    const secret = dialogWith('Copy the signing secret now')!;
    expect(text(secret)).toContain('whsec_123');
    expect(text(secret)).toContain('It won’t be shown again.');
  });
});

/* ======================================================================= */

describe('the pages’ stylesheets', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const defined = new Set([...Object.keys(structuralVariables()), ...Object.keys(themeVariables('apple'))]);
  const sheets = ['integrations/integrations.css', 'ai-triage/ai-triage.css'].map((path) => ({ path, css: readFileSync(join(here, '..', 'components', path), 'utf8') }));

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
