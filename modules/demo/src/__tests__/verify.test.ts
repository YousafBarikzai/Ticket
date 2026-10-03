import { describe, expect, it } from 'vitest';
import { DEMO_GENERATOR_VERSION } from '../config.js';
import { FIXTURE_CONTENT } from '../plan/__fixtures__/content.js';
import { planWithContent } from '../plan/generate.js';
import type { DemoPlan } from '../plan/types.js';
import { BANDS, CHECK_IDS, compareReplay, planFacts, verifyGeneration, type CheckId, type VerifyFacts, type VerifyReport } from '../verify/verify.js';

/**
 * Step S10 (SPEC §5.3, A4 §3.2): each of V1–V10 refuses — or, for V2, warns —
 * on a crafted counter-example, and a faithful build of the plan passes.
 */

const plan: DemoPlan = planWithContent(
  { seed: 20261002, anchor: Date.parse('2026-10-02T09:40:00Z'), scale: 0.2, historyDays: 120, generatorVersion: DEMO_GENERATOR_VERSION },
  FIXTURE_CONTENT,
);
const good: VerifyFacts = planFacts(plan);
const SMALL = { scale: 0.2 };
const FULL = { scale: 1 };

const run = (facts: Partial<VerifyFacts>, options = SMALL): VerifyReport => verifyGeneration({ ...good, ...facts }, plan, options);
const outcome = (report: VerifyReport, id: CheckId) => report.checks.find((check) => check.id === id)!.outcome;
const failsOnly = (report: VerifyReport, id: CheckId) => {
  expect(report.ok).toBe(false);
  expect(report.failed).toEqual([id]);
};

describe('a faithful build', () => {
  it('passes every check, in order', () => {
    const report = run({});
    expect(report.checks.map((check) => check.id)).toEqual([...CHECK_IDS]);
    expect(report.failed).toEqual([]);
    expect(report.warned).toEqual([]);
    expect(report.ok).toBe(true);
    for (const check of report.checks) expect(check.summary.length).toBeGreaterThan(0);
  });

  it('records what it measured, ready for the ledger', () => {
    const report = run({});
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
    expect(report.checks.find((check) => check.id === 'V3')!.detail).toHaveProperty('overall');
  });
});

describe('V1 · the ticket projection', () => {
  it('refuses when the facts drifted from the tickets', () => {
    failsOnly(run({ drift: { expected: 400, actual: 380, breached: true } }), 'V1');
  });
});

describe('V2 · replay against the plan (a warning, never a refusal)', () => {
  const flipped = (count: number) =>
    good.replay.map((row, index) => (index < count && row.verdict === 'met' ? { ...row, verdict: 'breached' as const } : row));

  it('warns above 0.5 % disagreement and still lets the generation swap', () => {
    const many = Math.ceil(good.replay.length * 0.02);
    const report = run({ replay: flipped(many) });
    expect(outcome(report, 'V2')).toBe('warn');
    expect(report.ok).toBe(true);
    expect(report.warned).toEqual(['V2']);
  });

  it('passes within 0.5 %', () => {
    const report = run({ replay: flipped(1) });
    expect(compareReplay(plan, flipped(1)).disagreements).toBeLessThanOrEqual(1);
    expect(outcome(report, 'V2')).toBe('pass');
  });

  it('warns when tickets were never replayed, and counts what it compared', () => {
    const replay = good.replay.slice(30);
    expect(compareReplay(plan, replay)).toMatchObject({ missing: 30, disagreements: 0 });
    expect(outcome(run({ replay }), 'V2')).toBe('warn');
  });
});

describe('V3 · attainment', () => {
  it('refuses overall, response, update or resolution outside the band', () => {
    failsOnly(run({ attainment: { ...good.attainment, overall: 79 } }), 'V3');
    failsOnly(run({ attainment: { ...good.attainment, response: 98.5 } }), 'V3');
    failsOnly(run({ attainment: { ...good.attainment, update: 70 } }), 'V3');
    failsOnly(run({ attainment: { ...good.attainment, resolution: 92 } }), 'V3');
  });

  it('refuses when nothing finished in the 30 days', () => {
    failsOnly(run({ attainment: { ...good.attainment, response: null } }), 'V3');
  });

  it('widens every band by three points below full scale', () => {
    const facts = { attainment: { overall: 81, response: 87, update: 73, resolution: 78 } };
    expect(outcome(run(facts, SMALL), 'V3')).toBe('pass');
    expect(outcome(run(facts, FULL), 'V3')).toBe('fail');
    expect(BANDS.attainment.overall).toEqual({ min: 83, max: 87 });
  });
});

describe('V4 · CSAT', () => {
  it('holds 83–87 at full scale and 80–90 below it', () => {
    expect(outcome(run({ csat: 85 }, FULL), 'V4')).toBe('pass');
    expect(outcome(run({ csat: 82 }, FULL), 'V4')).toBe('fail');
    expect(outcome(run({ csat: 82 }, SMALL), 'V4')).toBe('pass');
    failsOnly(run({ csat: 79.5 }), 'V4');
    failsOnly(run({ csat: 91 }), 'V4');
  });

  it('refuses when nobody answered', () => {
    failsOnly(run({ csat: null }), 'V4');
  });
});

describe('V5 · channel and priority mix', () => {
  const channels = { portal: 400, email: 280, teams: 140, voice: 90, mobile: 40, system: 50 };
  const priorities = { P1: 20, P2: 100, P3: 480, P4: 400 };

  it('passes A4’s mix', () => {
    expect(outcome(run({ channels, priorities }, FULL), 'V5')).toBe('pass');
  });

  it('refuses a single import, api, Slack or WhatsApp ticket', () => {
    for (const channel of ['import', 'api', 'slack', 'whatsapp']) {
      failsOnly(run({ channels: { ...channels, [channel]: 1 }, priorities }, FULL), 'V5');
    }
  });

  it('refuses a channel the demo does not use at all', () => {
    failsOnly(run({ channels: { ...channels, fax: 3 }, priorities }, FULL), 'V5');
  });

  it('refuses a share more than three points off, and a priority more than two', () => {
    failsOnly(run({ channels: { ...channels, portal: 470 }, priorities }, FULL), 'V5');
    failsOnly(run({ channels, priorities: { P1: 20, P2: 130, P3: 450, P4: 400 } }, FULL), 'V5');
    // Below full scale the same mix is within the widened band.
    expect(outcome(run({ channels, priorities: { P1: 20, P2: 130, P3: 450, P4: 400 } }, SMALL), 'V5')).toBe('pass');
  });
});

describe('V6 · personas', () => {
  const personas = good.personas;
  const change = (key: string, patch: Partial<VerifyFacts['personas'][number]>) => personas.map((p) => (p.key === key ? { ...p, ...patch } : p));

  it('refuses a missing or inactive persona', () => {
    failsOnly(run({ personas: change('employee', { exists: false }) }), 'V6');
    failsOnly(run({ personas: personas.filter((p) => p.key !== 'admin') }), 'V6');
    failsOnly(run({ personas: change('admin', { active: false }) }), 'V6');
  });

  it('refuses roles that are not exactly the persona table’s', () => {
    failsOnly(run({ personas: change('agent', { roles: ['agent'] }) }), 'V6');
    failsOnly(run({ personas: change('employee', { roles: ['requester', 'agent'] }) }), 'V6');
  });

  it('refuses Alex not leading the Service Desk', () => {
    failsOnly(run({ personas: change('agent', { leads: [] }) }), 'V6');
  });
});

describe('V7 · the story', () => {
  it('refuses no live incident, two, or one in the wrong state for the mode', () => {
    failsOnly(run({ openMajorIncidents: [] }), 'V7');
    failsOnly(run({ openMajorIncidents: [...good.openMajorIncidents, { number: 'MI-0003', state: 'resolved' }] }), 'V7');
    failsOnly(run({ openMajorIncidents: [{ number: 'MI-0004', state: 'monitoring' }] }), 'V7');
  });

  it('refuses a missing, an extra or a misrouted pending approval', () => {
    failsOnly(run({ pendingApprovals: good.pendingApprovals.slice(1) }), 'V7');
    failsOnly(run({ pendingApprovals: [...good.pendingApprovals, { subject: 'demo:t:2026-09-30:01', approver: 'richard-hale' }] }), 'V7');
    const emma = good.pendingApprovals.findIndex((a) => a.approver === 'emma-clarke');
    failsOnly(run({ pendingApprovals: good.pendingApprovals.map((a, i) => (i === emma ? { ...a, approver: 'jordan-lee' } : a)) }), 'V7');
  });

  it('refuses a missing hero, one in the wrong state, and a Service Desk hero in another team', () => {
    failsOnly(run({ heroes: good.heroes.filter((h) => h.ref !== 'demo:hero:A1') }), 'V7');
    failsOnly(run({ heroes: good.heroes.map((h) => (h.ref === 'demo:hero:A2' ? { ...h, status: 'resolved' } : h)) }), 'V7');
    const report = run({ heroes: good.heroes.map((h) => (h.ref === 'demo:hero:E3' ? { ...h, team: 'euc' } : h)) });
    failsOnly(report, 'V7');
    expect(report.checks.find((check) => check.id === 'V7')!.summary).toContain('Service Desk hero E3');
  });

  it('refuses the wrong number of warranties ending within 30 days', () => {
    failsOnly(run({ warrantiesWithin30Days: 22 }), 'V7');
  });
});

describe('V8 · invariants', () => {
  it('refuses each broken invariant on its own', () => {
    failsOnly(run({ cancelledWithApproval: 1 }), 'V8');
    failsOnly(run({ pendingApprovalOutsidePendingStatus: 1 }), 'V8');
    failsOnly(run({ runningTimersDueWithin10Min: 2 }), 'V8');
  });

  it('refuses a published form with a required file field, the guard kept for a future question type', () => {
    failsOnly(run({ publishedFormsWithRequiredFileField: 1 }), 'V8');
  });
});

describe('V9 · quiet', () => {
  it('refuses an outbox row published while seeding', () => {
    failsOnly(run({ publishedOutboxRows: 1 }), 'V9');
  });

  it('refuses an enqueue refused for the quiet tenant during the build', () => {
    failsOnly(run({ quietRefusals: { before: 4, after: 5 } }), 'V9');
    expect(outcome(run({ quietRefusals: { before: 4, after: 4 } }), 'V9')).toBe('pass');
  });
});

describe('V10 · content', () => {
  it('refuses a description with an unfilled slot', () => {
    const report = run({ descriptionsWithBraces: ['demo:t:2026-09-30:03'] });
    failsOnly(report, 'V10');
    expect(report.checks.find((check) => check.id === 'V10')!.summary).toContain('demo:t:2026-09-30:03');
  });
});

describe('a report with several failures', () => {
  it('lists them in check order, with the warnings apart', () => {
    const report = run({
      descriptionsWithBraces: ['x'],
      drift: { expected: 1, actual: 2, breached: true },
      replay: good.replay.map((row) => ({ ...row, verdict: row.verdict === 'met' ? ('breached' as const) : row.verdict })),
      csat: null,
    });
    expect(report.failed).toEqual(['V1', 'V4', 'V10']);
    expect(report.warned).toEqual(['V2']);
    expect(report.ok).toBe(false);
  });
});
