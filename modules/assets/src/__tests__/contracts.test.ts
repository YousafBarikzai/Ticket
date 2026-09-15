import { describe, expect, it } from 'vitest';
import { assess, daysBetween, needsAttention, noticeDate } from '../domain/contracts.js';

/**
 * The date that matters is the notice date, not the end date. A report that
 * warns thirty days before a contract ends, on one with ninety days' notice,
 * tells you sixty days too late — politely, and with a number in it, which is
 * what makes it convincing.
 */

const on = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe('daysBetween', () => {
  it('counts whole calendar days and ignores any time of day', () => {
    expect(daysBetween(new Date('2026-09-15T23:59:00Z'), new Date('2026-09-16T00:01:00Z'))).toBe(1);
  });

  it('crosses a month and a leap day', () => {
    expect(daysBetween(on('2028-02-27'), on('2028-03-01'))).toBe(3);
  });
});

describe('noticeDate', () => {
  it('is the end date less the notice period', () => {
    expect(noticeDate({ endsOn: on('2026-12-31'), noticeDays: 90, autoRenews: true })).toEqual(on('2026-10-02'));
  });

  it('is nothing where no notice is required', () => {
    expect(noticeDate({ endsOn: on('2026-12-31'), noticeDays: null, autoRenews: false })).toBeNull();
  });
});

describe('assess', () => {
  const ninetyDays = { endsOn: on('2026-12-31'), noticeDays: 90, autoRenews: true };

  it('says nothing while there is nothing to decide', () => {
    const verdict = assess(ninetyDays, on('2026-06-01'));
    expect(verdict.urgency).toBe('ok');
    expect(needsAttention(verdict)).toBe(false);
  });

  it('warns on the notice date, not on the end date', () => {
    // Notice is due 2 October. A report keyed to the end date would say nothing
    // until December, by which time the money is committed.
    const verdict = assess(ninetyDays, on('2026-09-15'));
    expect(verdict.urgency).toBe('notice_due');
    expect(verdict.daysToNotice).toBe(17);
    expect(verdict.daysToEnd).toBe(107);
  });

  it('says plainly when today is the last day', () => {
    expect(assess(ninetyDays, on('2026-10-02')).message).toMatch(/last day to give notice/);
  });

  it('says the decision has already been made once notice has passed', () => {
    const verdict = assess(ninetyDays, on('2026-10-20'));
    expect(verdict.urgency).toBe('notice_missed');
    // More useful than another warning about a date that is no longer a choice.
    expect(verdict.message).toMatch(/renews on its end date whatever is decided now/);
  });

  it('calls the same date ending, not missed, where nothing renews', () => {
    // A contract that does not auto-renew and whose notice passed is simply
    // ending — a different conversation, and often a worse surprise.
    const verdict = assess({ ...ninetyDays, autoRenews: false }, on('2026-10-20'));
    expect(verdict.urgency).toBe('ending');
  });

  it('warns about the end date where no notice is required', () => {
    const verdict = assess({ endsOn: on('2026-10-01'), noticeDays: null, autoRenews: false }, on('2026-09-15'));
    expect(verdict.urgency).toBe('ending');
    expect(verdict.daysToNotice).toBeNull();
  });

  it('reports a contract that has already ended, and whether it renewed', () => {
    expect(assess(ninetyDays, on('2027-01-05')).urgency).toBe('ended');
    expect(assess(ninetyDays, on('2027-01-05')).message).toMatch(/has renewed/);
    expect(assess({ ...ninetyDays, autoRenews: false }, on('2027-01-05')).message).toMatch(/no longer covered/);
  });

  it('honours a wider warning window', () => {
    expect(assess(ninetyDays, on('2026-08-01'), 30).urgency).toBe('ok');
    expect(assess(ninetyDays, on('2026-08-01'), 90).urgency).toBe('notice_due');
  });
});
