'use client';

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useTheme } from '../theme/ThemeProvider.js';
import { announce } from './announcer.js';

export interface LiveAnnouncerOptions {
  /** At most one announcement per channel in this window. 5 s by default. */
  readonly minIntervalMs?: number;
}

/*
 * Channel state is module-level: two components announcing on the same
 * channel ("inbox" from the list and from the sidebar badge) share one
 * throttle, which is the point of naming a channel.
 */
interface Channel {
  /** When the last announcement on this channel was made. */
  lastAt: number;
  /** The newest message that arrived inside the window, spoken when it ends. */
  waiting: string | null;
  timer: ReturnType<typeof setTimeout> | null;
  /** The message last spoken, so the window's trailing message is not a repeat of it. */
  lastMessage: string | null;
}

const channels = new Map<string, Channel>();

function channelOf(name: string): Channel {
  let channel = channels.get(name);
  if (!channel) {
    channel = { lastAt: Number.NEGATIVE_INFINITY, waiting: null, timer: null, lastMessage: null };
    channels.set(name, channel);
  }
  return channel;
}

function speak(channel: Channel, message: string): void {
  channel.lastAt = Date.now();
  channel.lastMessage = message;
  announce(message, { politeness: 'polite' });
}

/** Forgets every channel's throttle and cancels what was waiting. Tests use it between cases. */
export function resetLiveChannels(): void {
  for (const channel of channels.values()) if (channel.timer) clearTimeout(channel.timer);
  channels.clear();
}

const useLatestEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * Polite announcements for things that change on their own — "3 new
 * tickets" — throttled per channel so a busy queue does not talk over the
 * person, and silent when they have turned live announcements off (X-66).
 *
 * The first message on a quiet channel is spoken at once. Messages inside the
 * window are held and only the newest is spoken when the window closes: a
 * count that went 3, 4, 7 in five seconds is heard once, as 7, and the last
 * word is never lost. A message identical to the one just spoken is dropped.
 * Switching announcements off drops whatever was waiting.
 */
export function useLiveAnnouncer(channel: string, options: LiveAnnouncerOptions = {}): (message: string) => void {
  const { minIntervalMs = 5000 } = options;
  const { prefs } = useTheme();
  const enabled = prefs.announceLive !== 'off';
  const latest = useRef({ enabled, minIntervalMs });
  useLatestEffect(() => {
    latest.current = { enabled, minIntervalMs };
    if (!enabled) {
      const state = channels.get(channel);
      if (state?.timer) clearTimeout(state.timer);
      if (state) {
        state.timer = null;
        state.waiting = null;
      }
    }
  });

  return useCallback(
    (message: string) => {
      const { enabled: on, minIntervalMs: interval } = latest.current;
      if (!on || !message.trim()) return;
      const state = channelOf(channel);
      const since = Date.now() - state.lastAt;
      if (since >= interval && !state.timer) {
        speak(state, message);
        return;
      }
      state.waiting = message;
      if (state.timer) return;
      state.timer = setTimeout(() => {
        state.timer = null;
        const waiting = state.waiting;
        state.waiting = null;
        if (waiting === null || !latest.current.enabled || waiting === state.lastMessage) return;
        speak(state, waiting);
      }, Math.max(0, interval - since));
    },
    [channel],
  );
}
