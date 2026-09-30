// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanupDocument, render } from '../../web/__tests__/support/render.js';
import { prefersReducedMotion, scrollBehaviour, useReducedMotion } from '../motion.js';

/**
 * Reduced motion has two sources, as it does in the stylesheet: the operating
 * system's preference and the product's own setting, which the pre-paint
 * script and `ThemeProvider` write on `<html>` as `data-itsm-motion`.
 */

let osReduced = false;
const listeners = new Set<() => void>();

function stubMatchMedia(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return query === '(prefers-reduced-motion: reduce)' && osReduced;
    },
    media: query,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  }));
}

function setOs(reduced: boolean): void {
  osReduced = reduced;
  for (const listener of listeners) listener();
}

afterEach(() => {
  cleanupDocument();
  vi.unstubAllGlobals();
  osReduced = false;
  listeners.clear();
  document.documentElement.removeAttribute('data-itsm-motion');
});

describe('prefersReducedMotion', () => {
  it('is false with no preference anywhere, and without matchMedia', () => {
    expect(prefersReducedMotion()).toBe(false);
    stubMatchMedia();
    expect(prefersReducedMotion()).toBe(false);
    expect(scrollBehaviour()).toBe('smooth');
  });

  it('follows the operating system', () => {
    stubMatchMedia();
    setOs(true);
    expect(prefersReducedMotion()).toBe(true);
    expect(scrollBehaviour()).toBe('auto');
  });

  it('follows the product setting on <html>, even where the system allows motion', () => {
    stubMatchMedia();
    document.documentElement.setAttribute('data-itsm-motion', 'reduced');
    expect(prefersReducedMotion()).toBe(true);
    expect(scrollBehaviour()).toBe('auto');
  });
});

describe('useReducedMotion', () => {
  function Probe() {
    return <span data-reduced={String(useReducedMotion())} />;
  }
  const read = (container: HTMLElement) => container.querySelector('span')!.getAttribute('data-reduced');

  it('updates when the operating system preference changes', () => {
    stubMatchMedia();
    const { container } = render(<Probe />);
    expect(read(container)).toBe('false');
    act(() => setOs(true));
    expect(read(container)).toBe('true');
    act(() => setOs(false));
    expect(read(container)).toBe('false');
  });

  it('updates when the product setting is switched on and off', async () => {
    stubMatchMedia();
    const { container } = render(<Probe />);
    expect(read(container)).toBe('false');

    // MutationObserver callbacks are microtasks; let them run inside act.
    await act(async () => {
      document.documentElement.setAttribute('data-itsm-motion', 'reduced');
    });
    expect(read(container)).toBe('true');

    await act(async () => {
      document.documentElement.removeAttribute('data-itsm-motion');
    });
    expect(read(container)).toBe('false');
  });

  it('stops listening once unmounted', () => {
    stubMatchMedia();
    const { unmount } = render(<Probe />);
    expect(listeners.size).toBe(1);
    unmount();
    expect(listeners.size).toBe(0);
  });
});
