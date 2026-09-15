import { describe, expect, it } from 'vitest';
import {
  decideDelivery,
  inQuietHours,
  instantForLocalTime,
  localParts,
  nextDigestBoundary,
  quietHoursEnd,
} from '../domain/delivery-window.js';

/**
 * When a notification may reach someone.
 *
 * The cases here are the ones that wake people up at 3am: a window that crosses
 * midnight, a recipient in another time zone, and the clock-change days where
 * adding 24 hours is not the same as tomorrow.
 */

const LONDON = 'Europe/London';
const SYDNEY = 'Australia/Sydney';

describe('quiet hours', () => {
  const night = { start: '22:00', end: '07:00' };
  const day = { start: '09:00', end: '17:00' };

  it('holds a message sent in the middle of the night', () => {
    expect(inQuietHours(new Date('2026-06-15T02:30:00Z'), LONDON, night)).toBe(true);
  });

  it('lets one through in the afternoon', () => {
    expect(inQuietHours(new Date('2026-06-15T13:00:00Z'), LONDON, night)).toBe(false);
  });

  it('handles a window that does not cross midnight', () => {
    // 13:00 UTC is 14:00 in London in June, inside 09:00-17:00.
    expect(inQuietHours(new Date('2026-06-15T13:00:00Z'), LONDON, day)).toBe(true);
    expect(inQuietHours(new Date('2026-06-15T20:00:00Z'), LONDON, day)).toBe(false);
  });

  it('is decided in the recipient\'s time zone, not the server\'s', () => {
    // 13:00 UTC is 23:00 in Sydney: night there, afternoon in London.
    const at = new Date('2026-06-15T13:00:00Z');
    expect(inQuietHours(at, SYDNEY, night)).toBe(true);
    expect(inQuietHours(at, LONDON, night)).toBe(false);
  });

  it('releases the message when the window opens, later the same night', () => {
    const at = new Date('2026-06-15T02:30:00Z');
    const end = quietHoursEnd(at, LONDON, night);
    // 07:00 London in June is 06:00 UTC, on the same day.
    expect(end.toISOString()).toBe('2026-06-15T06:00:00.000Z');
  });

  it('releases it the next morning when sent just before midnight', () => {
    const at = new Date('2026-06-14T22:30:00Z');
    const end = quietHoursEnd(at, LONDON, night);
    expect(end.toISOString()).toBe('2026-06-15T06:00:00.000Z');
  });

  it('gets the release time right across the spring clock change', () => {
    // The UK moves to BST at 01:00 UTC on 29 March 2026. A message held at
    // 00:30 UTC must be released at 07:00 *local*, which is 06:00 UTC, not
    // 07:00 UTC as a fixed-offset calculation would give.
    const at = new Date('2026-03-29T00:30:00Z');
    const end = quietHoursEnd(at, LONDON, night);
    expect(end.toISOString()).toBe('2026-03-29T06:00:00.000Z');
  });

  it('ignores a malformed window rather than holding forever', () => {
    // A window nobody can parse must fail open: a held message that is never
    // released is worse than one that arrives at an awkward hour.
    expect(inQuietHours(new Date('2026-06-15T02:30:00Z'), LONDON, { start: 'nonsense', end: '07:00' })).toBe(false);
    expect(inQuietHours(new Date('2026-06-15T02:30:00Z'), LONDON, { start: '22:00', end: '22:00' })).toBe(false);
  });
});

describe('local time conversion', () => {
  it('round-trips a local time through an instant', () => {
    const local = { y: 2026, m: 6, d: 15 };
    const instant = instantForLocalTime(LONDON, local, 7 * 60);
    expect(instant.toISOString()).toBe('2026-06-15T06:00:00.000Z');
    expect(localParts(instant, LONDON).minutes).toBe(7 * 60);
  });

  it('works in a zone with a half-hour offset', () => {
    const instant = instantForLocalTime('Asia/Kolkata', { y: 2026, m: 6, d: 15 }, 9 * 60);
    expect(localParts(instant, 'Asia/Kolkata').minutes).toBe(9 * 60);
  });
});

describe('digests', () => {
  it('rolls an hourly digest to the top of the next hour', () => {
    const next = nextDigestBoundary(new Date('2026-06-15T13:22:00Z'), LONDON, 'hourly');
    expect(next.toISOString()).toBe('2026-06-15T14:00:00.000Z');
  });

  it('sends a daily digest at 08:00 in the recipient\'s own morning', () => {
    const next = nextDigestBoundary(new Date('2026-06-15T13:00:00Z'), LONDON, 'daily');
    // 08:00 London on the 16th is 07:00 UTC.
    expect(next.toISOString()).toBe('2026-06-16T07:00:00.000Z');
  });

  it('sends today\'s daily digest when the hour has not passed yet', () => {
    const next = nextDigestBoundary(new Date('2026-06-15T02:00:00Z'), LONDON, 'daily');
    expect(next.toISOString()).toBe('2026-06-15T07:00:00.000Z');
  });
});

describe('the decision', () => {
  const recipient = { timeZone: LONDON };

  it('delivers when there is no preference at all', () => {
    expect(decideDelivery(new Date(), recipient, null)).toEqual({ deliver: true });
  });

  it('defers for a digest even outside quiet hours', () => {
    // Someone who asked for a daily summary said something about every message,
    // not only the ones that would arrive at night.
    const decision = decideDelivery(new Date('2026-06-15T13:00:00Z'), recipient, { digestMode: 'daily' });
    expect(decision).toMatchObject({ deliver: false, reason: 'digest' });
  });

  it('defers for quiet hours when the mode is immediate', () => {
    const decision = decideDelivery(new Date('2026-06-15T02:30:00Z'), recipient, {
      digestMode: 'immediate',
      quietHours: { start: '22:00', end: '07:00' },
    });
    expect(decision).toMatchObject({ deliver: false, reason: 'quiet_hours' });
    expect(decision.deferUntil?.toISOString()).toBe('2026-06-15T06:00:00.000Z');
  });

  it('delivers an urgent message through both', () => {
    // Quiet hours do not mean "do not tell me the building is on fire".
    const decision = decideDelivery(
      new Date('2026-06-15T02:30:00Z'),
      recipient,
      { digestMode: 'daily', quietHours: { start: '22:00', end: '07:00' } },
      { urgent: true },
    );
    expect(decision).toEqual({ deliver: true });
  });
});
