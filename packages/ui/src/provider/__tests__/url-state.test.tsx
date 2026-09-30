// @vitest-environment jsdom
import {
  act,
  createContext,
  startTransition,
  Suspense,
  use,
  useContext,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupDocument, render } from '../../web/__tests__/support/render.js';
import { nextSearch, useUrlState, type UrlCodec, type UrlStateOptions } from '../url-state.js';
import { TestProvider } from './support/provider.js';

/*
 * `useUrlState` (SPEC §4.1, D12): server state through the app router in a
 * transition; view state (`shallow`) through the History API with no server
 * round trip. A filter change drops the cursor; other parameters survive; the
 * value moves at once and settles when the navigation commits.
 *
 * The fake router behaves as Next's does where it matters: a navigation is a
 * transition that suspends until the new page's data arrives, and a
 * `history.replaceState` is picked up by `useSearchParams`.
 */

interface Filters {
  readonly status: string;
  readonly sort: string;
  readonly cursor: string | null;
}

const codec: UrlCodec<Filters> = {
  parse: (params) => ({
    status: params.get('status') ?? 'open',
    sort: params.get('sort') ?? 'updated',
    cursor: params.get('cursor'),
  }),
  serialise: (value) => ({
    status: value.status === 'open' ? undefined : value.status,
    sort: value.sort === 'updated' ? undefined : value.sort,
    cursor: value.cursor ?? undefined,
  }),
};

interface Nav {
  readonly search: string;
  readonly gate: Promise<void> | null;
}

const NavContext = createContext<Nav>({ search: '', gate: null });

interface Harness {
  setNav: (nav: Nav) => void;
  release: (() => void) | null;
  suspend: boolean;
}

const harness: Harness = { setNav: () => undefined, release: null, suspend: false };

const router = {
  push: vi.fn((href: string) => navigate(href)),
  replace: vi.fn((href: string) => navigate(href)),
  back: vi.fn(),
};

function navigate(href: string): void {
  const search = new URL(href, 'http://localhost').search.replace(/^\?/, '');
  let gate: Promise<void> | null = null;
  if (harness.suspend) {
    gate = new Promise<void>((resolve) => {
      harness.release = resolve;
    });
  }
  // Next wraps its navigation in a transition of its own; nested in ours, it
  // is the same one.
  startTransition(() => harness.setNav({ search, gate }));
}

function useSearchParams(): URLSearchParams {
  const { search } = useContext(NavContext);
  return useMemo(() => new URLSearchParams(search), [search]);
}

const usePathname = (): string => '/tickets';

/** Suspends while a navigation's data is "loading", as a server component payload does. */
function Gate(): null {
  const { gate } = useContext(NavContext);
  if (gate) use(gate);
  return null;
}

function Router({ initial, children }: { initial: string; children: ReactNode }): ReactElement {
  const [nav, setNav] = useState<Nav>({ search: initial, gate: null });
  harness.setNav = setNav;
  return (
    <NavContext value={nav}>
      <Suspense fallback={null}>
        <Gate />
        <TestProvider router={router} useSearchParams={useSearchParams} usePathname={usePathname}>
          {children}
        </TestProvider>
      </Suspense>
    </NavContext>
  );
}

let setFilters: ((next: Partial<Filters>) => void) | null = null;

function Probe({ options }: { options?: UrlStateOptions }): ReactElement {
  const [value, set, { isPending }] = useUrlState(codec, options);
  setFilters = set;
  return <output data-pending={String(isPending)}>{`${value.status}/${value.sort}/${value.cursor ?? '-'}`}</output>;
}

function mount(initial: string, options?: UrlStateOptions) {
  window.history.replaceState(null, '', `/tickets${initial ? `?${initial}` : ''}`);
  const result = render(
    <Router initial={initial}>
      <Probe {...(options ? { options } : {})} />
    </Router>,
  );
  const read = () => result.container.querySelector('output')!;
  return { ...result, read };
}

beforeEach(() => {
  router.push.mockClear();
  router.replace.mockClear();
  harness.suspend = false;
  harness.release = null;
});

afterEach(() => {
  cleanupDocument();
  vi.restoreAllMocks();
  setFilters = null;
  window.history.replaceState(null, '', '/');
});

describe('nextSearch', () => {
  it('rewrites the codec’s keys and keeps every other parameter where it was', () => {
    expect(nextSearch(codec, 'open=rule%3Avip&status=paused&utm=x', { status: 'resolved' })).toBe('open=rule%3Avip&status=resolved&utm=x');
  });

  it('removes a value that returns to its default', () => {
    expect(nextSearch(codec, 'status=paused', { status: 'open' })).toBe('');
  });

  it('drops the cursor when a filter changes, and keeps it when only the cursor does', () => {
    expect(nextSearch(codec, 'status=paused&cursor=abc', { sort: 'priority' })).toBe('status=paused&sort=priority');
    expect(nextSearch(codec, 'status=paused&cursor=abc', { cursor: 'def' })).toBe('status=paused&cursor=def');
  });

  it('says so when nothing changes, so no navigation is made', () => {
    expect(nextSearch(codec, 'status=paused', { status: 'paused' })).toBeNull();
  });
});

describe('useUrlState through the router', () => {
  it('reads the value from the provider’s search params', () => {
    const { read } = mount('status=paused&cursor=abc');
    expect(read().textContent).toBe('paused/updated/abc');
  });

  it('replaces the URL through the router, without scrolling, and drops the cursor', () => {
    const { read } = mount('status=paused&cursor=abc');
    act(() => setFilters!({ sort: 'priority' }));
    expect(router.replace).toHaveBeenCalledWith('/tickets?status=paused&sort=priority', { scroll: false });
    expect(router.push).not.toHaveBeenCalled();
    expect(read().textContent).toBe('paused/priority/-');
  });

  it('pushes a history entry when asked', () => {
    mount('', { history: 'push' });
    act(() => setFilters!({ status: 'resolved' }));
    expect(router.push).toHaveBeenCalledWith('/tickets?status=resolved', { scroll: false });
  });

  it('makes no navigation for a change that changes nothing', () => {
    mount('status=paused');
    act(() => setFilters!({ status: 'paused' }));
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('lands two writes made in one event', () => {
    mount('');
    act(() => {
      setFilters!({ status: 'paused' });
      setFilters!({ sort: 'priority' });
    });
    expect(router.replace).toHaveBeenLastCalledWith('/tickets?status=paused&sort=priority', { scroll: false });
  });

  it('shows the new value at once and reports pending until the navigation commits', async () => {
    harness.suspend = true;
    const { read } = mount('');
    await act(async () => setFilters!({ status: 'paused' }));
    expect(read().textContent).toBe('paused/updated/-');
    expect(read().dataset.pending).toBe('true');
    expect(router.replace).toHaveBeenCalledWith('/tickets?status=paused', { scroll: false });
    await act(async () => {
      harness.release!();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(read().textContent).toBe('paused/updated/-');
    expect(read().dataset.pending).toBe('false');
  });
});

describe('useUrlState, shallow', () => {
  it('writes with history.replaceState and never asks the server', () => {
    const { read } = mount('status=paused', { shallow: true });
    const replace = vi.spyOn(window.history, 'replaceState');
    // Next picks the change up from its history patch; the fake does the same.
    replace.mockImplementation(function (this: History, data, unused, url) {
      History.prototype.replaceState.call(this, data, unused, url);
      harness.setNav({ search: window.location.search.replace(/^\?/, ''), gate: null });
    });
    act(() => setFilters!({ sort: 'priority' }));
    expect(replace).toHaveBeenCalledWith(null, '', '/tickets?status=paused&sort=priority');
    expect(router.replace).not.toHaveBeenCalled();
    expect(read().textContent).toBe('paused/priority/-');
  });

  it('pushes an entry for a drawer, so Back closes it', () => {
    mount('', { shallow: true, history: 'push' });
    const push = vi.spyOn(window.history, 'pushState');
    act(() => setFilters!({ status: 'resolved' }));
    expect(push).toHaveBeenCalledWith(null, '', '/tickets?status=resolved');
  });

  it('builds on the URL as it is now, not as it was rendered', () => {
    mount('', { shallow: true });
    const replace = vi.spyOn(window.history, 'replaceState');
    act(() => {
      setFilters!({ status: 'paused' });
      setFilters!({ sort: 'priority' });
    });
    expect(replace).toHaveBeenLastCalledWith(null, '', '/tickets?status=paused&sort=priority');
  });
});
