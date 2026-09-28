import { describe, expect, it } from 'vitest';
import { commandFrom, describe as describeTenant, USAGE } from '../ai-regions.js';

describe('the ai-regions command line', () => {
  it('shows the list when given only a tenant', () => {
    expect(commandFrom(['acme'])).toEqual({ kind: 'show', slug: 'acme' });
  });

  it('replaces the list with every region named, lower-cased', () => {
    expect(commandFrom(['acme', 'eu-west', 'US'])).toEqual({ kind: 'set', slug: 'acme', regions: ['eu-west', 'us'] });
  });

  it('clears the list only when asked to in so many words', () => {
    expect(commandFrom(['acme', '--clear'])).toEqual({ kind: 'set', slug: 'acme', regions: [] });
    expect(() => commandFrom(['acme', 'us', '--clear'])).toThrow(USAGE);
  });

  it('refuses no tenant, or a flag where the tenant goes', () => {
    expect(() => commandFrom([])).toThrow(USAGE);
    expect(() => commandFrom(['--clear'])).toThrow(USAGE);
  });
});

describe('what it prints', () => {
  it('says an empty list means the home region', () => {
    expect(describeTenant({ slug: 'acme', region: 'eu-west', aiAllowedRegions: [] })).toBe(
      'acme: home region eu-west; allowed AI regions (none set); AI may process in eu-west',
    );
  });

  it('says a set list is exactly where AI may process', () => {
    expect(describeTenant({ slug: 'acme', region: 'eu-west', aiAllowedRegions: ['eu-west', 'us'] })).toBe(
      'acme: home region eu-west; allowed AI regions eu-west, us; AI may process in eu-west, us',
    );
  });
});
