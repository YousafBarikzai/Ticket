// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupDocument, render } from '../../web/__tests__/support/render.js';
import { preferenceAttributeNames, type AppName, type Prefs } from '../prefs.js';
import { themeInitScript } from '../theme-script.js';
import { ThemeProvider, useTheme, type ThemeContextValue } from '../ThemeProvider.js';

/**
 * `ThemeProvider` v2: preferences after first paint.
 *
 * The provider has to take over from the inline script without disturbing
 * what it did, keep storage and `<html>` in step with every change, follow the
 * device while a preference is on "system", and keep the single-setting API
 * the applications still use working until they move to `prefs`.
 */

interface FakeList {
  matches: boolean;
  listeners: Set<() => void>;
}

const lists = new Map<string, FakeList>();

function device(settings: { dark?: boolean; moreContrast?: boolean; reducedMotion?: boolean }): void {
  const values: Record<string, boolean | undefined> = {
    '(prefers-color-scheme: dark)': settings.dark,
    '(prefers-contrast: more)': settings.moreContrast,
    '(prefers-reduced-motion: reduce)': settings.reducedMotion,
  };
  for (const [query, matches] of Object.entries(values)) {
    if (matches === undefined) continue;
    const list = lists.get(query) ?? { matches: false, listeners: new Set() };
    list.matches = matches;
    lists.set(query, list);
    for (const listener of list.listeners) listener();
  }
}

function installMatchMedia(): void {
  vi.stubGlobal('matchMedia', (query: string) => {
    const list = lists.get(query) ?? { matches: false, listeners: new Set<() => void>() };
    lists.set(query, list);
    return {
      get matches() {
        return list.matches;
      },
      media: query,
      addEventListener: (_: string, listener: () => void) => list.listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => list.listeners.delete(listener),
    };
  });
}

let latest: ThemeContextValue;

function Probe(): null {
  latest = useTheme();
  return null;
}

function mount(props: { app?: AppName; storageKey?: string; defaults?: Partial<Prefs> } = {}) {
  return render(
    <ThemeProvider {...props}>
      <Probe />
    </ThemeProvider>,
  );
}

const root = (): HTMLElement => document.documentElement;
const stored = (): unknown => JSON.parse(localStorage.getItem('itsm-prefs') ?? 'null');

beforeEach(() => {
  lists.clear();
  installMatchMedia();
  Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
});

afterEach(() => {
  cleanupDocument();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const name of preferenceAttributeNames) root().removeAttribute(name);
  localStorage.clear();
  delete (document as { startViewTransition?: unknown }).startViewTransition;
});

describe('ThemeProvider', () => {
  it('reads what this browser stored and agrees with what the pre-paint script already set', () => {
    localStorage.setItem('itsm-prefs', JSON.stringify({ appearance: 'dark', density: 'compact' }));
    new Function(themeInitScript({ app: 'admin' }))();
    const before = Object.fromEntries(preferenceAttributeNames.map((name) => [name, root().getAttribute(name)]));
    const observer = new MutationObserver(() => undefined);
    observer.observe(root(), { attributes: true, attributeOldValue: true });

    mount({ app: 'admin' });

    // Not even for a frame: the defaults it renders with first must never
    // replace what the script set.
    const touched = observer.takeRecords().filter((record) => record.attributeName?.startsWith('data-itsm-'));
    observer.disconnect();
    expect(touched).toEqual([]);

    expect(latest.prefs.appearance).toBe('dark');
    expect(latest.prefs.density).toBe('compact');
    expect(latest.resolvedTheme).toBe('apple-dark');
    expect(latest.os).toBe('windows');
    const after = Object.fromEntries(preferenceAttributeNames.map((name) => [name, root().getAttribute(name)]));
    expect(after).toEqual(before);
  });

  it('writes a change to storage and to <html>, and takes it off again', () => {
    mount();
    expect(root().hasAttribute('data-itsm-theme')).toBe(false);

    act(() => latest.setPrefs({ contrast: 'more', motion: 'reduced' }));
    expect(stored()).toEqual({ contrast: 'more', motion: 'reduced' });
    expect(root().getAttribute('data-itsm-theme')).toBe('high-contrast');
    expect(root().getAttribute('data-itsm-motion')).toBe('reduced');
    expect(latest.resolvedTheme).toBe('high-contrast');

    act(() => latest.setPrefs({ contrast: 'system', motion: 'system' }));
    expect(root().hasAttribute('data-itsm-theme')).toBe(false);
    expect(root().hasAttribute('data-itsm-motion')).toBe(false);
  });

  it('keeps both of two changes made in one handler', () => {
    mount();
    act(() => {
      latest.setPrefs({ appearance: 'dark' });
      latest.setPrefs({ density: 'compact' });
    });
    expect(latest.prefs.appearance).toBe('dark');
    expect(latest.prefs.density).toBe('compact');
    expect(stored()).toEqual({ appearance: 'dark', density: 'compact' });
  });

  it('follows the device while an axis is on system, and ignores it once chosen', () => {
    mount();
    expect(latest.resolvedTheme).toBe('apple');
    act(() => device({ dark: true }));
    expect(latest.resolvedTheme).toBe('apple-dark');
    // Nothing pinned: the stylesheet's own media query does the work.
    expect(root().hasAttribute('data-itsm-theme')).toBe(false);

    act(() => latest.setPrefs({ appearance: 'light' }));
    act(() => device({ dark: false, moreContrast: true }));
    expect(latest.resolvedTheme).toBe('high-contrast');
    expect(root().getAttribute('data-itsm-theme')).toBe('high-contrast');
  });

  it('keeps two tabs in step through the storage event', () => {
    mount();
    act(() => {
      localStorage.setItem('itsm-prefs', JSON.stringify({ appearance: 'dark' }));
      window.dispatchEvent(new StorageEvent('storage', { key: 'itsm-prefs' }));
    });
    expect(latest.prefs.appearance).toBe('dark');
    expect(root().getAttribute('data-itsm-theme')).toBe('apple-dark');

    act(() => {
      localStorage.setItem('unrelated', 'x');
      window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' }));
    });
    expect(latest.prefs.appearance).toBe('dark');
  });

  it('migrates the legacy key on mount, and maps the legacy storageKey prop to the new key', () => {
    localStorage.setItem('itsm-theme', 'apple-dark');
    mount({ storageKey: 'itsm-theme' });
    expect(latest.prefs.appearance).toBe('dark');
    expect(stored()).toEqual({ appearance: 'dark' });
    expect(localStorage.getItem('itsm-theme')).toBeNull();

    act(() => latest.setPrefs({ density: 'compact' }));
    expect(stored()).toEqual({ appearance: 'dark', density: 'compact' });
    expect(localStorage.getItem('itsm-theme')).toBeNull();
  });

  it('keeps the single-setting API working for the apps that still use it', () => {
    mount();
    expect(latest.theme).toBe('system');
    act(() => latest.setTheme('apple-dark'));
    expect(latest.theme).toBe('apple-dark');
    expect(latest.prefs).toMatchObject({ appearance: 'dark', contrast: 'standard' });
    // "Dark" means dark, whatever the device says about contrast.
    act(() => device({ moreContrast: true }));
    expect(root().getAttribute('data-itsm-theme')).toBe('apple-dark');
    act(() => latest.setTheme('system'));
    expect(latest.theme).toBe('system');
    expect(root().hasAttribute('data-itsm-theme')).toBe(false);
  });

  it('applies the app defaults, the sidebar and the workbench inspector', () => {
    mount({ app: 'workbench', defaults: { density: 'compact' } });
    expect(root().getAttribute('data-itsm-density')).toBe('compact');
    expect(root().getAttribute('data-itsm-inspector')).toBe('open');
    act(() => latest.setPrefs({ nav: 'rail', inspector: 'closed' }));
    expect(root().getAttribute('data-itsm-nav')).toBe('rail');
    expect(root().getAttribute('data-itsm-inspector')).toBe('closed');
    // A default is not a choice: only what the person set is stored.
    expect(stored()).toEqual({ nav: 'rail', inspector: 'closed' });
  });

  it('cross-fades a theme change where it can, and not when motion is reduced', () => {
    const transition = vi.fn((change: () => void) => change());
    (document as { startViewTransition?: unknown }).startViewTransition = transition;
    mount();

    act(() => latest.setPrefs({ appearance: 'dark' }));
    expect(transition).toHaveBeenCalledTimes(1);
    expect(root().getAttribute('data-itsm-theme')).toBe('apple-dark');

    // Not a theme change: no transition.
    act(() => latest.setPrefs({ density: 'compact' }));
    expect(transition).toHaveBeenCalledTimes(1);

    act(() => latest.setPrefs({ motion: 'reduced' }));
    act(() => latest.setPrefs({ appearance: 'light' }));
    expect(transition).toHaveBeenCalledTimes(1);
    expect(root().getAttribute('data-itsm-theme')).toBe('apple');

    act(() => latest.setPrefs({ motion: 'system' }));
    act(() => device({ reducedMotion: true }));
    act(() => latest.setPrefs({ appearance: 'dark' }));
    expect(transition).toHaveBeenCalledTimes(1);
  });

  it('changes nothing until the transition has captured the page as it was', () => {
    // A real browser calls the callback later, after a frame; nothing may
    // change the theme in between, or the "before" snapshot is the "after".
    let pending: (() => void) | undefined;
    (document as { startViewTransition?: unknown }).startViewTransition = (change: () => void) => {
      pending = change;
    };
    mount();
    act(() => latest.setPrefs({ appearance: 'dark' }));
    expect(root().hasAttribute('data-itsm-theme')).toBe(false);
    act(() => pending!());
    expect(root().getAttribute('data-itsm-theme')).toBe('apple-dark');
    expect(latest.prefs.appearance).toBe('dark');
  });

  it('still applies a choice when storage refuses it', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    mount();
    act(() => latest.setPrefs({ appearance: 'dark' }));
    expect(root().getAttribute('data-itsm-theme')).toBe('apple-dark');
    expect(latest.prefs.appearance).toBe('dark');
  });

  it('never throws outside a provider', () => {
    render(<Probe />);
    expect(latest.prefs.appearance).toBe('system');
    expect(latest.resolvedTheme).toBe('system');
    expect(latest.theme).toBe('system');
    expect(() => latest.setPrefs({ appearance: 'dark' })).not.toThrow();
    expect(() => latest.setTheme('apple')).not.toThrow();
  });
});
