// @vitest-environment jsdom
import { act, forwardRef, useState, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FieldRow, Me } from '@itsm/sdk';
import { ItsmProvider } from '@itsm/ui';
import { directoryKeys } from '../client/desk-ticket.js';
import { EMPTY_DRAFT, intentFor, isEmptyDraft, toCreateInput } from '../workspace/NewTicketSheet.js';
import { previewLine, previewPriority, recommendedPriority } from '../workspace/inspector/priority.js';
import { fakeFetch, noIdle, type Call } from './support/inbox.js';
import { cleanupDocument, click, render, submit, type } from './support/render.js';
import { ADA, ME, TEAM, flush, router, ticket, until } from './support/workspace.js';

/**
 * The new-ticket sheet (SPEC §6.2, X-45, WP25): what it asks, the priority
 * it shows before anything is saved, one idempotency key per attempt (the
 * same on a retry, a new one when the ticket changed), the draft kept until
 * the ticket exists, and where the new ticket goes afterwards.
 */

const notify = vi.fn();
vi.mock('@itsm/ui', async (original) => ({
  ...(await original<typeof import('@itsm/ui')>()),
  notify: (...args: unknown[]) => notify(...args),
}));

const CATEGORY = '00000000-0000-4000-8000-0000000000c1';

function me(keys: readonly (string | [string, string])[]): Me {
  return {
    actor: { type: 'user', id: ME, displayName: 'Sam Agent' },
    tenant: { id: 't', name: 'Acme', slug: 'acme', region: 'eu' },
    permissions: keys.map((entry) => (Array.isArray(entry) ? { key: entry[0], scope: entry[1] } : { key: entry, scope: 'team' })),
    organisations: [],
    teamIds: [TEAM],
    locale: 'en-GB',
    timeZone: 'Europe/London',
  };
}

const AGENT = me([['ticket.create', 'any'], 'ticket.assign', 'identity.user.read']);

interface World {
  me: Me;
  matrix: 'refused' | { impact: string; urgency: string; priority: string }[];
  fields: FieldRow[];
  /** How each create is answered, in turn; the last repeats. */
  creates: (() => { status?: number; body?: unknown })[];
}

let world: World;
let wire: ReturnType<typeof fakeFetch>;

function answer(call: Call): { status?: number; body?: unknown } | undefined {
  if (call.url.endsWith('/api/v1/me')) return { body: world.me };
  if (call.url.endsWith('/api/v1/priority-matrix')) {
    return world.matrix === 'refused' ? { status: 403, body: { status: 403, title: 'Forbidden' } } : { body: { data: world.matrix } };
  }
  if (call.url.includes('/api/v1/field-definitions')) return { body: { data: world.fields } };
  if (call.url.endsWith('/api/v1/tickets') && call.method === 'POST') {
    const next = world.creates.length > 1 ? world.creates.shift()! : world.creates[0]!;
    return next();
  }
  return undefined;
}

const created = () => ({ status: 201, body: ticket({ id: 'new-id', number: 'INC-000124', priority: 'P2', assigneeId: null, version: 1 }) });

const Link = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean | null }>(function Link(
  { prefetch: _prefetch, ...props },
  ref,
) {
  return <a ref={ref} {...props} />;
});

/** The sheet as the frame mounts it: opened, closable, opened again. */
function Harness({ Sheet }: { readonly Sheet: typeof import('../workspace/NewTicketSheet.js').default }): ReactNode {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" data-testid="reopen" onClick={() => setOpen(true)}>
        New ticket
      </button>
      <Sheet open={open} onOpenChange={setOpen} />
    </>
  );
}

async function mount(path = '/inbox/all') {
  window.history.replaceState(null, '', path);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } } });
  client.setQueryData(directoryKeys.teams(), [
    { id: TEAM, name: 'Network' },
    { id: '00000000-0000-4000-8000-0000000000f2', name: 'Service desk' },
  ]);
  client.setQueryData(directoryKeys.categories(), [{ id: CATEGORY, name: 'VPN', path: 'Access / VPN' }]);
  // The frame loads it lazily, by its default export.
  const module = await import('../workspace/NewTicketSheet.js');
  const rendered = render(
    <ItsmProvider
      app="workbench"
      Link={Link}
      router={router}
      usePathname={() => window.location.pathname}
      useSearchParams={() => new URLSearchParams(window.location.search)}
      locale="en-GB"
      timeZone="Europe/London"
      storageScope={ME}
    >
      <QueryClientProvider client={client}>
        <Harness Sheet={module.default} />
      </QueryClientProvider>
    </ItsmProvider>,
  );
  await flush(3);
  return { ...rendered, client };
}

function dialog(): HTMLElement {
  const found = document.querySelector<HTMLElement>('[role="dialog"]');
  if (!found) throw new Error('the sheet is not open');
  return found;
}

/** The control a visible label names. */
function control<T extends HTMLElement = HTMLInputElement>(name: string): T {
  const label = [...dialog().querySelectorAll('label')].find((element) => element.textContent?.replace(/\(optional\)|\*/g, '').trim() === name);
  const id = label?.getAttribute('for');
  const found = id ? document.getElementById(id) : null;
  if (!found) throw new Error(`no control labelled ${name}`);
  return found as T;
}

function choose(select: HTMLSelectElement, value: string): void {
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function creates(): Call[] {
  return wire.calls.filter((call) => call.method === 'POST' && call.url.endsWith('/api/v1/tickets'));
}

function form(): HTMLFormElement {
  return dialog().querySelector<HTMLFormElement>('form.app-NewTicket')!;
}

beforeEach(() => {
  noIdle();
  notify.mockClear();
  localStorage.clear();
  world = { me: AGENT, matrix: 'refused', fields: [], creates: [created] };
  wire = fakeFetch(answer);
  vi.stubGlobal('fetch', wire.fetch);
});

afterEach(() => {
  cleanupDocument();
  vi.unstubAllGlobals();
});

/* --------------------------------------------------------------- Pure */

describe('the rules', () => {
  it('works the priority out from the desk’s grid, or says "usually" from the recommended one', () => {
    expect(recommendedPriority('high', 'high')).toBe('P1');
    expect(recommendedPriority('high', 'medium')).toBe('P2');
    expect(recommendedPriority('low', 'low')).toBe('P4');
    expect(previewLine(previewPriority(null, 'high', 'medium'))).toBe('Usually → P2 · High');
    expect(previewLine(previewPriority([{ impact: 'high', urgency: 'medium', priority: 'P1' }], 'high', 'medium'))).toBe('→ P1 · Critical');
    expect(previewPriority(null, 'high', null)).toBeNull();
    expect(previewLine(null)).toBe('Choose both to see the priority');
  });

  it('sends only what was chosen, and never the person raising it as the requester', () => {
    const draft = { ...EMPTY_DRAFT, title: '  VPN drops  ', requester: { id: ME, name: 'Sam' }, custom: { costCentre: '', site: 'Leeds' } };
    expect(toCreateInput(draft, ME)).toEqual({ type: 'incident', title: 'VPN drops', custom: { site: 'Leeds' }, sourceChannel: 'api' });
    expect(toCreateInput({ ...draft, requester: { id: ADA, name: 'Ada' }, impact: 'high', urgency: 'low', groupId: TEAM }, ME)).toMatchObject({
      requesterId: ADA,
      impact: 'high',
      urgency: 'low',
      groupId: TEAM,
    });
    expect(isEmptyDraft(EMPTY_DRAFT)).toBe(true);
    expect(isEmptyDraft({ ...EMPTY_DRAFT, description: 'x' })).toBe(false);
  });

  it('keeps one key per attempt: the same body keeps it, a changed body gets a new one', () => {
    let minted = 0;
    const mint = () => `key-${++minted}`;
    const input = toCreateInput({ ...EMPTY_DRAFT, title: 'VPN drops' }, ME);
    const first = intentFor(null, input, mint);
    expect(intentFor(first, input, mint)).toBe(first);
    const changed = intentFor(first, { ...input, title: 'VPN drops every ten minutes' }, mint);
    expect(changed.key).toBe('key-2');
  });
});

/* -------------------------------------------------------------- The sheet */

describe('the sheet', () => {
  it('asks for the type, a title and what happened, then who, the priority and the routing', async () => {
    await mount();
    const radios = [...dialog().querySelectorAll('[role="radio"]')].map((radio) => radio.textContent?.trim());
    expect(radios).toEqual(['Incident', 'Request', 'Question']);
    expect(control('Title').getAttribute('aria-required') ?? control('Title').getAttribute('required')).not.toBeNull();
    expect(control<HTMLTextAreaElement>('Description').tagName).toBe('TEXTAREA');
    const legends = [...dialog().querySelectorAll('legend')].map((legend) => legend.textContent?.trim());
    expect(legends).toEqual(['People', 'Priority', 'Routing']);
    await until(() => expect(control('Requester')).not.toBeNull());
    expect([...control<HTMLSelectElement>('Team').options].map((option) => option.textContent)).toEqual(['Decided by routing', 'Network', 'Service desk']);
    expect(dialog().querySelectorAll('button[type="submit"]')).toHaveLength(1);
  });

  it('shows the priority the two choices make as they are made (from the recommended grid without the matrix)', async () => {
    await mount();
    const preview = dialog().querySelector('.app-NewTicket__preview')!;
    expect(preview.getAttribute('aria-live')).toBe('polite');
    expect(preview.textContent).toContain('Choose both to see the priority');
    choose(control<HTMLSelectElement>('Impact'), 'high');
    choose(control<HTMLSelectElement>('Urgency'), 'medium');
    expect(preview.querySelector('[aria-hidden="true"]')?.textContent).toBe('Usually → P2 · High');
    expect(preview.textContent).toContain('Priority will usually be P2, High');
    expect(dialog().textContent).toContain('your desk’s own may differ');
    // Without `sla.policy.read` the matrix is not asked for at all.
    expect(wire.calls.some((call) => call.url.endsWith('/priority-matrix'))).toBe(false);
  });

  it('uses the desk’s own matrix when the person may read it', async () => {
    world.me = me([['ticket.create', 'any'], 'identity.user.read', ['sla.policy.read', 'any']]);
    world.matrix = [{ impact: 'high', urgency: 'medium', priority: 'P1' }];
    await mount();
    await until(() => expect(wire.calls.some((call) => call.url.endsWith('/priority-matrix'))).toBe(true));
    choose(control<HTMLSelectElement>('Impact'), 'high');
    choose(control<HTMLSelectElement>('Urgency'), 'medium');
    await until(() => expect(dialog().querySelector('.app-NewTicket__preview [aria-hidden="true"]')?.textContent).toBe('→ P1 · Critical'));
  });

  it('asks for a title before sending anything', async () => {
    await mount();
    await submit(form());
    expect(creates()).toHaveLength(0);
    expect(dialog().textContent).toContain('Give the ticket a title');
    expect(document.activeElement).toBe(control('Title'));
  });

  it('raises it once however often Create is pressed after a lost answer, and a changed ticket gets a new key', async () => {
    world.creates = [
      () => {
        throw new TypeError('Failed to fetch');
      },
      () => {
        throw new TypeError('Failed to fetch');
      },
      created,
    ];
    await mount();
    type(control('Title'), 'VPN drops every ten minutes');
    choose(control<HTMLSelectElement>('Team'), TEAM);
    await submit(form());
    await until(() => expect(dialog().textContent).toContain('The ticket wasn’t sent'));
    await submit(form());
    await flush(2);
    const [first, second] = creates();
    expect(first?.headers['idempotency-key']).toBeTruthy();
    expect(second?.headers['idempotency-key']).toBe(first?.headers['idempotency-key']);
    expect(first?.body).toEqual({ type: 'incident', title: 'VPN drops every ten minutes', groupId: TEAM, sourceChannel: 'api' });

    type(control('Title'), 'VPN drops every ten minutes on the train');
    await submit(form());
    await until(() => expect(notify).toHaveBeenCalledWith('INC-000124 created', expect.objectContaining({ tone: 'success' })));
    const third = creates()[2];
    expect(third?.headers['idempotency-key']).not.toBe(first?.headers['idempotency-key']);
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    // The next ticket starts afresh, with a key of its own.
    click(document.querySelector('[data-testid="reopen"]')!);
    await flush(2);
    expect(control('Title').value).toBe('');
    type(control('Title'), 'Printer jammed');
    await submit(form());
    await until(() => expect(creates()).toHaveLength(4));
    expect(creates()[3]?.headers['idempotency-key']).not.toBe(third?.headers['idempotency-key']);
  });

  it('opens the new ticket in the pane beside the inbox', async () => {
    await mount('/inbox/all?q=vpn');
    type(control('Title'), 'VPN drops');
    await submit(form());
    await until(() => expect(window.location.search).toBe('?q=vpn&t=INC-000124'));
    expect(notify).toHaveBeenCalledWith('INC-000124 created', expect.objectContaining({ description: 'P2 · High' }));
  });

  it('offers Open on the toast away from the inbox', async () => {
    await mount('/tickets/INC-000120');
    type(control('Title'), 'VPN drops');
    await submit(form());
    await until(() => expect(notify).toHaveBeenCalled());
    const options = notify.mock.calls[0]?.[1] as { action?: { label: string; onClick: () => void } };
    expect(options.action?.label).toBe('Open');
    options.action?.onClick();
    expect(router.push).toHaveBeenCalledWith('/tickets/INC-000124');
  });

  it('assigns it to you when raised from My work', async () => {
    await mount('/inbox/mine');
    await until(() => expect(control('Assignee').value).toBe('Sam Agent'));
    type(control('Title'), 'Laptop will not boot');
    await submit(form());
    await until(() => expect(creates()).toHaveLength(1));
    expect(creates()[0]?.body).toMatchObject({ assigneeId: ME });
  });

  it('keeps what was typed on this device until the ticket exists', async () => {
    const first = await mount();
    type(control('Title'), 'Half-written ticket');
    type(control<HTMLTextAreaElement>('Description'), 'It started this morning.');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
    });
    first.unmount();
    await mount();
    await until(() => expect(control('Title').value).toBe('Half-written ticket'));
    expect(control<HTMLTextAreaElement>('Description').value).toBe('It started this morning.');
    expect(dialog().textContent).toContain('Draft restored');
  });

  it('shows a refused field of the desk’s own on the field, opening More details', async () => {
    world.fields = [
      {
        id: 'f1',
        key: 'costCentre',
        label: 'Cost centre',
        type: 'text',
        options: [],
        appliesTo: { types: [] },
        requiredWhen: null,
        visibleTo: [],
        classification: 'internal',
        order: 1,
        isActive: true,
      },
    ];
    world.creates = [
      () => ({
        status: 422,
        body: { status: 422, title: 'Invalid', errors: [{ field: 'custom.costCentre', code: 'required', message: 'Cost centre is required for incidents' }] },
      }),
    ];
    await mount();
    await until(() => expect(dialog().querySelector('.app-NewTicket__more')).not.toBeNull());
    const more = dialog().querySelector<HTMLDetailsElement>('.app-NewTicket__more')!;
    expect(more.open).toBe(false);
    expect(more.querySelector('summary')?.textContent).toContain('More details (1)');
    type(control('Title'), 'VPN drops');
    await submit(form());
    await until(() => expect(more.open).toBe(true));
    expect(more.textContent).toContain('Cost centre is required for incidents');
  });
});
