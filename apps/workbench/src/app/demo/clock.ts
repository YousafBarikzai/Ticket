import { DEMO_RESET, nextResetAt, periodMs } from '@itsm/contracts/demo';
import type { DemoBarProps } from '@itsm/ui/shell';

/**
 * The demo bar's clock, computed on the server from the pure UK reset clock
 * (A2 §9.6): the next reset, the server's now (the countdown corrects its own
 * skew from it) and the length of the demo day, which is 23 or 25 hours on
 * the days the clocks change. No store read: the countdown needs none.
 */
export function demoBarClock(now: number = Date.now()): DemoBarProps['clock'] {
  return {
    nextResetAt: nextResetAt(now),
    serverNow: now,
    periodMs: periodMs(now),
    resetLabel: DEMO_RESET.label,
    timeZone: DEMO_RESET.timeZone,
  };
}
