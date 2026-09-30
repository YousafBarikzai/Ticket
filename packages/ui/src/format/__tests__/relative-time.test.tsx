// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupDocument, render } from '../../web/__tests__/support/render.js';
import { TestProvider } from '../../provider/__tests__/support/provider.js';
import { CLOCK_INTERVAL_MS } from '../../provider/clock.js';
import { RelativeTime } from '../RelativeTime.js';

/*
 * `RelativeTime` (SPEC §3.6 rule 8, §4.1): absolute time on the server, in the
 * reader's zone; the same on the first client render, so hydration finds what
 * it expects; relative once hydrated, moving on with the shared clock.
 */

const NOW = Date.parse('2026-09-29T12:00:00Z');

function inProvider(element: ReactElement): ReactElement {
  return <TestProvider timeZone="Europe/London">{element}</TestProvider>;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  cleanupDocument();
  vi.useRealTimers();
});

describe('on the server', () => {
  it('renders the absolute time in the reader’s zone, with the machine-readable one alongside', () => {
    const html = renderToString(inProvider(<RelativeTime date="2026-09-29T11:57:00Z" />));
    expect(html).toContain('dateTime="2026-09-29T11:57:00Z"');
    // 11:57 UTC is 12:57 in London in September.
    expect(html).toMatch(/>29 Sept? 2026, 12:57</);
    expect(html).not.toContain('ago');
  });
});

describe('in the browser', () => {
  it('hydrates without a mismatch, then reads relative', async () => {
    const element = inProvider(<RelativeTime date="2026-09-29T11:57:00Z" />);
    const container = document.createElement('div');
    container.innerHTML = renderToString(element);
    document.body.appendChild(container);
    const errors: unknown[] = [];
    const consoleError = vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args));
    let root: ReturnType<typeof hydrateRoot> | null = null;
    await act(async () => {
      root = hydrateRoot(container, element, { onRecoverableError: (error) => errors.push(error) });
    });
    expect(errors).toEqual([]);
    expect(container.querySelector('time')!.textContent).toBe('3 min ago');
    consoleError.mockRestore();
    act(() => root!.unmount());
  });

  it('reads relative from the first render when mounted on a client navigation', () => {
    const { container } = render(inProvider(<RelativeTime date="2026-09-29T11:57:00Z" />));
    const time = container.querySelector('time')!;
    expect(time.textContent).toBe('3 min ago');
    expect(time.dataset.relative).toBe('');
    expect(time.title).toMatch(/Tuesday,? 29 September 2026 at 12:57/);
  });

  it('moves on with the shared clock', () => {
    // Outside the provider: the clock is the page's, not the provider's, and
    // a minute of fake time inside one would also mount its idle toaster.
    const { container } = render(
      <>
        <RelativeTime date="2026-09-29T11:57:00Z" />
        <RelativeTime date="2026-09-29T11:59:50Z" relativeStyle="long" />
      </>,
    );
    const [first, second] = [...container.querySelectorAll('time')];
    expect(second!.textContent).toBe('now');
    act(() => void vi.advanceTimersByTime(CLOCK_INTERVAL_MS * 2));
    expect(first!.textContent).toBe('4 min ago');
    expect(second!.textContent).toBe('1 minute ago');
  });

  it('shows the date past a week in auto mode, and always relative when asked', () => {
    const { container } = render(
      inProvider(
        <>
          <RelativeTime date="2026-09-01T09:00:00Z" absoluteStyle="date" />
          <RelativeTime date="2026-09-01T09:00:00Z" mode="relative" relativeStyle="long" />
          <RelativeTime date="2026-09-29T11:57:00Z" mode="absolute" absoluteStyle="time" />
        </>,
      ),
    );
    const [auto, relative, absolute] = [...container.querySelectorAll('time')].map((time) => time.textContent);
    expect(auto).toMatch(/^1 Sept? 2026$/);
    expect(relative).toBe('4 weeks ago');
    expect(absolute).toBe('12:57');
  });

  it('formats in en-GB and UTC outside a provider rather than failing', () => {
    const { container } = render(<RelativeTime date="2026-09-29T11:57:00Z" mode="absolute" absoluteStyle="time" />);
    expect(container.querySelector('time')!.textContent).toBe('11:57');
  });

  it('shows an unreadable timestamp as written', () => {
    const { container } = render(inProvider(<RelativeTime date="yesterday-ish" />));
    const time = container.querySelector('time')!;
    expect(time.textContent).toBe('yesterday-ish');
    expect(time.hasAttribute('title')).toBe(false);
  });
});
