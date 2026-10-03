// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { notFound, redirect } from 'next/navigation';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_COPY, demoDisabledSentence } from '@itsm/contracts/demo';
import { ApiError, type Me, type ProblemDetails } from '@itsm/sdk';
import { CardProblem } from '../components/CardProblem.js';
import { DIALOG_RECHECK_MS, RefreshOnLive, dialogOpen } from '../components/RefreshOnLive.js';
import { agentTeamIds, demoDisabled, demoLock, employeeUserId, isDemo } from '../server/demo.js';
import { orNullWhenForbidden, problemFrom, settle } from '../server/settle.js';
import { cleanupDocument, render } from './support/render.js';

/**
 * The Service Desk's shared page helpers (WP-38; A6 §3.2, §3.6, §3.7; SPEC
 * §7.0.2, §7.0.6, §7.0.7): `settle()` loaders that never throw a failed read
 * into a page, the one reader of `me.demo`, the card that says its read
 * failed, and the island that keeps a server-rendered dashboard current.
 */

const live = vi.hoisted(() => ({
  options: null as null | {
    entity?: string | readonly string[];
    topics?: readonly string[];
    onNotice?: (notice: unknown) => void;
    onReconnect?: () => void;
    enabled?: boolean;
  },
  refresh: vi.fn(),
}));

vi.mock('@itsm/pwa/live', () => ({
  useLive: (options: typeof live.options) => {
    live.options = options;
    return { state: 'live', retry: () => undefined };
  },
}));

// Only the router: `redirect`, `notFound` and `unstable_rethrow` stay Next's own, so settle() is tested against the real control flow.
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: live.refresh, push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
}));

beforeEach(() => {
  live.options = null;
  live.refresh.mockReset();
});

afterEach(() => {
  cleanupDocument();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function problem(status: number, code: string, extra: Partial<ProblemDetails> = {}): ProblemDetails {
  return { type: `https://docs.itsm.example/problems/${code}`, title: code.replace(/_/g, ' '), status, correlationId: 'c-1', ...extra };
}

/* ------------------------------------------------------------------ settle */

describe('settle()', () => {
  it('passes a value through as { ok: true, value }', async () => {
    await expect(settle(Promise.resolve(42))).resolves.toEqual({ ok: true, value: 42 });
    await expect(settle(() => 'now')).resolves.toEqual({ ok: true, value: 'now' });
  });

  it('keeps an API refusal as a problem: status, code, prose and the demo members', async () => {
    const paused = await settle(Promise.reject(new ApiError(503, problem(503, 'demo_unavailable', { demo: true, reason: 'paused', detail: DEMO_COPY.unavailable }), 'x')));
    expect(paused).toEqual({
      ok: false,
      problem: { status: 503, code: 'demo_unavailable', title: 'demo unavailable', detail: DEMO_COPY.unavailable, retryable: true, reason: 'paused' },
    });

    const disabled = problemFrom(new ApiError(403, problem(403, 'demo_disabled', { demo: true, feature: 'uploads', detail: demoDisabledSentence('uploads') }), 'x'));
    expect(disabled).toMatchObject({ status: 403, code: 'demo_disabled', feature: 'uploads', retryable: false });

    const limit = problemFrom(new ApiError(429, problem(429, 'demo_limit', { demo: true, category: 'ticket.create', limit: 25 }), 'x'));
    // A 429 that waiting does not cure: never offered as retryable.
    expect(limit).toMatchObject({ status: 429, code: 'demo_limit', category: 'ticket.create', limit: 25, retryable: false });

    const wait = problemFrom(new ApiError(429, problem(429, 'rate_limited', { retryAfterSec: 20 }), 'x'));
    expect(wait).toMatchObject({ status: 429, code: 'rate_limited', retryable: true, retryAfterSeconds: 20 });

    const blank = problemFrom(new ApiError(500, null, 'boom'));
    expect(blank).toEqual({ status: 500, retryable: true });
  });

  it('never throws a failed read: a network error, a bug, a non-error, a loader that throws before its promise', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // Each made when it is settled, so no rejection sits unhandled between cases.
    const failures: (() => unknown)[] = [
      () => Promise.reject(new TypeError('fetch failed')),
      () => Promise.reject('a string'),
      () => Promise.reject(undefined),
      () => {
        throw new Error('thrown before any promise');
      },
      async () => {
        throw new RangeError('inside the loader');
      },
    ];
    for (const failure of failures) {
      const settled = await settle(failure);
      expect(settled).toEqual({ ok: false, problem: { status: 503, retryable: true } });
    }
    // Swallowed by the card, so said on the server — but an API answer is not a fault to log.
    expect(logged).toHaveBeenCalledTimes(failures.length);
    logged.mockClear();
    await settle(Promise.reject(new ApiError(404, problem(404, 'not_found'), 'x')));
    expect(logged).not.toHaveBeenCalled();
  });

  it("lets Next's own control flow through: a redirect to sign in is not a card's failure", async () => {
    await expect(settle(async () => redirect('/api/session/login?redirectTo=%2Foverview'))).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') });
    await expect(settle(() => notFound())).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_HTTP_ERROR_FALLBACK;404') });
  });

  it('turns a 403 into "render nothing" for D9, and leaves every other outcome alone', () => {
    const forbidden = { ok: false as const, problem: { status: 403, code: 'forbidden' } };
    expect(orNullWhenForbidden(forbidden)).toEqual({ ok: true, value: null });
    const suspended = { ok: false as const, problem: { status: 403, code: 'tenant_suspended' } };
    expect(orNullWhenForbidden(suspended)).toBe(suspended);
    const down = { ok: false as const, problem: { status: 503 } };
    expect(orNullWhenForbidden(down)).toBe(down);
    expect(orNullWhenForbidden({ ok: true, value: 7 })).toEqual({ ok: true, value: 7 });
  });
});

/* ------------------------------------------------------------- demo reader */

const demoMe: Pick<Me, 'demo'> = {
  demo: {
    persona: 'agent',
    area: 'workbench',
    generation: 12,
    company: 'Northwind Traders (UK)',
    disabledFeatures: ['uploads', 'roles', 'a-feature-from-a-newer-api'],
    personaUserIds: { employee: 'u-emma', agent: 'u-alex', admin: 'u-jordan' },
    agentTeamIds: ['t-service-desk', 't-network'],
  },
};

describe('the demo reader (server/demo.ts)', () => {
  it('gives a real account the full product: no demo, nothing locked, no personas', () => {
    for (const me of [{}, { demo: undefined }, null, undefined] as const) {
      expect(isDemo(me)).toBe(false);
      expect(demoDisabled(me, 'uploads')).toBeNull();
      expect(demoLock(me, 'uploads')).toEqual({});
      expect(employeeUserId(me)).toBeNull();
      expect(agentTeamIds(me)).toEqual([]);
    }
  });

  it('locks a feature the demo turns off with the canonical sentence, and only that feature', () => {
    expect(isDemo(demoMe)).toBe(true);
    expect(demoDisabled(demoMe, 'uploads')).toBe(demoDisabledSentence('uploads'));
    expect(demoDisabled(demoMe, 'uploads')).toBe('This is a shared demo, so uploading files is turned off. Everything else works as in the full product.');
    expect(demoDisabled(demoMe, 'integrations')).toBeNull();
    expect(demoLock(demoMe, 'roles')).toEqual({ disabledReason: demoDisabledSentence('roles'), disabledIcon: 'lock' });
    expect(demoLock(demoMe, 'integrations')).toEqual({});
  });

  it('names the personas of this generation, and nothing it cannot trust', () => {
    expect(employeeUserId(demoMe)).toBe('u-emma');
    expect(agentTeamIds(demoMe)).toEqual(['t-service-desk', 't-network']);
    const odd = { demo: { ...demoMe.demo!, personaUserIds: { employee: '', agent: 'u-alex', admin: 'u-jordan' }, agentTeamIds: ['t-1', '', 7 as unknown as string] } };
    expect(employeeUserId(odd)).toBeNull();
    expect(agentTeamIds(odd)).toEqual(['t-1']);
  });
});

/* ------------------------------------------------------------- CardProblem */

const text = (element: Element | null | undefined): string => element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

describe('CardProblem', () => {
  it("says describeProblem()'s title for the card, and offers Try again as a plain link to the same URL", () => {
    const { container } = render(<CardProblem problem={{ status: 503 }} context="Your queue" />);
    const card = container.querySelector('.app-CardProblem')!;
    expect(text(card.querySelector('h3'))).toBe("Couldn't load your queue");
    const retry = card.querySelector('a')!;
    expect(text(retry)).toBe('Try again');
    // "" is the page's own address, query and all: a full load, never a client navigation.
    expect(retry.getAttribute('href')).toBe('');
    expect(card.getAttribute('role')).toBe('alert');
    expect(card.getAttribute('data-kind')).toBe('unavailable');
  });

  it('links Try again to the address it is given', () => {
    const { container } = render(<CardProblem problem={{ status: 500 }} retryHref="/overview?range=7d" />);
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/overview?range=7d');
  });

  it('offers nothing to press where trying again cannot help', () => {
    for (const failure of [{ status: 403 }, { status: 404 }, { status: 429, code: 'demo_limit' }, { status: 403, code: 'demo_disabled' }]) {
      const { container, unmount } = render(<CardProblem problem={failure} context="Team trend" />);
      expect(container.querySelector('a')).toBeNull();
      unmount();
    }
  });

  it('says a paused demo plainly, in a neutral look rather than an alarm', () => {
    const { container } = render(<CardProblem problem={{ status: 503, code: 'demo_unavailable' }} context="Your queue" />);
    const card = container.querySelector('.app-CardProblem')!;
    expect(text(card.querySelector('h3'))).toBe('The demo is paused or being prepared');
    expect(card.getAttribute('role')).toBeNull();
    expect(card.getAttribute('data-kind')).toBe('demoUnavailable');
    expect(text(card.querySelector('a'))).toBe('Try again');
  });

  it('offers "Continue the demo" when the visit ended', () => {
    const { container } = render(<CardProblem problem={{ status: 401, code: 'demo_session_ended' }} />);
    expect(text(container.querySelector('h3'))).toBe(DEMO_COPY.sessionEnded);
    expect(text(container.querySelector('a'))).toBe(DEMO_COPY.continueDemo);
  });

  it('fits one line in a board column', () => {
    const { container } = render(<CardProblem problem={{ status: 502 }} context="Waiting" size="compact" retryHref="/board" />);
    const line = container.querySelector('.app-CardProblem')!;
    expect(line.classList.contains('itsm-InlineAlert')).toBe(true);
    expect(text(line)).toBe("Couldn't load waiting · Try again");
    expect(line.querySelector('a')?.getAttribute('href')).toBe('/board');
    expect(line.querySelector('h3')).toBeNull();
  });

  it('renders as a server component, with no provider', () => {
    const html = renderToStaticMarkup(<CardProblem problem={{ status: 503 }} context="Needs you" headingLevel={4} />);
    expect(html).toContain('<h4');
    expect(html).toContain("Couldn&#x27;t load needs you");
    expect(html).toContain('href=""');
  });

  it('is axe clean in both sizes and in the demo states', async () => {
    const { container } = render(
      <div>
        <CardProblem problem={{ status: 503 }} context="Your queue" />
        <CardProblem problem={{ status: 503, code: 'demo_unavailable' }} />
        <CardProblem problem={{ status: 403 }} context="Team trend" />
        <CardProblem problem={{ status: 502 }} context="Waiting" size="compact" />
        <CardProblem problem={{ status: 401, code: 'demo_session_ended' }} size="compact" />
      </div>,
    );
    const { violations, passed } = await audit(container);
    expect(violations).toEqual([]);
    expect(passed).toEqual(expect.arrayContaining(['link-name', 'aria-allowed-role']));
  });
});

/*
 * axe-core is the design system's devDependency; this app has none of its own
 * (a dependency line is an integrator's, SPEC §15.0 rule 9). It is resolved
 * through `@itsm/ui`, as `apps/admin`'s audits do.
 */
interface AxeRule {
  readonly id: string;
  readonly nodes: readonly { readonly html: string }[];
}
interface Axe {
  run(context: Element, options: Record<string, unknown>): Promise<{ violations: AxeRule[]; passes: AxeRule[] }>;
}
const axe = createRequire(createRequire(import.meta.url).resolve('@itsm/ui'))('axe-core') as Axe;
/** Rules a detached fragment cannot answer, and rules that need a layout engine jsdom lacks. */
const OFF = ['region', 'page-has-heading-one', 'html-has-lang', 'landmark-one-main', 'bypass', 'document-title', 'html-lang-valid', 'color-contrast', 'color-contrast-enhanced', 'target-size'];
async function audit(container: Element): Promise<{ violations: string[]; passed: string[] }> {
  const results = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
    rules: Object.fromEntries(OFF.map((rule) => [rule, { enabled: false }])),
  });
  return {
    violations: results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.html).join(' | ')}`),
    passed: results.passes.map((rule) => rule.id),
  };
}

/* ------------------------------------------------------------ RefreshOnLive */

describe('RefreshOnLive', () => {
  const notice = (): void => {
    act(() => live.options?.onNotice?.({ entity: 'ticket', id: 't-1' }));
  };
  const advance = (ms: number): void => {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  };
  const setVisibility = (state: 'visible' | 'hidden'): void => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
  };

  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-10-02T09:00:00Z') });
    setVisibility('visible');
  });

  it("listens for ticket notices on the page's one stream, with the page's own topics, and draws nothing", () => {
    const { container } = render(<RefreshOnLive topics={['incident:MI-0004']} />);
    expect(container.innerHTML).toBe('');
    expect(live.options).toMatchObject({ entity: 'ticket', topics: ['incident:MI-0004'], enabled: true });
  });

  it('debounce: a burst of notices is one refresh, ten seconds after the last', () => {
    render(<RefreshOnLive />);
    notice();
    advance(2_000);
    notice();
    advance(2_000);
    notice();
    advance(9_999);
    expect(live.refresh).not.toHaveBeenCalled();
    advance(1);
    expect(live.refresh).toHaveBeenCalledTimes(1);
    advance(60_000);
    expect(live.refresh).toHaveBeenCalledTimes(1);
  });

  it('debounce: the war room waits five seconds', () => {
    render(<RefreshOnLive debounceMs={5_000} />);
    notice();
    advance(4_999);
    expect(live.refresh).not.toHaveBeenCalled();
    advance(1);
    expect(live.refresh).toHaveBeenCalledTimes(1);
  });

  it('debounce: a desk that never goes quiet still refreshes, within three debounces of the first notice', () => {
    render(<RefreshOnLive />);
    for (let second = 0; second < 30; second += 4) {
      notice();
      advance(4_000);
    }
    // Notices every 4 s never leave 10 s of quiet; the wait is capped at 30 s.
    expect(live.refresh).toHaveBeenCalledTimes(1);
  });

  it('reconnect: refreshes at once, because notices may have been missed', () => {
    render(<RefreshOnLive />);
    act(() => live.options?.onReconnect?.());
    advance(0);
    expect(live.refresh).toHaveBeenCalledTimes(1);
  });

  it('focus after 60 s: coming back to a tab hidden for more than a minute refreshes; a shorter absence does not', () => {
    render(<RefreshOnLive />);
    setVisibility('hidden');
    advance(30_000);
    setVisibility('visible');
    advance(0);
    expect(live.refresh).not.toHaveBeenCalled();

    setVisibility('hidden');
    advance(61_000);
    setVisibility('visible');
    advance(0);
    expect(live.refresh).toHaveBeenCalledTimes(1);
  });

  it('never while a dialog is open: the refresh waits for it to close', () => {
    render(<RefreshOnLive />);
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.append(dialog);
    expect(dialogOpen()).toBe(true);

    notice();
    advance(10_000 + 5 * DIALOG_RECHECK_MS);
    expect(live.refresh).not.toHaveBeenCalled();
    act(() => live.options?.onReconnect?.());
    advance(DIALOG_RECHECK_MS);
    expect(live.refresh).not.toHaveBeenCalled();

    dialog.remove();
    expect(dialogOpen()).toBe(false);
    advance(DIALOG_RECHECK_MS);
    expect(live.refresh).toHaveBeenCalledTimes(1);
  });

  it('nothing fires after the page has gone', () => {
    const { unmount } = render(<RefreshOnLive />);
    notice();
    unmount();
    advance(60_000);
    expect(live.refresh).not.toHaveBeenCalled();
  });

  it('stays out of the way when switched off', () => {
    render(<RefreshOnLive enabled={false} />);
    expect(live.options?.enabled).toBe(false);
    setVisibility('hidden');
    advance(120_000);
    setVisibility('visible');
    advance(0);
    expect(live.refresh).not.toHaveBeenCalled();
  });
});
