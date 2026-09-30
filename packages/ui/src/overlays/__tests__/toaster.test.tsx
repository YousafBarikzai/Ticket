// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { announcerText, destroyAnnouncer, installAnnouncer } from '../../a11y/announcer.js';
import { notify, resetNotifications } from '../../provider/notify.js';
import { cleanupDocument, click, press, render } from '../../web/__tests__/support/render.js';
import { TOAST_DURATION, ToastStore, ToastTimers, toastDuration } from '../toast-store.js';
import { Toaster } from '../Toaster.js';

vi.mock('../../web/IconButtonTooltip.js', () => ({ IconButtonTooltip: () => null }));

describe('toast lifetimes', () => {
  it('follows the product rules unless the caller says otherwise', () => {
    expect(toastDuration({})).toBe(TOAST_DURATION.default);
    expect(toastDuration({ tone: 'warning' })).toBe(TOAST_DURATION.warning);
    expect(toastDuration({ undo: async () => undefined })).toBe(8000);
    expect(toastDuration({ tone: 'danger' })).toBe('persistent');
    expect(toastDuration({ action: { label: 'Retry', onClick: () => undefined } })).toBe('persistent');
    expect(toastDuration({ retryAt: Date.now() + 20_000 })).toBe('persistent');
    expect(toastDuration({ tone: 'danger', duration: 3000 })).toBe(3000);
  });
});

describe('ToastTimers', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('expires each toast after its own time, and never a persistent one', () => {
    const expire = vi.fn();
    const timers = new ToastTimers(expire);
    timers.set('a', 1000);
    timers.set('b', 'persistent');
    vi.advanceTimersByTime(999);
    expect(expire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(expire).toHaveBeenCalledWith('a');
    vi.advanceTimersByTime(60_000);
    expect(expire).toHaveBeenCalledTimes(1);
  });

  it('holds every countdown while any reason holds, and resumes with what was left', () => {
    const expire = vi.fn();
    const timers = new ToastTimers(expire);
    timers.set('a', 1000);
    vi.advanceTimersByTime(600);
    timers.hold('hover');
    timers.hold('focus');
    vi.advanceTimersByTime(10_000);
    expect(expire).not.toHaveBeenCalled();
    expect(timers.remaining('a')).toBe(400);
    timers.release('hover');
    vi.advanceTimersByTime(10_000);
    expect(expire).not.toHaveBeenCalled();
    timers.release('focus');
    vi.advanceTimersByTime(399);
    expect(expire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(expire).toHaveBeenCalledWith('a');
  });

  it('restarts a countdown that is set again, and forgets a cleared one', () => {
    const expire = vi.fn();
    const timers = new ToastTimers(expire);
    timers.set('a', 1000);
    vi.advanceTimersByTime(900);
    timers.set('a', 1000);
    vi.advanceTimersByTime(900);
    expect(expire).not.toHaveBeenCalled();
    timers.clear('a');
    vi.advanceTimersByTime(5000);
    expect(expire).not.toHaveBeenCalled();
  });
});

describe('ToastStore', () => {
  it('knows the newest toast whose undo is still on offer', () => {
    const store = new ToastStore();
    const undo = async (): Promise<void> => undefined;
    store.set({ id: 'a', message: 'Closed INC-1', tone: 'neutral', undo, duration: 8000 });
    store.set({ id: 'b', message: 'Saved', tone: 'success', duration: 5000 });
    store.set({ id: 'c', message: 'Closed INC-2', tone: 'neutral', undo, duration: 8000 });
    expect(store.latestUndo()).toBe('c');
    store.patch('c', { undoing: true });
    expect(store.latestUndo()).toBe('a');
    store.delete('a');
    expect(store.latestUndo()).toBeNull();
  });
});

describe('Toaster', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetNotifications();
    installAnnouncer(document);
  });
  afterEach(() => {
    cleanupDocument();
    destroyAnnouncer();
    resetNotifications();
    vi.useRealTimers();
  });

  /**
   * Time passing, in short steps each flushed by React: sonner chains frames,
   * renders and timeouts (a dismissal is a frame, a render, then a 200 ms
   * exit), and a single long advance would run the timers without the
   * renders between them.
   */
  const advance = (ms: number): void => {
    for (let left = ms; left > 0; left -= 50) {
      act(() => {
        vi.advanceTimersByTime(Math.min(50, left));
      });
    }
  };
  const toasts = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-sonner-toast]')];
  const region = (): HTMLElement => document.querySelector<HTMLElement>('section[aria-label="Status messages"]')!;
  const button = (label: string): HTMLButtonElement | undefined =>
    // By its label, which a busy button follows with a hidden "Loading…".
    [...document.querySelectorAll<HTMLButtonElement>('[data-sonner-toast] button')].find((candidate) => candidate.textContent?.startsWith(label) && label !== '');

  function show(message: string, options?: Parameters<typeof notify>[1]): string {
    let id = '';
    act(() => {
      id = notify(message, options);
    });
    // Past the announcer's own 30 ms, so what it says can be read.
    advance(50);
    return id;
  }

  it('shows a toast in a named region, announces it once, and lets it go after five seconds', () => {
    render(<Toaster />);
    show('Ticket assigned to Jo', { tone: 'success', description: 'INC-000123' });
    expect(region()).not.toBeNull();
    // Sonner's own live region is silenced; the announcer speaks instead.
    expect(region().getAttribute('aria-live')).toBe('off');
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]!.textContent).toContain('Ticket assigned to Jo');
    expect(toasts()[0]!.querySelector('[data-tone="success"] svg')).not.toBeNull();
    expect(announcerText('polite')).toBe('Ticket assigned to Jo. INC-000123');

    advance(TOAST_DURATION.default - 20);
    expect(toasts()).toHaveLength(1);
    advance(500);
    expect(toasts()).toHaveLength(0);
  });

  it('replays what was queued before it mounted', () => {
    act(() => {
      notify('Draft saved');
    });
    render(<Toaster />);
    advance(10);
    expect(toasts()[0]?.textContent).toContain('Draft saved');
  });

  it('holds while the pointer is over the toasts, and while focus is in them', () => {
    render(<Toaster />);
    show('Saved');
    act(() => {
      region().dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    });
    advance(30_000);
    expect(toasts()).toHaveLength(1);
    act(() => {
      region().dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
    });

    act(() => {
      toasts()[0]!.focus();
    });
    advance(30_000);
    expect(toasts()).toHaveLength(1);
    act(() => {
      (document.activeElement as HTMLElement).blur();
    });
    advance(TOAST_DURATION.default + 500);
    expect(toasts()).toHaveLength(0);
  });

  it('keeps an error until it is dismissed, and says it assertively', () => {
    render(<Toaster />);
    show('Couldn’t save the rule', { tone: 'danger', description: 'The server did not answer.' });
    expect(announcerText('assertive')).toBe('Couldn’t save the rule. The server did not answer.');
    advance(120_000);
    expect(toasts()).toHaveLength(1);

    click(document.querySelector<HTMLElement>('[data-sonner-toast] [aria-label="Dismiss"]')!);
    advance(500);
    expect(toasts()).toHaveLength(0);
  });

  it('undoes from the button, holding the toast while the undo runs, then says so', async () => {
    render(<Toaster />);
    let finish: () => void = () => undefined;
    const undo = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    show('Ticket closed', { undo });
    expect(announcerText('polite')).toBe('Ticket closed. Undo available');

    click(button('Undo')!);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(button('Undo')!.getAttribute('aria-busy')).toBe('true');
    advance(60_000);
    expect(toasts()).toHaveLength(1);

    await act(async () => finish());
    advance(40);
    expect(toasts()[0]!.textContent).toContain('Undone');
    expect(button('Undo')).toBeUndefined();
    advance(TOAST_DURATION.brief + 500);
    expect(toasts()).toHaveLength(0);
  });

  it('undoes the newest live toast with mod+Z, and stops offering it once the toast has gone', async () => {
    render(<Toaster />);
    const undo = vi.fn(async () => undefined);
    show('Ticket closed', { undo });
    press(document.body, 'z', { ctrlKey: true });
    expect(undo).toHaveBeenCalledTimes(1);
    await act(async () => undefined);

    const later = vi.fn(async () => undefined);
    show('Priority changed', { undo: later });
    advance(8000 + 500);
    press(document.body, 'z', { ctrlKey: true });
    expect(later).not.toHaveBeenCalled();
  });

  it('holds Retry back until retryAt, counting down (429)', () => {
    render(<Toaster />);
    const retry = vi.fn();
    show('Too many requests', { tone: 'warning', retryAt: Date.now() + 20_000, action: { label: 'Retry', onClick: retry } });
    expect(toasts()[0]!.textContent).toContain('Try again in 20 s');
    const button1 = button('Retry')!;
    expect(button1.getAttribute('aria-disabled')).toBe('true');
    click(button1);
    expect(retry).not.toHaveBeenCalled();

    advance(5000);
    expect(toasts()[0]!.textContent).toContain('Try again in 15 s');
    advance(15_500);
    expect(toasts()[0]!.textContent).not.toContain('Try again in');
    expect(button('Retry')!.hasAttribute('aria-disabled')).toBe(false);
    click(button('Retry')!);
    expect(retry).toHaveBeenCalledTimes(1);
    advance(500);
    expect(toasts()).toHaveLength(0);
  });

  it('follows a promise from "loading" to its result', async () => {
    render(<Toaster />);
    let finish: (value: number) => void = () => undefined;
    act(() => {
      notify.promise(new Promise<number>((resolve) => (finish = resolve)), { loading: 'Exporting…', success: (rows) => `Exported ${rows} rows`, error: 'Export failed' });
    });
    advance(10);
    expect(toasts()[0]!.textContent).toContain('Exporting…');
    await act(async () => finish(42));
    advance(10);
    expect(toasts()[0]!.textContent).toContain('Exported 42 rows');
  });

  it('shows a bulk job’s progress with Cancel, and finishes it', () => {
    render(<Toaster />);
    const onCancel = vi.fn();
    act(() => {
      notify.progress('bulk', { label: 'Closing 40 tickets', done: 12, total: 40, onCancel });
    });
    advance(10);
    const bar = toasts()[0]!.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('30');
    expect(toasts()[0]!.textContent).toContain('12 of 40');

    act(() => {
      notify.progress('bulk', { label: 'Closing 40 tickets', done: 40, total: 40, onCancel });
    });
    advance(50);
    expect(toasts()).toHaveLength(1);
    expect(button('Cancel')).toBeUndefined();
    expect(announcerText('polite')).toBe('Closing 40 tickets. 40 of 40 done');
  });

  it('cancels a running job from its toast', () => {
    render(<Toaster />);
    const onCancel = vi.fn();
    act(() => {
      notify.progress('bulk', { label: 'Closing 40 tickets', done: 3, total: 40, onCancel });
    });
    advance(10);
    click(button('Cancel')!);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('dismisses by id', () => {
    render(<Toaster />);
    const id = show('Saved');
    act(() => notify.dismiss(id));
    advance(500);
    expect(toasts()).toHaveLength(0);
  });
});
