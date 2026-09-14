// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { announce, announcerText, destroyAnnouncer, installAnnouncer } from '../announcer.js';

afterEach(() => destroyAnnouncer());

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 60));

describe('live-region announcer', () => {
  it('installs polite and assertive regions that are in the accessibility tree', () => {
    installAnnouncer(document);
    const polite = document.querySelector('[data-itsm-live-region="polite"]');
    const assertive = document.querySelector('[data-itsm-live-region="assertive"]');

    expect(polite?.getAttribute('aria-live')).toBe('polite');
    expect(polite?.getAttribute('role')).toBe('status');
    expect(assertive?.getAttribute('aria-live')).toBe('assertive');
    expect(assertive?.getAttribute('role')).toBe('alert');
    // Off-screen, not display:none — a hidden region is never announced.
    expect((polite as HTMLElement | null)?.style.position).toBe('absolute');
    expect((polite as HTMLElement | null)?.style.display).not.toBe('none');
  });

  it('creates the regions before the text changes, so the first message is heard', async () => {
    announce('Ticket INC-000123 created');
    // The region exists immediately; only its text waits a tick.
    expect(document.querySelector('[data-itsm-live-region="polite"]')).not.toBeNull();
    await settle();
    expect(announcerText('polite')).toBe('Ticket INC-000123 created');
  });

  it('keeps the two politeness levels apart', async () => {
    announce('Saved');
    announce('Could not save', { politeness: 'assertive' });
    await settle();
    expect(announcerText('polite')).toBe('Saved');
    expect(announcerText('assertive')).toBe('Could not save');
  });

  it('re-announces the same message by clearing the region first', async () => {
    announce('3 results');
    await settle();
    expect(announcerText()).toBe('3 results');

    announce('3 results');
    // Cleared straight away, which is the mutation a screen reader needs.
    expect(announcerText()).toBe('');
    await settle();
    expect(announcerText()).toBe('3 results');
  });

  it('ignores empty messages', async () => {
    announce('   ');
    await settle();
    expect(announcerText()).toBe('');
  });

  it('clears the region after the given delay so it is not re-read later', async () => {
    announce('Draft saved', { clearAfterMs: 10 });
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(announcerText()).toBe('');
  });
});
