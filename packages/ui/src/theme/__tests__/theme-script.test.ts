// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  defaultPrefs,
  migrateLegacyTheme,
  normalisePrefs,
  preferenceAttributeNames,
  preferenceAttributes,
  prefValues,
  type AppName,
  type Prefs,
} from '../prefs.js';
import { themeInitScript } from '../theme-script.js';

/**
 * The pre-paint script, run as the browser runs it: as text, against a real
 * (jsdom) document, `localStorage` and a stubbed `matchMedia`.
 *
 * The script is hand-written ES5 and cannot import `prefs.ts`, so the heart of
 * this file is a parity check: across every combination that matters, the
 * attributes it writes are exactly the ones `preferenceAttributes()` — which
 * `ThemeProvider` uses after hydration — would write. If the two disagreed,
 * the page would change its look the moment React took over.
 */

interface Device {
  dark?: boolean;
  moreContrast?: boolean;
  platform?: string;
}

function stubDevice({ dark = false, moreContrast = false, platform = 'MacIntel' }: Device = {}): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: (query === '(prefers-color-scheme: dark)' && dark) || (query === '(prefers-contrast: more)' && moreContrast),
    media: query,
  }));
  Object.defineProperty(navigator, 'platform', { value: platform, configurable: true });
}

function run(script: string): void {
  // Global scope, as an inline <script> is.
  new Function(script)();
}

function attributes(): Record<string, string | null> {
  const root = document.documentElement;
  return Object.fromEntries(preferenceAttributeNames.map((name) => [name, root.getAttribute(name)]));
}

function reset(): void {
  for (const name of preferenceAttributeNames) document.documentElement.removeAttribute(name);
  localStorage.clear();
}

beforeEach(() => {
  reset();
  stubDevice();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  reset();
});

describe('themeInitScript', () => {
  it('is small enough to inline in every document head', () => {
    for (const app of ['admin', 'workbench', 'portal'] as const) {
      expect(themeInitScript({ app }).length, app).toBeLessThanOrEqual(1024);
    }
  });

  it('is one self-invoking expression with everything inside a try', () => {
    const script = themeInitScript({ app: 'portal' });
    expect(script.startsWith('(function(){try{')).toBe(true);
    expect(script.endsWith('}catch(e){}})();')).toBe(true);
  });

  it('sets nothing but density and platform for someone who has chosen nothing', () => {
    stubDevice({ dark: true, platform: 'Win32' });
    run(themeInitScript({ app: 'portal' }));
    expect(attributes()).toEqual({
      'data-itsm-theme': null,
      'data-itsm-density': 'comfortable',
      'data-itsm-motion': null,
      'data-itsm-transparency': null,
      'data-itsm-os': 'windows',
      'data-itsm-nav': null,
      'data-itsm-inspector': null,
    });
  });

  it('pins the theme once an axis is chosen, asking the device only about the other', () => {
    stubDevice({ dark: true });
    localStorage.setItem('itsm-prefs', JSON.stringify({ contrast: 'more' }));
    run(themeInitScript({ app: 'admin' }));
    expect(document.documentElement.getAttribute('data-itsm-theme')).toBe('high-contrast-dark');
  });

  it('applies the app defaults, and a stored choice over them', () => {
    run(themeInitScript({ app: 'workbench', defaults: { density: 'compact', inspector: 'closed' } }));
    expect(document.documentElement.getAttribute('data-itsm-density')).toBe('compact');
    expect(document.documentElement.getAttribute('data-itsm-inspector')).toBe('closed');

    reset();
    localStorage.setItem('itsm-prefs', JSON.stringify({ density: 'comfortable' }));
    run(themeInitScript({ app: 'workbench', defaults: { density: 'compact' } }));
    expect(document.documentElement.getAttribute('data-itsm-density')).toBe('comfortable');
  });

  it('honours a custom storage key', () => {
    localStorage.setItem('elsewhere', JSON.stringify({ appearance: 'dark' }));
    run(themeInitScript({ app: 'portal', storageKey: 'elsewhere' }));
    expect(document.documentElement.getAttribute('data-itsm-theme')).toBe('apple-dark');
  });

  describe('the legacy itsm-theme key', () => {
    it.each([
      ['apple', 'apple'],
      ['light', 'apple'],
      ['apple-dark', 'apple-dark'],
      ['dark', 'apple-dark'],
      ['high-contrast', 'high-contrast'],
      ['system', null],
      ['sepia', null],
    ] as const)('honours %s before paint', (legacy, theme) => {
      localStorage.setItem('itsm-theme', legacy);
      run(themeInitScript({ app: 'portal' }));
      expect(document.documentElement.getAttribute('data-itsm-theme')).toBe(theme);
    });

    it('applies it exactly as the provider will once it has migrated it', () => {
      for (const [legacy, device] of [
        ['high-contrast', { dark: true }],
        ['apple', { moreContrast: true }],
        ['system', { dark: true }],
      ] as const) {
        reset();
        stubDevice(device);
        localStorage.setItem('itsm-theme', legacy);
        run(themeInitScript({ app: 'portal' }));
        const before = document.documentElement.getAttribute('data-itsm-theme');
        // What `ThemeProvider` stores on mount, and the script reads next time.
        reset();
        stubDevice(device);
        localStorage.setItem('itsm-prefs', JSON.stringify(migrateLegacyTheme(legacy)));
        run(themeInitScript({ app: 'portal' }));
        expect(document.documentElement.getAttribute('data-itsm-theme'), legacy).toBe(before);
      }
    });

    it('is ignored once itsm-prefs exists', () => {
      localStorage.setItem('itsm-prefs', JSON.stringify({ appearance: 'light' }));
      localStorage.setItem('itsm-theme', 'apple-dark');
      run(themeInitScript({ app: 'portal' }));
      expect(document.documentElement.getAttribute('data-itsm-theme')).toBe('apple');
    });

    it('never writes: the provider owns storage', () => {
      const setItem = vi.spyOn(Storage.prototype, 'setItem');
      const removeItem = vi.spyOn(Storage.prototype, 'removeItem');
      localStorage.setItem('itsm-theme', 'apple-dark');
      setItem.mockClear();
      run(themeInitScript({ app: 'portal' }));
      expect(setItem).not.toHaveBeenCalled();
      expect(removeItem).not.toHaveBeenCalled();
    });
  });

  describe('failure', () => {
    it('survives storage that throws on every access, and still sets the platform and density', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('denied', 'SecurityError');
      });
      expect(() => run(themeInitScript({ app: 'portal' }))).not.toThrow();
      expect(document.documentElement.getAttribute('data-itsm-os')).toBe('apple');
      expect(document.documentElement.getAttribute('data-itsm-density')).toBe('comfortable');
    });

    it('survives a corrupt or foreign stored value', () => {
      for (const stored of ['{not json', '"dark"', '[1,2]', 'null', JSON.stringify({ appearance: 'purple', density: 5 })]) {
        reset();
        localStorage.setItem('itsm-prefs', stored);
        expect(() => run(themeInitScript({ app: 'portal' })), stored).not.toThrow();
        expect(document.documentElement.getAttribute('data-itsm-theme'), stored).toBeNull();
        expect(document.documentElement.getAttribute('data-itsm-density'), stored).toBe('comfortable');
      }
    });

    it('survives a browser without matchMedia', () => {
      vi.stubGlobal('matchMedia', undefined);
      localStorage.setItem('itsm-prefs', JSON.stringify({ appearance: 'dark' }));
      expect(() => run(themeInitScript({ app: 'portal' }))).not.toThrow();
      // The chosen axis still applies; the unanswerable one reads as "no".
      expect(document.documentElement.getAttribute('data-itsm-theme')).toBe('apple-dark');
    });

    it('ignores defaults it does not recognise rather than writing them into the script', () => {
      const script = themeInitScript({ app: 'portal', defaults: { density: undefined, motion: 'sometimes' as Prefs['motion'] } });
      expect(script).not.toContain('undefined');
      expect(() => run(script)).not.toThrow();
      expect(document.documentElement.getAttribute('data-itsm-density')).toBe('comfortable');
      expect(document.documentElement.hasAttribute('data-itsm-motion')).toBe(false);
    });

    it('cannot be broken out of by a storage key', () => {
      const script = themeInitScript({ app: 'portal', storageKey: '</script><script>alert(1)</script>' });
      expect(script).not.toContain('</script>');
      expect(() => run(script)).not.toThrow();
    });
  });

  describe('parity with preferenceAttributes()', () => {
    const apps: AppName[] = ['admin', 'workbench', 'portal'];
    const devices = [
      { dark: false, moreContrast: false },
      { dark: true, moreContrast: false },
      { dark: false, moreContrast: true },
      { dark: true, moreContrast: true },
    ];

    it('agrees on every theme choice on every device', () => {
      let cases = 0;
      for (const appearance of prefValues.appearance) {
        for (const contrast of prefValues.contrast) {
          for (const device of devices) {
            const prefs: Prefs = { ...defaultPrefs, appearance, contrast };
            reset();
            stubDevice({ ...device, platform: 'Win32' });
            localStorage.setItem('itsm-prefs', JSON.stringify({ appearance, contrast }));
            run(themeInitScript({ app: 'admin' }));
            expect(attributes(), JSON.stringify({ appearance, contrast, device })).toEqual(
              preferenceAttributes(prefs, { media: device, os: 'windows', app: 'admin' }),
            );
            cases++;
          }
        }
      }
      expect(cases).toBe(36);
    });

    it('agrees for unrecognised stored values and for apps with defaults of their own', () => {
      const storedValues: Record<string, unknown>[] = [
        {},
        { appearance: 'purple', contrast: 7, density: 'huge', motion: 'yes', nav: null },
        { appearance: 'system', contrast: 'standard', density: 'compact', motion: 'system', transparency: 'reduced' },
        { appearance: 'light', contrast: 'system', inspector: 'closed', nav: 'auto' },
      ];
      const appDefaults: Partial<Prefs>[] = [
        {},
        { density: 'compact', inspector: 'closed' },
        { appearance: 'dark', contrast: 'more', motion: 'reduced', transparency: 'reduced', nav: 'rail' },
        { appearance: 'light', contrast: 'standard' },
      ];
      for (const app of apps) {
        for (const defaults of appDefaults) {
          for (const stored of storedValues) {
            for (const device of devices) {
              reset();
              stubDevice({ ...device, platform: 'Linux x86_64' });
              localStorage.setItem('itsm-prefs', JSON.stringify(stored));
              run(themeInitScript({ app, defaults }));
              expect(attributes(), JSON.stringify({ app, defaults, stored, device })).toEqual(
                preferenceAttributes(normalisePrefs(stored, defaults), { media: device, os: 'other', app }),
              );
            }
          }
        }
      }
    });

    it('agrees on density, motion, transparency, the sidebar and the inspector in every app', () => {
      for (const app of apps) {
        for (const density of prefValues.density) {
          for (const motion of prefValues.motion) {
            for (const transparency of prefValues.transparency) {
              for (const nav of prefValues.nav) {
                for (const inspector of prefValues.inspector) {
                  const stored = { density, motion, transparency, nav, inspector };
                  reset();
                  localStorage.setItem('itsm-prefs', JSON.stringify(stored));
                  run(themeInitScript({ app }));
                  expect(attributes(), JSON.stringify({ app, ...stored })).toEqual(
                    preferenceAttributes({ ...defaultPrefs, ...stored }, { media: devices[0]!, os: 'apple', app }),
                  );
                }
              }
            }
          }
        }
      }
    });
  });
});
