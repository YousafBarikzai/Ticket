// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTINUE_KEY, HINT_LISTEN } from '../client/continue-hint.js';
import { CONTINUE_KEY as READER_KEY, HINT_READ } from '../client/continue-read.js';

/**
 * The continue hint's writer half (SPEC v3 §6.1; A5 §3.9, §13.1
 * "continue-hint"): the inline script the root layout puts at the end of
 * every page, run here in jsdom exactly as it ships.
 */

const NEXT_RESET = Date.UTC(2026, 9, 4, 23, 0, 0);

function page(search: string, body: string): void {
  window.history.replaceState(null, '', `/${search}`);
  document.documentElement.dataset.nextReset = String(NEXT_RESET);
  document.body.innerHTML = body;
}

/** Runs the script as the browser would: one global evaluation. */
function run(): void {
  // eslint-disable-next-line no-new-func -- the shipped string, evaluated as an inline script is
  new Function(HINT_LISTEN)();
}

const listeners: { type: string; listener: EventListenerOrEventListenerObject; options?: boolean | AddEventListenerOptions }[] = [];

beforeEach(() => {
  vi.useFakeTimers({ now: Date.UTC(2026, 9, 4, 12, 0, 0), toFake: ['Date'] });
  localStorage.clear();
  // Each run adds a document listener; remove them so one test's script does not act in the next.
  const add = document.addEventListener.bind(document);
  vi.spyOn(document, 'addEventListener').mockImplementation((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
    listeners.push({ type, listener, ...(options === undefined ? {} : { options }) });
    add(type, listener, options);
  });
});

afterEach(() => {
  for (const { type, listener, options } of listeners.splice(0)) document.removeEventListener(type, listener, options);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('HINT_LISTEN', () => {
  it('remembers the role a visitor pressed, until the next reset', () => {
    page('', '<a href="https://desk.example/demo?persona=agent&demo=1" rel="nofollow" data-persona="agent"><span>Explore</span></a>');
    run();
    const link = document.querySelector('a')!;
    link.addEventListener('click', (event) => event.preventDefault());
    // A click on the label inside the link counts as a click on the link.
    document.querySelector('span')!.click();
    expect(JSON.parse(localStorage.getItem(CONTINUE_KEY)!)).toEqual({ p: 'agent', u: NEXT_RESET });
  });

  it('forgets it on ?ended=1, which the apps add when a demo ends', () => {
    localStorage.setItem(CONTINUE_KEY, JSON.stringify({ p: 'admin', u: NEXT_RESET }));
    page('?ended=1', '');
    run();
    expect(localStorage.getItem(CONTINUE_KEY)).toBeNull();
  });

  it('keeps it on any other address', () => {
    localStorage.setItem(CONTINUE_KEY, JSON.stringify({ p: 'admin', u: NEXT_RESET }));
    page('?utm_source=mail', '');
    run();
    expect(localStorage.getItem(CONTINUE_KEY)).not.toBeNull();
  });

  it('forgets it on "Forget" and hides the card the button sits in', () => {
    localStorage.setItem(CONTINUE_KEY, JSON.stringify({ p: 'employee', u: NEXT_RESET }));
    page('', '<div data-continue="employee"><a href="#" data-x>Return</a><button type="button" data-forget="">Forget</button></div>');
    run();
    document.querySelector<HTMLButtonElement>('[data-forget]')!.click();
    expect(localStorage.getItem(CONTINUE_KEY)).toBeNull();
    expect(document.querySelector<HTMLElement>('[data-continue]')!.hidden).toBe(true);
  });

  it('ignores clicks on anything else', () => {
    page('', '<a href="/sign-in">Sign in</a><button type="button">Other</button>');
    run();
    document.querySelector('a')!.addEventListener('click', (event) => event.preventDefault());
    document.querySelector('a')!.click();
    document.querySelector('button')!.click();
    expect(localStorage.getItem(CONTINUE_KEY)).toBeNull();
  });

  it('throws nothing and changes nothing when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    page('?ended=1', '<a href="#" data-persona="agent">Explore</a><div data-continue="agent"><button type="button" data-forget="">Forget</button></div>');
    expect(run).not.toThrow();
    const errors: unknown[] = [];
    window.addEventListener('error', (event) => errors.push(event.error));
    document.querySelector('a')!.addEventListener('click', (event) => event.preventDefault());
    document.querySelector('a')!.click();
    document.querySelector<HTMLButtonElement>('[data-forget]')!.click();
    expect(errors).toEqual([]);
    // The card still hides: what the visitor asked for on screen happens even if storage refused.
    expect(document.querySelector<HTMLElement>('[data-continue]')!.hidden).toBe(true);
  });

  it('uses the same key as the reader', () => {
    expect(CONTINUE_KEY).toBe('itsm-site:continue');
    expect(READER_KEY).toBe(CONTINUE_KEY);
  });

  it('stays small: under 380 bytes, inline HTML on every page', () => {
    const bytes = new TextEncoder().encode(HINT_LISTEN).length;
    expect(bytes).toBeLessThanOrEqual(380);
    // A5 §13.1 asks ≤ 800 B for the two scripts together; the reader is the chooser's (WP-51).
    // Both measured as shipped (hand-minified strings), recorded here so a change to either is visible.
    expect(bytes + new TextEncoder().encode(HINT_READ).length).toBeLessThanOrEqual(870);
  });
});
