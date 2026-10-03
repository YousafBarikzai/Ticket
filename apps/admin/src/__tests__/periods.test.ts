import { describe, expect, it } from 'vitest';
import {
  bucketFor,
  customFloor,
  metricPeriod,
  parseRange,
  periodDays,
  periodPhrase,
  previousPeriod,
  rangesFor,
} from '../server/periods.js';
import { demoOf, disabledReason, isDisabled, isPersona, isSettingLocked } from '../server/demo.js';

/**
 * The periods Administration reads its numbers over (A7 §2.3, §2.4 rule 6,
 * §11.1): what each page offers, what the demo hides (D17), how `?range=` is
 * read, the previous period a delta compares with, and the series bucket.
 */

const NOW = new Date('2026-10-02T10:04:00Z');
const real = {};
const demo = { demo: { persona: 'admin', area: 'admin', generation: 3, company: 'Northwind Traders (UK)', disabledFeatures: ['integrations', 'roles', 'not-a-feature'], personaUserIds: { employee: 'u-e', agent: 'u-a', admin: 'u-j' }, agentTeamIds: ['team-sd'] } };

describe('which periods a page offers', () => {
  it('offers 7, 30 and 90 days on the Command centre, in the demo too', () => {
    expect(rangesFor(real, 'command-centre')).toEqual(['7d', '30d', '90d']);
    expect(rangesFor(demo, 'command-centre')).toEqual(['7d', '30d', '90d']);
  });

  it('offers 12 months and Custom on Insights and SLA performance, but never 12 months in the demo', () => {
    expect(rangesFor(real, 'insights')).toEqual(['7d', '30d', '90d', '12m', 'custom']);
    expect(rangesFor(real, 'sla-performance')).toEqual(['7d', '30d', '90d', '12m', 'custom']);
    expect(rangesFor(demo, 'insights')).toEqual(['7d', '30d', '90d', 'custom']);
    expect(rangesFor(demo, 'sla-performance')).not.toContain('12m');
  });

  it('keeps AI triage on 30, 90 and 180 days, and drops 180 days in the demo', () => {
    expect(rangesFor(real, 'ai-triage')).toEqual(['30d', '90d', '180d']);
    expect(rangesFor(demo, 'ai-triage')).toEqual(['30d', '90d']);
  });

  it('never offers year to date anywhere', () => {
    for (const page of ['command-centre', 'insights', 'sla-performance', 'teams', 'ai-triage'] as const) {
      expect(rangesFor(real, page) as readonly string[]).not.toContain('ytd');
    }
  });
});

describe('reading ?range=', () => {
  it('falls back to the default for nothing, nonsense, or a period the page does not offer', () => {
    expect(parseRange({}, real, 'command-centre')).toEqual({ range: '30d' });
    expect(parseRange({ range: 'fortnight' }, real, 'command-centre')).toEqual({ range: '30d' });
    expect(parseRange({ range: '12m' }, real, 'command-centre')).toEqual({ range: '30d' });
    expect(parseRange(new URLSearchParams('range=7d'), real, 'command-centre')).toEqual({ range: '7d' });
    expect(parseRange({ range: ['90d', '7d'] }, real, 'command-centre')).toEqual({ range: '90d' });
  });

  it('refuses the demo’s hidden periods, even from an old link', () => {
    expect(parseRange({ range: '12m' }, demo, 'insights')).toEqual({ range: '30d' });
    expect(parseRange({ range: '12m' }, real, 'insights')).toEqual({ range: '12m' });
  });

  it('reads a custom period only with two real dates the right way round', () => {
    expect(parseRange({ range: 'custom', from: '2026-09-01', to: '2026-09-14' }, real, 'insights', '30d', NOW)).toEqual({ range: 'custom', from: '2026-09-01', to: '2026-09-14' });
    expect(parseRange({ range: 'custom', from: '2026-09-14', to: '2026-09-01' }, real, 'insights', '30d', NOW)).toEqual({ range: '30d' });
    expect(parseRange({ range: 'custom', from: '2026-02-30', to: '2026-03-01' }, real, 'insights', '30d', NOW)).toEqual({ range: '30d' });
    expect(parseRange({ range: 'custom', from: '2026-09-01' }, real, 'insights', '30d', NOW)).toEqual({ range: '30d' });
  });

  it('brings a future end back to today', () => {
    expect(parseRange({ range: 'custom', from: '2026-09-20', to: '2026-12-31' }, real, 'insights', '30d', NOW)).toEqual({ range: 'custom', from: '2026-09-20', to: '2026-10-02' });
  });

  it('clamps a demo custom period to the last 120 days (D17)', () => {
    expect(customFloor(real, NOW)).toBeNull();
    expect(customFloor(demo, NOW)).toBe('2026-06-04');
    expect(parseRange({ range: 'custom', from: '2026-01-01', to: '2026-07-01' }, demo, 'insights', '30d', NOW)).toEqual({ range: 'custom', from: '2026-06-04', to: '2026-07-01' });
    expect(parseRange({ range: 'custom', from: '2026-01-01', to: '2026-02-01' }, demo, 'insights', '30d', NOW)).toEqual({ range: '30d' });
  });
});

describe('the previous period', () => {
  it('ends where a named period starts, as the API resolves them (moved from the Command centre)', () => {
    expect(previousPeriod('30d', NOW)).toEqual({ from: '2026-08-04T00:00:00.000Z', to: '2026-09-03T00:00:00.000Z' });
    expect(previousPeriod('7d', NOW)).toEqual({ from: '2026-09-19T00:00:00.000Z', to: '2026-09-26T00:00:00.000Z' });
    expect(previousPeriod({ range: '90d' }, NOW).to).toBe('2026-07-05T00:00:00.000Z');
  });

  it('is the same number of days just before a custom period', () => {
    expect(previousPeriod({ range: 'custom', from: '2026-09-01', to: '2026-09-14' }, NOW)).toEqual({ from: '2026-08-18T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' });
  });
});

describe('buckets and the question’s period', () => {
  it('uses days to a month, weeks to 180 days, months beyond', () => {
    expect(bucketFor('7d')).toBe('day');
    expect(bucketFor('30d')).toBe('day');
    expect(bucketFor('90d')).toBe('week');
    expect(bucketFor('180d')).toBe('week');
    expect(bucketFor('12m')).toBe('month');
    expect(bucketFor({ range: 'custom', from: '2026-09-01', to: '2026-09-14' })).toBe('day');
    expect(bucketFor({ range: 'custom', from: '2026-06-04', to: '2026-10-02' })).toBe('week');
  });

  it('names a period the API knows, and spells out the rest as instants', () => {
    expect(metricPeriod('30d', NOW)).toEqual({ range: '30d' });
    expect(metricPeriod('180d', NOW)).toEqual({ range: 'custom', from: '2026-04-06T00:00:00.000Z', to: '2026-10-03T00:00:00.000Z' });
    expect(metricPeriod({ range: 'custom', from: '2026-09-01', to: '2026-09-14' }, NOW)).toEqual({ range: 'custom', from: '2026-09-01T00:00:00.000Z', to: '2026-09-15T00:00:00.000Z' });
  });

  it('says how long a period is, in days and in words', () => {
    expect(periodDays('90d')).toBe(90);
    expect(periodDays({ range: 'custom', from: '2026-09-01', to: '2026-09-14' })).toBe(14);
    expect(periodPhrase('30d')).toBe('the last 30 days');
    expect(periodPhrase('12m')).toBe('the last 12 months');
    expect(periodPhrase({ range: 'custom', from: '2026-09-01', to: '2026-09-14' })).toBe('1 Sept to 14 Sept');
  });
});

describe('the demo reader', () => {
  it('reads nothing into a real account', () => {
    expect(demoOf(real)).toMatchObject({ on: false });
    expect(demoOf(null).disabled.size).toBe(0);
    expect(isDisabled({}, 'integrations')).toBe(false);
    expect(disabledReason(undefined, 'roles')).toBeNull();
    expect(isSettingLocked({}, 'sla.attainment.target')).toBe(false);
  });

  it('knows the demo’s features, its personas and Alex Morgan’s teams, and ignores a feature it does not know', () => {
    const state = demoOf(demo as never);
    expect(state.on).toBe(true);
    expect([...state.disabled]).toEqual(['integrations', 'roles']);
    expect(state.agentTeamIds).toEqual(['team-sd']);
    expect(isPersona(demo as never, 'u-j')).toBe(true);
    expect(isPersona(demo as never, 'u-other')).toBe(false);
    expect(disabledReason(demo as never, 'integrations')).toMatch(/^This is a shared demo, so .+ turned off\. Everything else works as in the full product\.$/);
    expect(disabledReason(demo as never, 'audit-export')).toBeNull();
  });

  it('locks the settings the demo shares, and only in the demo (Y-M12)', () => {
    expect(isSettingLocked(demo as never, 'sla.attainment.target')).toBe(true);
    expect(isSettingLocked(demo as never, 'ticket.number.prefix')).toBe(false);
  });
});
