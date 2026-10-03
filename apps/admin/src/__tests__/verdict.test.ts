import { describe, expect, it, vi } from 'vitest';
import { HEALTH_VERDICT_LABELS } from '@itsm/contracts/health';

vi.mock('server-only', () => ({}));
vi.mock('../bff.js', () => ({ bff: { config: { apiBaseUrl: 'http://127.0.0.1:3000' } } }));

const { aiTriageHealth, serviceDimensions, serviceHealth, statusPageHealth } = await import('../server/verdict.js');
const { isPublicBase, publicStatusUrl } = await import('../server/status.js');

/**
 * The three heroes' verdicts (A7 §4.1, §4.6, §4.7, §11.1; SPEC §7.3, R7).
 *
 * Service health: the bands at exactly T, T − 10 and below; Flow at 98 % and
 * 90 %; a Sev 1 against a Sev 2; automation at 0, 1 and 5; fewer than two
 * dimensions is no hero; the narrative's order; the trend line names its
 * dimensions and never judges the whole service. AI triage: every mode and a
 * recent step back. The status page: worst of, in D5 tones, never amber.
 */

const T = 90;
const base = { target: T, periodDays: 30 } as const;

const verdictOf = (input: Parameters<typeof serviceHealth>[0], id: string) => serviceDimensions(input).find((entry) => entry.id === id)?.verdict;

describe('service health, dimension by dimension', () => {
  it('bands an SLA at exactly the target, ten points under, and below', () => {
    expect(verdictOf({ ...base, responseSla: 90 }, 'response')).toBe('on_track');
    expect(verdictOf({ ...base, responseSla: 89.9 }, 'response')).toBe('at_risk');
    expect(verdictOf({ ...base, responseSla: 80 }, 'response')).toBe('at_risk');
    expect(verdictOf({ ...base, responseSla: 79.9 }, 'response')).toBe('off_track');
    expect(verdictOf({ ...base, target: 95, resolutionSla: 90 }, 'resolution')).toBe('at_risk');
  });

  it('bands Flow at 98 and 90 resolved for every 100 raised (X-m22)', () => {
    expect(verdictOf({ ...base, flow: { raised: 100, resolved: 98 } }, 'flow')).toBe('on_track');
    expect(verdictOf({ ...base, flow: { raised: 100, resolved: 97 } }, 'flow')).toBe('at_risk');
    expect(verdictOf({ ...base, flow: { raised: 100, resolved: 90 } }, 'flow')).toBe('at_risk');
    expect(verdictOf({ ...base, flow: { raised: 100, resolved: 89 } }, 'flow')).toBe('off_track');
    expect(serviceDimensions({ ...base, flow: { raised: 448, resolved: 415 } })[0]).toMatchObject({ detail: 'Resolved 93 for every 100 raised', verdict: 'at_risk' });
  });

  it('puts a Sev 1 off track and a Sev 2 or 3 at risk', () => {
    expect(verdictOf({ ...base, majorIncidents: [] }, 'major-incidents')).toBe('on_track');
    expect(verdictOf({ ...base, majorIncidents: [{ number: 'MI-0004', severity: 'SEV2' }] }, 'major-incidents')).toBe('at_risk');
    expect(verdictOf({ ...base, majorIncidents: [{ number: 'MI-0005', severity: 'SEV3' }] }, 'major-incidents')).toBe('at_risk');
    expect(verdictOf({ ...base, majorIncidents: [{ number: 'MI-0004', severity: 'SEV2' }, { number: 'MI-0006', severity: 'SEV1' }] }, 'major-incidents')).toBe('off_track');
    expect(serviceDimensions({ ...base, majorIncidents: [{ number: 'MI-0004', severity: 'SEV2' }] })[0]?.detail).toBe('1 open · Sev 2');
  });

  it('bands automation at 0, 1 and 5 failures', () => {
    expect(verdictOf({ ...base, automationFailures: 0 }, 'automation')).toBe('on_track');
    expect(verdictOf({ ...base, automationFailures: 1 }, 'automation')).toBe('at_risk');
    expect(verdictOf({ ...base, automationFailures: 4 }, 'automation')).toBe('at_risk');
    expect(verdictOf({ ...base, automationFailures: 5 }, 'automation')).toBe('off_track');
  });

  it('bands satisfaction at 80 and 70, and shows it as stars', () => {
    expect(verdictOf({ ...base, satisfaction: 80 }, 'customer')).toBe('on_track');
    expect(verdictOf({ ...base, satisfaction: 79 }, 'customer')).toBe('at_risk');
    expect(verdictOf({ ...base, satisfaction: 69 }, 'customer')).toBe('off_track');
    expect(serviceDimensions({ ...base, satisfaction: 85 })[0]?.detail).toBe('4.4 out of 5');
  });

  it('draws a dimension that answered with nothing as "No data", outside the verdict', () => {
    const dimensions = serviceDimensions({ ...base, responseSla: null, satisfaction: null });
    expect(dimensions.map((entry) => [entry.detail, entry.verdict, entry.tone])).toEqual([
      ['No data', null, 'neutral'],
      ['No responses', null, 'neutral'],
    ]);
  });

  it('leaves out a dimension the person may not see', () => {
    expect(serviceDimensions({ ...base, responseSla: 92 }).map((entry) => entry.id)).toEqual(['response']);
  });
});

describe('service health, the verdict', () => {
  const jordan = {
    ...base,
    responseSla: 92,
    resolutionSla: 84,
    flow: { raised: 448, resolved: 415 },
    majorIncidents: [{ number: 'MI-0004', severity: 'SEV2' }],
    automationFailures: 0,
    satisfaction: 85,
    previous: { responseSla: 91, resolutionSla: 86, flow: { raised: 420, resolved: 405 }, satisfaction: 83 },
  };

  it('reads "At risk" for Jordan’s desk, with the words of @itsm/contracts/health', () => {
    const health = serviceHealth(jordan)!;
    expect(health.verdict).toBe('at_risk');
    expect(health.label).toBe(HEALTH_VERDICT_LABELS.at_risk);
    expect(health.tone).toBe('warning');
    expect(health.chips).toEqual([
      { verdict: 'on_track', label: '3 on track', href: '#health-response' },
      { verdict: 'at_risk', label: '3 at risk', href: '#health-resolution' },
    ]);
  });

  it('says the major incident first, then the worst SLA', () => {
    expect(serviceHealth(jordan)!.narrative).toBe('MI-0004 is open at Sev 2, and resolution attainment is 84% against a 90% target');
    expect(serviceHealth({ ...jordan, majorIncidents: [] })!.narrative).toBe('Resolution attainment is 84% against a 90% target, and flow is behind: resolved 93 for every 100 raised');
    expect(serviceHealth({ ...jordan, majorIncidents: [], resolutionSla: 95, flow: { raised: 10, resolved: 10 } })!.narrative).toBe('Every measure shown is on track');
  });

  it('is the worst dimension shown: one Sev 1 makes the service off track', () => {
    expect(serviceHealth({ ...jordan, majorIncidents: [{ number: 'MI-0009', severity: 'SEV1' }] })!.verdict).toBe('off_track');
    expect(serviceHealth({ ...base, responseSla: 95, resolutionSla: 92 })!.verdict).toBe('on_track');
  });

  it('draws no hero with fewer than two dimensions that answered', () => {
    expect(serviceHealth({ ...base, responseSla: 92 })).toBeNull();
    expect(serviceHealth({ ...base, responseSla: 92, resolutionSla: null, satisfaction: null })).toBeNull();
    expect(serviceHealth(base)).toBeNull();
  });

  it('names SLA, flow and satisfaction in the trend line, never the whole service (X-m21)', () => {
    expect(serviceHealth(jordan)!.trend).toBe('SLA and flow were at risk in the previous 30 days');
    expect(serviceHealth({ ...jordan, previous: { responseSla: 95, resolutionSla: 93, flow: { raised: 10, resolved: 10 }, satisfaction: 90 } })!.trend).toBe(
      'SLA, flow and satisfaction were on track in the previous 30 days',
    );
    expect(serviceHealth({ ...jordan, previous: { responseSla: 70, flow: { raised: 100, resolved: 95 }, satisfaction: 90 } })!.trend).toBe(
      'SLA was off track and flow at risk in the previous 30 days',
    );
    expect(serviceHealth({ ...jordan, previous: undefined })!.trend).toBeNull();
    expect(serviceHealth(jordan)!.trend).not.toMatch(/service|desk/i);
  });
});

describe('AI triage', () => {
  const now = new Date('2026-10-02T10:00:00Z');

  it('says what each mode does, without amber', () => {
    expect(aiTriageHealth({ mode: 'off', now })).toMatchObject({ label: 'Off', tone: 'neutral' });
    expect(aiTriageHealth({ mode: 'shadow', now })).toMatchObject({ label: 'Learning in shadow', tone: 'info' });
    expect(aiTriageHealth({ mode: 'suggest', now })).toMatchObject({ label: 'Suggesting to agents', tone: 'info', kicker: 'AI triage' });
    expect(aiTriageHealth({ mode: 'auto', autoFields: 2, now })).toMatchObject({ label: 'Setting 2 fields by itself', tone: 'success' });
    expect(aiTriageHealth({ mode: 'auto', autoFields: 1, now }).label).toBe('Setting 1 field by itself');
  });

  it('says it stepped back within seven days, in the high tone', () => {
    expect(aiTriageHealth({ mode: 'suggest', lastStepDownAt: '2026-09-30T08:00:00Z', now })).toMatchObject({ label: 'Stepped back to suggest', tone: 'high' });
    expect(aiTriageHealth({ mode: 'suggest', lastStepDownAt: '2026-09-20T08:00:00Z', now }).label).toBe('Suggesting to agents');
  });

  it('labels sample data (D13)', () => {
    expect(aiTriageHealth({ mode: 'suggest', samples: 60, now })).toMatchObject({ kicker: 'AI triage · sample data', sample: true });
    expect(aiTriageHealth({ mode: 'suggest', samples: 0, now }).sample).toBe(false);
  });

  it('never uses amber for any mode', () => {
    for (const mode of ['off', 'shadow', 'suggest', 'auto'] as const) expect(aiTriageHealth({ mode, now }).tone).not.toBe('warning');
  });
});

describe('the status page', () => {
  it('is the worst visible component, in the component tones (X-B3)', () => {
    const verdict = statusPageHealth([
      { name: 'Email', status: 'operational' },
      { name: 'Identity & access', status: 'degraded' },
      { name: 'VPN', status: 'partial_outage' },
    ]);
    expect(verdict).toMatchObject({ state: 'partial_outage', label: 'Partly down', tone: 'danger' });
    expect(verdict.affected.map((entry) => entry.name)).toEqual(['VPN', 'Identity & access']);
    expect(statusPageHealth([{ name: 'Email', status: 'operational' }])).toMatchObject({ label: 'All services running', tone: 'success', affected: [] });
    expect(statusPageHealth([{ name: 'Sage', status: 'maintenance' }])).toMatchObject({ label: 'Under maintenance', tone: 'info' });
    expect(statusPageHealth([{ name: 'VPN', status: 'degraded' }])).toMatchObject({ label: 'Degraded', tone: 'high' });
    expect(statusPageHealth([{ name: 'VPN', status: 'major_outage' }, { name: 'Sage', status: 'maintenance' }])).toMatchObject({ label: 'Down', tone: 'danger' });
  });

  it('never uses amber, whatever the components say', () => {
    for (const status of ['operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance', 'unknown']) {
      expect(statusPageHealth([{ name: 'X', status }]).tone).not.toBe('warning');
    }
  });

  it('links the public page only at an address a visitor could open', () => {
    expect(publicStatusUrl({ path: '/status/northwind', isPublic: true }, 'https://api.acme.test')).toBe('https://api.acme.test/status/northwind');
    expect(publicStatusUrl({ slug: 'northwind' }, 'https://api.acme.test/')).toBe('https://api.acme.test/status/northwind');
    expect(publicStatusUrl({ path: '/status/northwind', isPublic: false }, 'https://api.acme.test')).toBeNull();
    expect(publicStatusUrl({ path: '/status/northwind' })).toBeNull();
    expect(publicStatusUrl({ path: '//evil.test/x' }, 'https://api.acme.test')).toBeNull();
    for (const base of ['http://127.0.0.1:3000', 'http://api.railway.internal:8080', 'http://localhost:3000', 'http://10.1.2.3', 'ftp://api.acme.test', '', 'not a url']) {
      expect(isPublicBase(base), base).toBe(false);
    }
    expect(isPublicBase('https://api.acme.test')).toBe(true);
  });
});
