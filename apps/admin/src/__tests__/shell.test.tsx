// @vitest-environment jsdom
import { act, forwardRef, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let pathname = '/rules';
const router = { refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), forward: vi.fn() };
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(),
}));

const { ItsmProvider } = await import('@itsm/ui');
const { AdminShell, PublishNavBadges } = await import('../components/AdminShell.js');
const { goToCommands, createCommands, findIn, fold, setCommandPaletteOpen } = await import('../client/palette.js');
const { accessGroups } = await import('../components/AdminOverlays.js');
const { Forbidden } = await import('../components/Forbidden.js');
const { cleanupDocument, render } = await import('./support/render.js');

/**
 * The frame, rendered: the sidebar is the person's own navigation, ⌘K / Ctrl
 * K opens the palette from inside a text field (D14), the palette finds
 * pages by the words people use, and a refused page keeps its header.
 */

const Link = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean | null }>(function Link(
  { prefetch: _prefetch, ...props },
  ref,
) {
  return <a ref={ref} {...props} />;
});

function grants(...keys: string[]): { key: string; scope: string }[] {
  return keys.map((key) => ({ key, scope: 'any' }));
}

function Frame({ permissions, children }: { readonly permissions: { key: string; scope: string }[]; readonly children?: ReactNode }): ReactNode {
  return (
    <ItsmProvider
      app="admin"
      Link={Link}
      router={router}
      usePathname={() => pathname}
      useSearchParams={() => new URLSearchParams()}
      locale="en-GB"
      timeZone="Europe/London"
    >
      <AdminShell person={{ name: 'Ada Admin', detail: 'Acme' }} tenant={{ name: 'Acme' }} permissions={permissions} switcher={[]}>
        {children ?? (
          <main>
            <h1>Rules</h1>
            <input aria-label="Search rules" />
          </main>
        )}
      </AdminShell>
    </ItsmProvider>
  );
}

beforeEach(() => {
  pathname = '/rules';
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
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
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ unread: 2, data: [] }), { status: 200, headers: { 'content-type': 'application/json' } })),
  );
});

afterEach(() => {
  act(() => setCommandPaletteOpen(false));
  cleanupDocument();
  vi.unstubAllGlobals();
});

async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

describe('the frame', () => {
  it('draws the person’s own navigation, with the current page marked', async () => {
    const { container } = render(<Frame permissions={grants('rules.rule.read', 'ticket.read', 'notification.read')} />);
    await settle();
    const nav = container.querySelector('nav[aria-label="Administration"]')!;
    const labels = [...nav.querySelectorAll('a')].map((link) => link.textContent?.trim());
    expect(labels).toEqual(expect.arrayContaining(['Command centre', 'Tickets', 'Rules']));
    expect(labels).not.toContain('Workflows');
    expect(labels).not.toContain('Tenants');
    expect(nav.querySelector('a[aria-current="page"]')?.getAttribute('href')).toBe('/rules');
  });

  it('shows the platform group to an operator only', async () => {
    const { container } = render(<Frame permissions={grants('platform.tenant.manage')} />);
    await settle();
    const links = [...container.querySelectorAll('nav[aria-label="Administration"] a')].map((link) => link.getAttribute('href'));
    expect(links).toEqual(expect.arrayContaining(['/tenants', '/plans']));
  });

  it('opens the command palette with Ctrl K from inside a text field', async () => {
    const { container } = render(<Frame permissions={grants('rules.rule.read', 'workload.read')} />);
    await settle();
    const field = container.querySelector<HTMLInputElement>('input[aria-label="Search rules"]')!;
    field.focus();
    await act(async () => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
    });
    await settle();
    const input = document.body.querySelector<HTMLInputElement>('input.itsm-CommandPalette__input');
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    // "Go to" lists the pages this person may open.
    const options = [...document.body.querySelectorAll('[role="option"]')].map((option) => option.textContent ?? '');
    expect(options.some((text) => text.includes('Workforce'))).toBe(true);
    expect(options.some((text) => text.includes('Integrations'))).toBe(false);
  });

  it('goes to a page with g then its letter, only where the person may open it', async () => {
    render(<Frame permissions={grants('ticket.read')} />);
    await settle();
    const press = (key: string): void => {
      act(() => {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      });
    };
    press('g');
    press('t');
    expect(router.push).toHaveBeenLastCalledWith('/tickets');
    router.push.mockClear();
    press('g');
    press('r');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('shows streamed badge counts beside their items', async () => {
    const { container } = render(
      <>
        <Frame permissions={grants('workflow.read')} />
        <PublishNavBadges values={{ failedRuns: { value: 3 } }} />
      </>,
    );
    await settle();
    const workflows = [...container.querySelectorAll('nav[aria-label="Administration"] a')].find((link) => link.getAttribute('href') === '/workflows');
    expect(workflows?.textContent).toContain('3');
    act(() => {
      render(<PublishNavBadges values={{}} />);
    });
  });
});

describe('the palette', () => {
  it('finds pages by the words people use for them', () => {
    const everything = { permissions: grants('workload.read', 'admin.setting.read', 'sla.policy.read', 'catalogue.manage') };
    const items = goToCommands(everything);
    const find = (word: string): string[] =>
      items.filter((item) => [item.label, ...(item.keywords ?? [])].some((text) => fold(text).includes(fold(word)))).map((item) => item.label);
    expect(find('queues')).toContain('Workforce');
    expect(find('configuration')).toContain('Settings');
    expect(find('flags')).toContain('Settings');
    expect(find('sla')).toContain('Service levels');
    expect(find('forms')).toContain('Services & requests');
  });

  it('offers creation only to people who may create', () => {
    expect(createCommands({ permissions: grants('rules.rule.read') })).toEqual([]);
    expect(createCommands({ permissions: grants('sla.policy.manage') }).map((item) => item.label)).toContain('New SLA policy');
  });

  it('matches every word, accents aside, best first', () => {
    const rows = [{ name: 'VIP requester' }, { name: 'Escalate VIP' }, { name: 'Café opening hours' }];
    expect(findIn(rows, 'vip', (row) => [row.name]).map((row) => row.name)).toEqual(['VIP requester', 'Escalate VIP']);
    expect(findIn(rows, 'cafe hours', (row) => [row.name]).map((row) => row.name)).toEqual(['Café opening hours']);
    expect(findIn(rows, '   ', (row) => [row.name])).toEqual([]);
  });
});

describe('Your access', () => {
  it('lists permissions in words, grouped, each once at its widest scope', () => {
    const groups = accessGroups({
      permissions: [
        { key: 'ticket.read', scope: 'team' },
        { key: 'ticket.read', scope: 'any' },
        { key: 'rules.rule.read', scope: 'any' },
      ],
    });
    expect(groups).toEqual([
      { area: 'Rules', entries: [{ key: 'rules.rule.read', label: 'Read rules', scope: 'any' }] },
      { area: 'Tickets', entries: [{ key: 'ticket.read', label: 'Read tickets', scope: 'any' }] },
    ]);
  });
});

describe('Forbidden', () => {
  it('keeps the page’s header and names the permission to ask for', async () => {
    const { container } = render(
      <ItsmProvider app="admin" Link={Link} router={router} usePathname={() => pathname} useSearchParams={() => new URLSearchParams()} locale="en-GB" timeZone="UTC">
        <Forbidden route="/rules" />
      </ItsmProvider>,
    );
    await settle();
    expect(container.querySelector('h1')?.textContent).toBe('Rules');
    expect(container.textContent).toContain("You don't have access to Rules");
    expect(container.textContent).toContain('Read rules');
  });
});
