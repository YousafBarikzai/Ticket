import { describe, expect, it } from 'vitest';
import {
  defaultPrefs,
  detectOs,
  migrateLegacyTheme,
  normalisePrefs,
  pinnedTheme,
  preferenceAttributes,
  readStoredPrefs,
  resolveTheme,
  sanitisePrefs,
  themeSettingToPrefs,
  writeStoredPrefs,
  type Prefs,
} from '../prefs.js';

/** A Map-backed `Storage`, optionally one that refuses everything. */
function memoryStorage(initial: Record<string, string> = {}, refuse = false): Storage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  const guard = (): void => {
    if (refuse) throw new DOMException('denied', 'SecurityError');
  };
  return {
    data,
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => {
      guard();
      return data.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      guard();
      data.set(key, value);
    },
    removeItem: (key: string) => {
      guard();
      data.delete(key);
    },
  };
}

describe('stored preferences', () => {
  it('keeps only the values it recognises', () => {
    expect(sanitisePrefs({ appearance: 'dark', density: 'enormous', showKeys: 'yes', other: 1 })).toEqual({ appearance: 'dark' });
    expect(sanitisePrefs(null)).toEqual({});
    expect(sanitisePrefs(['dark'])).toEqual({});
    expect(sanitisePrefs('dark')).toEqual({});
  });

  it('fills gaps from the app defaults, then the system defaults', () => {
    expect(normalisePrefs({}, {})).toEqual(defaultPrefs);
    expect(normalisePrefs({ appearance: 'dark' }, { density: 'compact' })).toEqual({
      ...defaultPrefs,
      appearance: 'dark',
      density: 'compact',
    });
    // A stored choice beats the app's default.
    expect(normalisePrefs({ density: 'comfortable' }, { density: 'compact' }).density).toBe('comfortable');
  });

  it('defaults every app to comfortable density and "follow the device" on both theme axes', () => {
    expect(defaultPrefs.density).toBe('comfortable');
    expect(defaultPrefs.appearance).toBe('system');
    expect(defaultPrefs.contrast).toBe('system');
  });

  it('migrates the legacy theme names', () => {
    expect(migrateLegacyTheme('apple')).toEqual({ appearance: 'light' });
    expect(migrateLegacyTheme('light')).toEqual({ appearance: 'light' });
    expect(migrateLegacyTheme('apple-dark')).toEqual({ appearance: 'dark' });
    expect(migrateLegacyTheme('dark')).toEqual({ appearance: 'dark' });
    expect(migrateLegacyTheme('high-contrast')).toEqual({ contrast: 'more' });
    expect(migrateLegacyTheme('system')).toEqual({});
    expect(migrateLegacyTheme('sepia')).toEqual({});
  });

  it('reads the legacy key once, stores the result under the new key and removes the old one', () => {
    const storage = memoryStorage({ 'itsm-theme': 'apple-dark' });
    expect(readStoredPrefs(storage)).toEqual({ appearance: 'dark' });
    expect(storage.data.get('itsm-prefs')).toBe('{"appearance":"dark"}');
    expect(storage.data.has('itsm-theme')).toBe(false);
    // The new key wins from then on, even if something writes the old one again.
    storage.data.set('itsm-theme', 'apple');
    expect(readStoredPrefs(storage)).toEqual({ appearance: 'dark' });
  });

  it('never throws: no storage, refused storage and corrupt JSON all read as no choices', () => {
    expect(readStoredPrefs(undefined)).toEqual({});
    expect(readStoredPrefs(memoryStorage({}, true))).toEqual({});
    expect(readStoredPrefs(memoryStorage({ 'itsm-prefs': '{not json' }))).toEqual({});
    expect(writeStoredPrefs(memoryStorage({}, true), { appearance: 'dark' })).toBe(false);
    expect(writeStoredPrefs(undefined, { appearance: 'dark' })).toBe(false);
  });

  it('writes only the choices made, so later defaults still reach everyone else', () => {
    const storage = memoryStorage();
    expect(writeStoredPrefs(storage, { contrast: 'more', density: 'nonsense' as Prefs['density'] })).toBe(true);
    expect(storage.data.get('itsm-prefs')).toBe('{"contrast":"more"}');
  });
});

describe('resolving the theme', () => {
  const light = { dark: false, moreContrast: false };
  const darkDevice = { dark: true, moreContrast: false };
  const darkAndMore = { dark: true, moreContrast: true };

  it('follows the device on every axis left on system', () => {
    expect(resolveTheme({ appearance: 'system', contrast: 'system' }, light)).toBe('apple');
    expect(resolveTheme({ appearance: 'system', contrast: 'system' }, darkDevice)).toBe('apple-dark');
    expect(resolveTheme({ appearance: 'system', contrast: 'system' }, darkAndMore)).toBe('high-contrast-dark');
    expect(resolveTheme({ appearance: 'light', contrast: 'system' }, darkAndMore)).toBe('high-contrast');
    expect(resolveTheme({ appearance: 'system', contrast: 'standard' }, darkAndMore)).toBe('apple-dark');
    expect(resolveTheme({ appearance: 'dark', contrast: 'more' }, light)).toBe('high-contrast-dark');
  });

  it('pins no theme while both axes follow the device, so the stylesheet can follow it live', () => {
    expect(pinnedTheme({ appearance: 'system', contrast: 'system' }, darkAndMore)).toBeNull();
    expect(pinnedTheme({ appearance: 'dark', contrast: 'system' }, light)).toBe('apple-dark');
  });

  it('turns preferences into the attributes on <html>', () => {
    const prefs: Prefs = { ...defaultPrefs, appearance: 'dark', density: 'compact', motion: 'reduced', nav: 'rail' };
    expect(preferenceAttributes(prefs, { media: light, os: 'windows', app: 'workbench' })).toEqual({
      'data-itsm-theme': 'apple-dark',
      'data-itsm-density': 'compact',
      'data-itsm-motion': 'reduced',
      'data-itsm-transparency': null,
      'data-itsm-os': 'windows',
      'data-itsm-nav': 'rail',
      'data-itsm-inspector': 'open',
    });
    // Only the workbench has an inspector.
    expect(preferenceAttributes(prefs, { media: light, os: 'windows', app: 'portal' })['data-itsm-inspector']).toBeNull();
  });

  it('maps the single-setting choice to exactly that theme, whatever the device says', () => {
    for (const setting of ['apple', 'apple-dark', 'high-contrast', 'high-contrast-dark'] as const) {
      const prefs = themeSettingToPrefs(setting);
      for (const media of [light, darkDevice, darkAndMore]) expect(resolveTheme(prefs, media)).toBe(setting);
    }
    expect(themeSettingToPrefs('system')).toEqual({ appearance: 'system', contrast: 'system' });
  });
});

describe('the platform', () => {
  it('reads the platform, then the user agent', () => {
    expect(detectOs({ platform: 'Win32', userAgent: '' })).toBe('windows');
    expect(detectOs({ platform: 'iPhone', userAgent: '' })).toBe('apple');
    // iPadOS reports a Mac, and has a ⌘ key.
    expect(detectOs({ platform: 'MacIntel', userAgent: '' })).toBe('apple');
    expect(detectOs({ platform: 'Linux x86_64', userAgent: '' })).toBe('other');
    expect(detectOs({ platform: '', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })).toBe('windows');
  });
});
