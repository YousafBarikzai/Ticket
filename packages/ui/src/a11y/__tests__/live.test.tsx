// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupDocument, render } from '../../web/__tests__/support/render.js';
import { ThemeProvider } from '../../theme/ThemeProvider.js';
import { announcerText, destroyAnnouncer } from '../announcer.js';
import { resetLiveChannels, useLiveAnnouncer } from '../live.js';

/*
 * `useLiveAnnouncer` (X-66): one polite announcement per channel per window,
 * the newest message spoken when the window closes, and silence when the
 * person has turned live announcements off.
 */

let say: ((message: string) => void) | null = null;

function Speaker({ channel = 'inbox', interval }: { channel?: string; interval?: number }): ReactElement | null {
  say = useLiveAnnouncer(channel, interval === undefined ? {} : { minIntervalMs: interval });
  return null;
}

function advance(ms: number): void {
  act(() => void vi.advanceTimersByTime(ms));
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});

afterEach(() => {
  cleanupDocument();
  resetLiveChannels();
  destroyAnnouncer();
  vi.useRealTimers();
  localStorage.clear();
  say = null;
});

describe('useLiveAnnouncer', () => {
  it('speaks the first message at once, politely', () => {
    render(<Speaker />);
    say!('3 new tickets');
    advance(50);
    expect(announcerText('polite')).toBe('3 new tickets');
    expect(announcerText('assertive')).toBe('');
  });

  it('holds messages inside the window and speaks only the newest when it closes', () => {
    render(<Speaker />);
    say!('3 new tickets');
    advance(1000);
    say!('4 new tickets');
    say!('7 new tickets');
    advance(50);
    expect(announcerText()).toBe('3 new tickets');
    advance(4000);
    expect(announcerText()).toBe('7 new tickets');
  });

  it('does not repeat itself at the end of a window', () => {
    render(<Speaker />);
    say!('3 new tickets');
    advance(50);
    const region = document.querySelector('[data-itsm-live-region="polite"]')!;
    const changes: MutationRecord[] = [];
    const observer = new MutationObserver((records) => changes.push(...records));
    observer.observe(region, { childList: true, characterData: true, subtree: true });
    say!('3 new tickets');
    advance(6000);
    act(() => void changes.push(...observer.takeRecords()));
    observer.disconnect();
    // The announcer empties the region before every message, so a second
    // hearing would show up here as a mutation; there is none.
    expect(changes).toEqual([]);
    expect(announcerText()).toBe('3 new tickets');
  });

  it('keeps channels apart and honours a custom window', () => {
    render(
      <>
        <Speaker channel="inbox" interval={1000} />
      </>,
    );
    const inbox = say!;
    render(<Speaker channel="approvals" />);
    const approvals = say!;
    inbox('1 new ticket');
    advance(50);
    approvals('1 approval waiting');
    advance(50);
    expect(announcerText()).toBe('1 approval waiting');
    inbox('2 new tickets');
    advance(1000);
    expect(announcerText()).toBe('2 new tickets');
  });

  it('says nothing when the person has turned live announcements off', () => {
    localStorage.setItem('itsm-prefs', JSON.stringify({ announceLive: 'off' }));
    render(
      <ThemeProvider app="workbench">
        <Speaker />
      </ThemeProvider>,
    );
    say!('3 new tickets');
    advance(6000);
    expect(announcerText()).toBe('');
  });
});
