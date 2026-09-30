// @vitest-environment jsdom
import { act, forwardRef, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

let search = '';
const router = { refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), forward: vi.fn() };
vi.mock('next/navigation', () => ({
  usePathname: () => '/fields',
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(search),
}));

const saveField = vi.fn(async (key: string, input: Record<string, unknown>) => ({ key, ...input }));
const deactivateField = vi.fn(async (key: string) => ({ key, label: key === 'costCentre' ? 'Cost centre' : key, isActive: false }));
const reactivateField = vi.fn(async (key: string) => ({ key, label: key === 'costCentre' ? 'Cost centre' : key, isActive: true }));
vi.mock('../client/api.js', () => ({
  api: { tenant: { saveField, deactivateField, reactivateField, users: vi.fn(async () => []) } },
}));

const { ItsmProvider } = await import('@itsm/ui');
const fields = await import('../components/fields/presentation.js');
const { FieldsView } = await import('../components/fields/FieldsView.js');
const { FieldSheet } = await import('../components/fields/FieldSheet.js');
const { permissionLabel } = await import('../permissions.js');
const { cleanupDocument, clickAsync, render, type } = await import('./support/render.js');

/**
 * Ticket fields (SPEC §6.1; F27): every write sends the whole row, so
 * renaming a field or moving it never resets where it applies, when it is
 * required or who may see it; Retire and Reactivate are offered by state;
 * the type is fixed once saved and the sheet says why.
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
      usePathname={() => '/fields'}
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

const costCentre = fields.fieldView(
  {
    id: 'f1',
    key: 'costCentre',
    label: 'Cost centre',
    type: 'select',
    options: [
      { value: 'finance', label: 'Finance' },
      { value: 'sales', label: 'Sales' },
    ],
    appliesTo: { types: ['request'] },
    requiredWhen: { eq: [{ var: 'priority' }, 'P1'] },
    visibleTo: ['ticket.comment.internal'],
    classification: 'restricted',
    order: 10,
    isActive: true,
  },
  permissionLabel,
  ['VIP routing'],
);
const assetTag = fields.fieldView(
  { id: 'f2', key: 'assetTag', label: 'Asset tag', type: 'text', options: [], appliesTo: { types: [] }, requiredWhen: null, visibleTo: [], classification: 'internal', order: 20, isActive: true },
  permissionLabel,
);
const oldField = fields.fieldView(
  { id: 'f3', key: 'legacyCode', label: 'Legacy code', type: 'text', options: [], appliesTo: { types: [] }, requiredWhen: { always: true }, visibleTo: [], classification: 'public', order: 30, isActive: false },
  permissionLabel,
);

const scopes = [
  { value: 'active' as const, label: 'Active', href: '/fields', count: 2 },
  { value: 'retired' as const, label: 'Retired', href: '/fields?scope=retired', count: 1 },
  { value: 'all' as const, label: 'All', href: '/fields?scope=all', count: 3 },
];
const permissions = [{ key: 'ticket.comment.internal', label: 'Internal ticket comment', description: 'Add an internal note.' }];

/* ======================================================================= */

describe('a field in words', () => {
  it('says who sees it, where it applies and when it is required', () => {
    expect(costCentre.visibilityLabel).toBe('Restricted');
    expect(costCentre.visibleToLabels).toEqual(['Internal ticket comment']);
    expect(costCentre.appliesLabel).toBe('Request');
    expect(costCentre.requiredLabel).toBe('When Priority is P1 · Critical');
    expect(assetTag.requiredLabel).toBe('No');
    expect(oldField.requiredLabel).toBe('Always');
    expect(fields.requirementOf({ always: true })).toBe('always');
  });

  it('reads its Required when against the ticket’s own facts, not the rules engine’s', () => {
    expect(fields.FIELD_FACTS.map((fact) => fact.path)).toEqual(['type', 'priority', 'impact', 'urgency', 'sourceChannel']);
  });

  it('writes the whole row, leaving out only what the API refuses where it does not apply', () => {
    expect(fields.payloadOf(costCentre, { order: 40 })).toEqual({
      label: 'Cost centre',
      type: 'select',
      options: [
        { value: 'finance', label: 'Finance' },
        { value: 'sales', label: 'Sales' },
      ],
      appliesTo: { types: ['request'] },
      requiredWhen: { eq: [{ var: 'priority' }, 'P1'] },
      classification: 'restricted',
      visibleTo: ['ticket.comment.internal'],
      order: 40,
    });
    expect(fields.payloadOf(costCentre, { type: 'text', classification: 'internal' })).toMatchObject({ options: [], visibleTo: [] });
  });

  it('finds the rules that read a field before it is retired', () => {
    const usage = fields.rulesByField([
      { name: 'VIP routing', conditions: { and: [{ eq: [{ var: 'fields.costCentre' }, 'finance'] }, { eq: [{ var: 'ticket.priority' }, 'P1'] }] } },
      { name: 'Other', conditions: { eq: [{ var: 'ticket.type' }, 'incident'] } },
    ]);
    expect([...usage.entries()]).toEqual([['costCentre', ['VIP routing']]]);
  });
});

/* ======================================================================= */

function openMenu(container: HTMLElement, label: string): string[] {
  const row = [...container.querySelectorAll('tbody tr')].find((entry) => text(entry.querySelector('.itsm-DataTable__primaryCell')) === label)!;
  const primary = row.querySelector<HTMLElement>('[data-itsm-control="primary"]')!;
  act(() => primary.focus());
  act(() => {
    primary.dispatchEvent(new KeyboardEvent('keydown', { key: '.', bubbles: true, cancelable: true }));
  });
  return [...document.querySelectorAll('[role="menuitem"]')].map((item) => text(item).replace(/(Alt|⌥).*$/, '').trim());
}

describe('the fields list', () => {
  it('offers Retire on an active field and Reactivate on a retired one', () => {
    const active = render(
      <Frame>
        <FieldsView fields={[costCentre, assetTag]} allFields={[costCentre, assetTag, oldField]} scope="active" scopes={scopes} canManage permissions={permissions} />
      </Frame>,
    );
    expect(openMenu(active.container, 'Asset tag')).toEqual(['Edit', 'Move up', 'Move down', 'Retire…']);
    cleanupDocument();
    const retired = render(
      <Frame>
        <FieldsView fields={[oldField]} allFields={[costCentre, assetTag, oldField]} scope="retired" scopes={scopes} canManage permissions={permissions} />
      </Frame>,
    );
    expect(openMenu(retired.container, 'Legacy code')).toEqual(['Edit', 'Reactivate']);
  });

  it('moves a field with Alt+↓ and writes both moved rows whole', async () => {
    const { container } = render(
      <Frame>
        <FieldsView fields={[costCentre, assetTag]} allFields={[costCentre, assetTag]} scope="active" scopes={scopes} canManage permissions={permissions} />
      </Frame>,
    );
    const primary = container.querySelector<HTMLElement>('tbody [data-itsm-control="primary"]')!;
    act(() => primary.focus());
    await act(async () => {
      primary.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(saveField.mock.calls.map(([key, input]) => [key, input.order])).toEqual([
      ['costCentre', 20],
      ['assetTag', 10],
    ]);
    // Moving it reset nothing else.
    expect(saveField.mock.calls[0]![1]).toEqual(fields.payloadOf(costCentre, { order: 20 }));
    expect([...container.querySelectorAll('tbody .itsm-DataTable__primaryCell')].map((cell) => text(cell))).toEqual(['Asset tag', 'Cost centre']);
  });

  it('retires a field only after confirming, naming the rules that read it', async () => {
    const { container } = render(
      <Frame>
        <FieldsView fields={[costCentre, assetTag]} allFields={[costCentre, assetTag]} scope="active" scopes={scopes} canManage permissions={permissions} />
      </Frame>,
    );
    openMenu(container, 'Cost centre');
    const retire = [...document.querySelectorAll('[role="menuitem"]')].find((item) => text(item) === 'Retire…') as HTMLElement;
    await act(async () => {
      retire.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const confirm = document.querySelector('[role="alertdialog"]')!;
    expect(text(confirm)).toContain('Existing values stay');
    expect(text(confirm)).toContain('Read by a rule: VIP routing');
    expect(deactivateField).not.toHaveBeenCalled();
    await clickAsync(buttonNamed(confirm, 'Retire field')!);
    expect(deactivateField).toHaveBeenCalledWith('costCentre');
  });

  it('labels a restricted field with a lock and lists who may see it', async () => {
    const { container } = render(
      <Frame>
        <FieldsView fields={[costCentre]} allFields={[costCentre]} scope="active" scopes={scopes} canManage permissions={permissions} />
      </Frame>,
    );
    const pill = container.querySelector('.app-VisibilityPill')!;
    expect(pill.getAttribute('aria-label')).toBe('Restricted: see who can see Cost centre');
    await clickAsync(pill);
    expect(text(document.querySelector('.app-VisibilityPill__list'))).toBe('Internal ticket comment');
  });
});

/* ======================================================================= */

describe('the field sheet', () => {
  it('changes a label and sends the whole row: nothing set elsewhere is wiped (F27)', async () => {
    const onSaved = vi.fn();
    render(
      <Frame>
        <FieldSheet open field={costCentre} fields={[costCentre, assetTag]} permissions={permissions} onClose={() => undefined} onSaved={onSaved} />
      </Frame>,
    );
    const sheet = document.querySelector('[role="dialog"]')!;
    expect(text(sheet)).toContain('its type can’t change');
    expect(sheet.querySelector('[role="radiogroup"][aria-label="Type"]')).toBeNull();
    const label = [...sheet.querySelectorAll('input')].find((input) => input.value === 'Cost centre')!;
    type(label, 'Cost centre code');
    await clickAsync(buttonNamed(sheet, 'Save field')!);
    expect(saveField).toHaveBeenCalledWith('costCentre', { ...fields.payloadOf(costCentre), label: 'Cost centre code' });
    expect(onSaved).toHaveBeenCalledWith('costCentre');
  });

  it('adds a field under the key made from its label, and refuses a restricted field that names nobody', async () => {
    render(
      <Frame>
        <FieldSheet open fields={[costCentre]} permissions={permissions} onClose={() => undefined} onSaved={() => undefined} />
      </Frame>,
    );
    const sheet = document.querySelector('[role="dialog"]')!;
    const label = sheet.querySelector<HTMLInputElement>('input[maxlength="200"]')!;
    type(label, 'Laptop model');
    expect(text(sheet.querySelector('.app-KeyField__key'))).toBe('laptopModel');
    const restricted = [...sheet.querySelectorAll('[role="radio"]')].find((radio) => text(radio).startsWith('Restricted')) as HTMLElement;
    act(() => restricted.click());
    await clickAsync(buttonNamed(sheet, 'Add field')!);
    expect(saveField).not.toHaveBeenCalled();
    expect(text(sheet.querySelector('[role="alert"]'))).toContain('Choose at least one permission');
    const desk = [...sheet.querySelectorAll('[role="radio"]')].find((radio) => text(radio).startsWith('The desk')) as HTMLElement;
    act(() => desk.click());
    await clickAsync(buttonNamed(sheet, 'Add field')!);
    expect(saveField).toHaveBeenCalledWith('laptopModel', {
      label: 'Laptop model',
      type: 'text',
      options: [],
      appliesTo: { types: [] },
      requiredWhen: null,
      classification: 'internal',
      visibleTo: [],
      order: 20,
    });
  });
});
