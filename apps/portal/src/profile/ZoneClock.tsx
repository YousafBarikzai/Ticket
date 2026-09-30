'use client';

import type { ReactNode } from 'react';
import { useNow } from '@itsm/ui';
import { zoneTime } from './model.js';

/**
 * "14:32 now" in the person's time zone, kept current while the page is
 * open. The server's words are shown until the page has hydrated (the
 * server has no clock to share), then the shared clock takes over.
 */
export function ZoneClock({ timeZone, locale, initial }: { readonly timeZone: string; readonly locale: string; readonly initial: string }): ReactNode {
  const now = useNow();
  const time = now === null ? null : zoneTime(timeZone, new Date(now), locale);
  return <span suppressHydrationWarning>{time ? `${time} now` : initial}</span>;
}
