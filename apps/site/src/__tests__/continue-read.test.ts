// @vitest-environment jsdom
import { DEMO_PERSONAS } from '@itsm/contracts/demo';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTINUE_KEY, HINT_READ } from '../client/continue-read.js';

/**
 * The reader half of the continue hint (A5 §3.9, §13.1 "continue-hint"):
 * the inline script run as the browser runs it, against jsdom's storage and
 * a document with the chooser's three hidden cards.
 */

const NOW = Date.UTC(2026, 9, 3, 12, 0, 0);
const NEXT_RESET = Date.UTC(2026, 9, 3, 23, 0, 0);

function page(search = ''): void {
  window.history.replaceState(null, '', `/sign-in${search}`);
  document.documentElement.setAttribute('data-next-reset', String(NEXT_RESET));
  document.body.innerHTML = DEMO_PERSONAS.map((p) => `<div data-continue="${p.key}" hidden></div>`).join('');
}

function run(): void {
  // eslint-disable-next-line no-new-func -- the inline script exactly as the page ships it
  new Function(HINT_READ)();
}

function shown(): string[] {
  return [...document.querySelectorAll<HTMLElement>('[data-continue]')].filter((el) => !el.hidden).map((el) => el.dataset.continue!);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('HINT_READ', () => {
  it('accepts exactly the persona table’s keys', () => {
    expect(HINT_READ).toContain(`^(${DEMO_PERSONAS.map((p) => p.key).join('|')})$`);
  });

  it('shows nothing without a stored hint', () => {
    page();
    run();
    expect(shown()).toEqual([]);
  });

  it('unhides the card of a stored persona whose reset time is ahead', () => {
    localStorage.setItem(CONTINUE_KEY, JSON.stringify({ p: 'agent', u: NEXT_RESET }));
    page();
    run();
    expect(shown()).toEqual(['agent']);
  });

  it('removes an expired hint and keeps every card hidden', () => {
    localStorage.setItem(CONTINUE_KEY, JSON.stringify({ p: 'agent', u: NOW - 1 }));
    page();
    run();
    expect(shown()).toEqual([]);
    expect(localStorage.getItem(CONTINUE_KEY)).toBeNull();
  });

  it('writes ?from=<persona> with the next reset and shows that card', () => {
    page('?from=employee');
    run();
    expect(JSON.parse(localStorage.getItem(CONTINUE_KEY)!)).toEqual({ p: 'employee', u: NEXT_RESET });
    expect(shown()).toEqual(['employee']);
  });

  it('ignores ?from with a value outside the table', () => {
    page('?from=root');
    run();
    expect(localStorage.getItem(CONTINUE_KEY)).toBeNull();
    expect(shown()).toEqual([]);
  });

  it('clears the hint on ?ended=1', () => {
    localStorage.setItem(CONTINUE_KEY, JSON.stringify({ p: 'admin', u: NEXT_RESET }));
    page('?ended=1');
    run();
    expect(localStorage.getItem(CONTINUE_KEY)).toBeNull();
    expect(shown()).toEqual([]);
  });

  it('removes a stored value it cannot read, or one naming an unknown persona', () => {
    for (const value of ['{not json', JSON.stringify({ p: 'x"]', u: NEXT_RESET }), '7']) {
      localStorage.setItem(CONTINUE_KEY, value);
      page();
      run();
      expect(localStorage.getItem(CONTINUE_KEY)).toBeNull();
      expect(shown()).toEqual([]);
    }
  });

  it('throws nothing and changes nothing when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    page('?from=agent');
    expect(run).not.toThrow();
    expect(shown()).toEqual([]);
  });

  it('stays small: the reader is well within the two scripts’ 800 B', () => {
    expect(new TextEncoder().encode(HINT_READ).length).toBeLessThanOrEqual(490);
  });
});
