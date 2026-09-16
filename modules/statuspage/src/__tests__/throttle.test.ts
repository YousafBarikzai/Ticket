import { describe, expect, it } from 'vitest';
import { SlidingWindow } from '../domain/throttle.js';

describe('the subscribe allowance', () => {
  it('lets the allowance through and refuses the one after it', () => {
    const window = new SlidingWindow(3, 60_000);
    const at = Date.parse('2026-09-15T10:00:00Z');
    expect(window.allow('a', at)).toBe(true);
    expect(window.allow('a', at + 1)).toBe(true);
    expect(window.allow('a', at + 2)).toBe(true);
    expect(window.allow('a', at + 3)).toBe(false);
  });

  it('counts each key on its own, so one script does not cost everybody else their allowance', () => {
    const window = new SlidingWindow(1, 60_000);
    const at = Date.parse('2026-09-15T10:00:00Z');
    expect(window.allow('script', at)).toBe(true);
    expect(window.allow('script', at + 1)).toBe(false);
    expect(window.allow('person', at + 2)).toBe(true);
  });

  it('forgets an attempt once the window has slid past it', () => {
    const window = new SlidingWindow(1, 60_000);
    const at = Date.parse('2026-09-15T10:00:00Z');
    expect(window.allow('a', at)).toBe(true);
    expect(window.allow('a', at + 59_999)).toBe(false);
    expect(window.allow('a', at + 60_001)).toBe(true);
  });

  it('does not count a refused attempt against the allowance', () => {
    // Otherwise a script that keeps trying keeps the door shut for the person
    // behind it for as long as it likes.
    const window = new SlidingWindow(1, 60_000);
    const at = Date.parse('2026-09-15T10:00:00Z');
    expect(window.allow('a', at)).toBe(true);
    for (let i = 1; i < 50; i += 1) expect(window.allow('a', at + i)).toBe(false);
    expect(window.allow('a', at + 60_001)).toBe(true);
  });
});
