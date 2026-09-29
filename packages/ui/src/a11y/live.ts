'use client';

import { useCallback } from 'react';
import { announce } from './announcer.js';

export interface LiveAnnouncerOptions {
  /** At most one announcement per channel in this window. */
  readonly minIntervalMs?: number;
}

/**
 * Polite announcements for things that change on their own — "3 new
 * tickets" — throttled per channel so a busy queue does not talk over the
 * person, and silent when they have turned live announcements off (X-66).
 *
 * Stub (SPEC §4.1): announces every message politely, unthrottled; the
 * foundations package adds the throttle and the preference.
 */
export function useLiveAnnouncer(channel: string, options: LiveAnnouncerOptions = {}): (message: string) => void {
  void channel;
  void options;
  return useCallback((message: string) => announce(message, { politeness: 'polite' }), []);
}
