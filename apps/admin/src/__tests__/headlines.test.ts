import { describe, expect, it } from 'vitest';
import {
  MAX_HEADLINE,
  NO_TICKETS,
  NOT_ENOUGH,
  ageingHeadline,
  backlogHeadline,
  breachesHeadline,
  channelHeadline,
  csatHeadline,
  finish,
  forecastHeadline,
  registerHeadline,
  slaHeadline,
  stars,
  teamSlaHeadline,
  volumeHeadline,
} from '../server/headlines.js';

/**
 * Administration's headlines (A7 §2.5, §11.1; SPEC §7.0.4): every function's
 * sentence, its rounding, singular and plural, its zero state, and the two
 * rules every headline keeps — at most 110 characters and no full stop.
 */

const days = (values: number[]) => values;

/** Every sentence this file produces, checked against the shared rules at the end. */
const produced: string[] = [];
const keep = <T extends string | null>(sentence: T): T => {
  if (sentence !== null) produced.push(sentence);
  return sentence;
};

describe('raised vs resolved', () => {
  it('says what changed, then by how much', () => {
    expect(keep(volumeHeadline(days([150, 150, 148]), days([140, 140, 135]), 'the last 30 days'))).toBe('Resolved 415, raised 448: the backlog grew by 33 in the last 30 days');
    expect(keep(volumeHeadline([10, 10, 10], [12, 12, 12], 'the last 7 days'))).toBe('Resolved 36, raised 30: the backlog fell by 6 in the last 7 days');
    expect(keep(volumeHeadline([5, 5, 5], [5, 5, 5], 'the last 7 days'))).toBe('Resolved 15, raised 15: the backlog held steady in the last 7 days');
  });

  it('has a zero state and a too-little state', () => {
    expect(volumeHeadline([0, 0, 0], [0, null, 0], 'the last 7 days')).toBe(NO_TICKETS);
    expect(volumeHeadline([4, 5], [3, 3], 'the last 7 days')).toBe(NOT_ENOUGH);
  });
});

describe('SLA', () => {
  it('reads attainment against the target, and names the target missed most', () => {
    expect(keep(slaHeadline(85, 90, [{ key: 'response', value: 92 }, { key: 'update', value: 80 }, { key: 'resolution', value: 84 }]))).toBe(
      '85% of targets met, 5 points under the 90% target; updates missed most (80%)',
    );
    expect(keep(slaHeadline(91, 90))).toBe('91% of targets met, 1 point over the 90% target');
    expect(keep(slaHeadline(90, 90))).toBe('90% of targets met, on the 90% target');
    expect(keep(slaHeadline(89.4, 90))).toBe('89% of targets met, 0.6 points under the 90% target');
  });

  it('takes its target from the answer, never a literal', () => {
    expect(slaHeadline(85, 80)).toBe('85% of targets met, 5 points over the 80% target');
  });

  it('leaves out the weakest target when every target is met', () => {
    expect(slaHeadline(95, 90, [{ key: 'response', value: 96 }, { key: 'resolution', value: 93 }])).toBe('95% of targets met, 5 points over the 90% target');
  });

  it('says so when no target finished', () => {
    expect(keep(slaHeadline(null, 90))).toBe('No targets finished in this period');
  });

  it('counts the teams that meet it, and names the lowest', () => {
    const rows = [
      { label: 'Network', value: 82 },
      { label: 'Business Applications', value: 79 },
      { label: 'Service Desk', value: 93 },
      { label: 'Security', value: 95 },
      { label: 'End User Computing', value: 88 },
    ];
    expect(keep(teamSlaHeadline(rows, 90))).toBe('2 of 5 teams meet the target; Business Applications is lowest at 79%');
    expect(keep(teamSlaHeadline([{ label: 'Network', value: 92 }], 90))).toBe('Network meets the target');
    expect(keep(teamSlaHeadline([{ label: 'Network', value: null }], 90))).toBe('No team has finished a target in this period');
  });
});

describe('breakdowns', () => {
  it('names the channel that brings most, then the next', () => {
    expect(
      keep(
        channelHeadline([
          { key: 'portal', value: 40 },
          { key: 'email', value: 28 },
          { key: 'phone', value: 22 },
          { key: 'chat', value: 10 },
        ]),
      ),
    ).toBe('The Help Portal brings 40% of tickets; email 28%');
    expect(keep(channelHeadline([{ key: 'email', value: 3 }]))).toBe('Email brings 100% of tickets');
    expect(channelHeadline([{ key: 'portal', value: 0 }])).toBe(NO_TICKETS);
  });

  it('never counts imported tickets as a channel (D20)', () => {
    expect(channelHeadline([{ key: 'import', value: 500 }, { key: 'email', value: 5 }])).toBe('Email brings 100% of tickets');
  });

  it('names the priority with most breaches', () => {
    expect(keep(breachesHeadline([{ key: 'P1', label: 'P1', value: 8 }, { key: 'P2', label: 'P2', value: 31 }, { key: 'P3', label: 'P3', value: 61 }, { key: 'P4', label: 'P4', value: 12 }]))).toBe(
      'Most breaches were P3 (61 of 112)',
    );
    expect(keep(breachesHeadline([{ key: 'P2', label: 'P2', value: 3 }]))).toBe('Every breach was P2 (3)');
    expect(keep(breachesHeadline([]))).toBe('No breaches in this period');
  });
});

describe('backlog, forecast, satisfaction and ageing', () => {
  it('says the backlog is an estimate', () => {
    const series = [84, 90, 100, 108].map((value, index) => ({ at: `2026-09-0${index + 1}`, value }));
    expect(keep(backlogHeadline(series, 30))).toBe('About 108 open, up from 84 30 days ago (estimated from raised and resolved)');
    expect(backlogHeadline(series.slice(0, 2), 30)).toBe(NOT_ENOUGH);
    const flat = [50, 52, 50].map((value, index) => ({ at: `d${index}`, value }));
    expect(keep(backlogHeadline(flat, 7))).toBe('About 50 open, the same as 7 days ago (estimated from raised and resolved)');
  });

  it('claims nothing about the future without a forecast, and always gives the fit', () => {
    expect(keep(forecastHeadline({ projected: Array.from({ length: 14 }, () => ({ value: 16 })), rSquared: 0.42 }))).toBe(
      'On this trend, about 16 tickets a day over the next 14 days (rough fit, r² 0.42)',
    );
    expect(forecastHeadline({ projected: Array.from({ length: 14 }, () => ({ value: 1 })), rSquared: 0.8 })).toContain('about 1 ticket a day');
    expect(forecastHeadline(null)).toBe(NOT_ENOUGH);
  });

  it('shows satisfaction as stars out of five, with the change', () => {
    expect(stars(85)).toBe(4.4);
    expect(stars(0)).toBe(1);
    expect(stars(100)).toBe(5);
    expect(keep(csatHeadline(85, 82.5, 115, 30))).toBe('4.4 out of 5 from 115 responses, up 0.1 on the previous 30 days');
    expect(keep(csatHeadline(85, 85, 1, 30))).toBe('4.4 out of 5 from 1 response, the same as the previous 30 days');
    expect(keep(csatHeadline(70, 85, null, 30))).toBe('3.8 out of 5, down 0.6 on the previous 30 days');
    expect(keep(csatHeadline(null, 85, 0, 30))).toBe('No survey responses in this period');
  });

  it('counts old tickets in a week and two', () => {
    expect(keep(ageingHeadline({ overWeek: 18, overTwoWeeks: 6 }))).toBe('18 tickets have been open more than a week; 6 more than two');
    expect(keep(ageingHeadline({ overWeek: 1, overTwoWeeks: 0 }))).toBe('1 ticket has been open more than a week');
    expect(keep(ageingHeadline({ overWeek: 0, overTwoWeeks: 0 }))).toBe('Nothing has been open more than a week');
  });
});

describe('register headlines', () => {
  it('joins the facts that are not zero, singular and plural', () => {
    expect(keep(registerHeadline([{ count: 3, one: 'breaching' }, { count: 10, one: 'unassigned' }]))).toBe('3 breaching · 10 unassigned');
    expect(keep(registerHeadline([{ count: 4, one: 'critical item', many: 'critical items' }, { count: 1, one: 'past its target date', many: 'past their target dates' }]))).toBe(
      '4 critical items · 1 past its target date',
    );
    expect(keep(registerHeadline([{ count: 200, one: 'person', many: 'people', capped: true }]))).toBe('200+ people');
  });

  it('is omitted rather than "0 problems"', () => {
    expect(registerHeadline([{ count: 0, one: 'problem', many: 'problems' }])).toBeNull();
    expect(registerHeadline([])).toBeNull();
  });
});

describe('the rules every headline keeps', () => {
  it('is at most 110 characters, with no full stop, and the shorter form when the long one would not fit', () => {
    expect(produced.length).toBeGreaterThan(20);
    for (const sentence of produced) {
      expect(sentence.length, sentence).toBeLessThanOrEqual(MAX_HEADLINE);
      expect(sentence.endsWith('.'), sentence).toBe(false);
    }
    expect(finish('Short.')).toBe('Short');
    expect(finish(`${'x'.repeat(120)}`, 'Shorter')).toBe('Shorter');
    expect(finish('y'.repeat(130)).length).toBeLessThanOrEqual(MAX_HEADLINE);
  });

  it('keeps the long team name inside the limit by dropping the clause', () => {
    const long = teamSlaHeadline([{ label: 'A team whose name is far longer than anybody would ever think of giving to a real team', value: 10 }, { label: 'B', value: 95 }], 90);
    expect(long).toBe('1 of 2 teams meet the target');
  });

  it('uses British spelling and no adjective lists', () => {
    for (const sentence of produced) {
      expect(sentence).not.toMatch(/\b(organization|color|behavior|amazing|great|excellent|poor)\b/i);
    }
  });
});
