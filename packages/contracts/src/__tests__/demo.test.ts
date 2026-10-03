import { describe, expect, it } from 'vitest';
import {
  DEMO_AREAS,
  DEMO_BUILD_ACTOR,
  DEMO_BUILD_REASON,
  DEMO_BUILD_STEPS,
  DEMO_CAPS,
  DEMO_CAP_CATEGORIES,
  DEMO_COMPANY,
  DEMO_COPY,
  DEMO_FEATURES,
  DEMO_KEYS,
  DEMO_LOCAL_KEYS,
  DEMO_LOCKED_SETTINGS,
  DEMO_PERSONAS,
  DEMO_PERSONA_FOR_AREA,
  DEMO_PROBLEM_CODES,
  DEMO_RESET,
  DEMO_SD_HEROES,
  DEMO_STRIPPED_PERMISSIONS,
  DEMO_STRIPPED_PREFIXES,
  DEMO_TENANT_SLUG_PATTERN,
  DEMO_TOKEN_PATTERN,
  DEMO_TOKEN_PREFIX,
  computeDemoStatus,
  demoDisabledSentence,
  demoEntryHref,
  demoEtaPhrase,
  demoFeatureForPermission,
  demoHeroRef,
  demoKeyPatternList,
  demoLimitSentence,
  demoPersona,
  demoPersonaForArea,
  demoResetNotice,
  demoWindow,
  isDemoArea,
  isDemoFeature,
  isDemoHeroRef,
  isDemoKey,
  isDemoLockedSetting,
  isDemoPersonaKey,
  isDemoTokenShape,
  mayMint,
  nextResetAt,
  periodMs,
  previousResetAt,
  secondsUntilNextReset,
  signInAgainHref,
  ukDateKey,
} from '../demo.js';
import type {
  DemoArea,
  DemoBackoff,
  DemoBuildState,
  DemoCooldown,
  DemoLiveRecord,
  DemoStatusRecords,
} from '../demo.js';

const at = (iso: string): number => Date.parse(iso);

describe('the persona table', () => {
  it('has exactly three personas with unique keys, areas, emails and buttons', () => {
    expect(DEMO_PERSONAS).toHaveLength(3);
    for (const field of ['key', 'area', 'email', 'button', 'name', 'initials'] as const) {
      expect(new Set(DEMO_PERSONAS.map((p) => p[field])).size).toBe(3);
    }
  });

  it('gives every persona an address at the undeliverable company domain', () => {
    expect(DEMO_COMPANY.emailDomain).toBe('northwind.example');
    for (const p of DEMO_PERSONAS) {
      expect(p.email.endsWith(`@${DEMO_COMPANY.emailDomain}`)).toBe(true);
      expect(p.email).toBe(`${p.name.toLowerCase().replace(' ', '.')}@northwind.example`);
      expect(p.initials).toBe(
        p.name
          .split(' ')
          .map((part) => part[0])
          .join(''),
      );
    }
  });

  it('names the company exactly', () => {
    expect(DEMO_COMPANY).toEqual({
      name: 'Northwind Traders (UK)',
      emailDomain: 'northwind.example',
      plan: 'professional',
      vendorLine: 'Powered by VNE Technologies',
    });
  });

  it('gives Alex the agent and team-lead roles and the lead of service-desk', () => {
    const alex = demoPersona('agent');
    expect(alex).toMatchObject({ name: 'Alex Morgan', title: 'Service Desk team lead', area: 'workbench', button: 'Agent' });
    expect(alex?.roles).toEqual(['agent', 'team_lead']);
    expect(alex?.team).toEqual({ key: 'service-desk', lead: true });
  });

  it('gives Jordan the administrator and service-owner roles, and no team', () => {
    const jordan = demoPersona('admin');
    expect(jordan).toMatchObject({ name: 'Jordan Lee', title: 'IT Service Manager', area: 'admin', button: 'Admin' });
    expect(jordan?.roles).toEqual(['administrator', 'service_owner']);
    expect(jordan?.team).toBeUndefined();
  });

  it('gives Emma only the requester role', () => {
    const emma = demoPersona('employee');
    expect(emma).toMatchObject({ name: 'Emma Clarke', title: 'Finance Manager', area: 'portal', button: 'Employee' });
    expect(emma?.roles).toEqual(['requester']);
  });

  it('derives the area map from the table, as a bijection', () => {
    expect(Object.keys(DEMO_PERSONA_FOR_AREA).sort()).toEqual([...DEMO_AREAS].sort());
    expect(new Set(Object.values(DEMO_PERSONA_FOR_AREA)).size).toBe(DEMO_AREAS.length);
    for (const area of DEMO_AREAS) {
      const p = demoPersonaForArea(area);
      expect(p.area).toBe(area);
      expect(DEMO_PERSONA_FOR_AREA[area]).toBe(p.key);
    }
    expect(DEMO_PERSONA_FOR_AREA).toEqual({ portal: 'employee', workbench: 'agent', admin: 'admin' });
  });

  it('lets each app mint exactly its own persona', () => {
    for (const app of DEMO_AREAS) {
      const allowed = DEMO_PERSONAS.filter((p) => mayMint(app, p.key));
      expect(allowed.map((p) => p.key)).toEqual([DEMO_PERSONA_FOR_AREA[app]]);
    }
    for (const junk of ['', 'Admin', 'AGENT', 'root', null, undefined, 1, {}, 'toString', '__proto__', 'constructor']) {
      expect(mayMint('admin', junk)).toBe(false);
    }
    expect(mayMint('site' as DemoArea, 'agent')).toBe(false);
  });

  it('returns null for anything that is not in the table, prototype names included', () => {
    for (const junk of ['toString', '__proto__', 'constructor', 'hasOwnProperty', '', 'Employee', null, 42, ['agent']]) {
      expect(demoPersona(junk)).toBeNull();
      expect(isDemoPersonaKey(junk)).toBe(false);
    }
    expect(isDemoArea('portal')).toBe(true);
    expect(isDemoArea('site')).toBe(false);
    expect(isDemoArea('toString')).toBe(false);
  });

  it('cannot be changed by a consumer', () => {
    expect(Object.isFrozen(DEMO_PERSONAS)).toBe(true);
    for (const p of DEMO_PERSONAS) {
      expect(Object.isFrozen(p)).toBe(true);
      expect(Object.isFrozen(p.roles)).toBe(true);
    }
    expect(() => {
      (DEMO_PERSONAS[0] as { name: string }).name = 'Mallory';
    }).toThrow(TypeError);
  });
});

describe('the reset clock', () => {
  it('resets at midnight UK time', () => {
    expect(DEMO_RESET).toEqual({ timeZone: 'Europe/London', hour: 0, label: '00:00 UK time' });
  });

  it('counts 30 s from 23:59:30 in London, in summer and in winter', () => {
    // 2 Oct 2026 is British Summer Time (UTC+1); 2 Dec 2026 is GMT.
    expect(secondsUntilNextReset(at('2026-10-02T22:59:30.000Z'))).toBe(30);
    expect(nextResetAt(at('2026-10-02T22:59:30.000Z'))).toBe(at('2026-10-02T23:00:00.000Z'));
    expect(secondsUntilNextReset(at('2026-12-02T23:59:30.000Z'))).toBe(30);
    expect(nextResetAt(at('2026-12-02T23:59:30.000Z'))).toBe(at('2026-12-03T00:00:00.000Z'));
  });

  it('rounds the seconds down, so a cookie never outlives its day', () => {
    expect(secondsUntilNextReset(at('2026-10-02T22:59:30.400Z'))).toBe(29);
    expect(secondsUntilNextReset(at('2026-10-02T22:59:59.999Z'))).toBe(0);
  });

  it('has a 25-hour day when the clocks go back (25 Oct 2026)', () => {
    const noon = at('2026-10-25T12:00:00.000Z');
    expect(previousResetAt(noon)).toBe(at('2026-10-24T23:00:00.000Z'));
    expect(nextResetAt(noon)).toBe(at('2026-10-26T00:00:00.000Z'));
    expect(periodMs(noon)).toBe(90_000_000);
  });

  it('has a 23-hour day when the clocks go forward (28 Mar 2027)', () => {
    const noon = at('2027-03-28T12:00:00.000Z');
    expect(previousResetAt(noon)).toBe(at('2027-03-28T00:00:00.000Z'));
    expect(nextResetAt(noon)).toBe(at('2027-03-28T23:00:00.000Z'));
    expect(periodMs(noon)).toBe(82_800_000);
  });

  it('has a 24-hour day otherwise', () => {
    expect(periodMs(at('2026-10-02T12:00:00.000Z'))).toBe(86_400_000);
    expect(periodMs(at('2027-01-15T12:00:00.000Z'))).toBe(86_400_000);
  });

  it('treats the reset instant itself as the start of the new day', () => {
    const midnight = at('2026-10-02T23:00:00.000Z');
    expect(previousResetAt(midnight)).toBe(midnight);
    expect(nextResetAt(midnight)).toBe(at('2026-10-03T23:00:00.000Z'));
    expect(secondsUntilNextReset(midnight)).toBe(86_400);
  });

  it('flips the date key at midnight in London, not at midnight UTC', () => {
    expect(ukDateKey(at('2026-10-02T22:59:59.999Z'))).toBe('2026-10-02');
    expect(ukDateKey(at('2026-10-02T23:00:00.000Z'))).toBe('2026-10-03');
    // 00:30 UTC on 3 Oct is still 3 Oct in London, and 23:30 UTC on 2 Dec is 2 Dec.
    expect(ukDateKey(at('2026-10-03T00:30:00.000Z'))).toBe('2026-10-03');
    expect(ukDateKey(at('2026-12-02T23:30:00.000Z'))).toBe('2026-12-02');
    expect(ukDateKey(at('2026-12-03T00:00:00.000Z'))).toBe('2026-12-03');
  });

  it('refuses a time that is not a number', () => {
    expect(() => nextResetAt(Number.NaN)).toThrow(RangeError);
  });
});

describe('tokens', () => {
  const valid = `${DEMO_TOKEN_PREFIX}${'A'.repeat(20)}-_${'z'.repeat(21)}`;

  it('accepts the minted shape only', () => {
    expect(valid).toHaveLength(9 + 43);
    expect(DEMO_TOKEN_PATTERN.test(valid)).toBe(true);
    expect(isDemoTokenShape(valid)).toBe(true);
    for (const bad of [
      `${DEMO_TOKEN_PREFIX}${'a'.repeat(42)}`,
      `${DEMO_TOKEN_PREFIX}${'a'.repeat(44)}`,
      `${DEMO_TOKEN_PREFIX}${'a'.repeat(42)}*`,
      `${DEMO_TOKEN_PREFIX}${'a'.repeat(42)}:`,
      `${DEMO_TOKEN_PREFIX}${'a'.repeat(42)}\n`,
      `${valid}\n`,
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl',
      `ITSMDEMO_${'a'.repeat(43)}`,
    ]) {
      expect(isDemoTokenShape(bad)).toBe(false);
    }
    expect(isDemoTokenShape(undefined)).toBe(false);
  });

  it('pins the live tenant slug shape the boot interlock relies on', () => {
    for (const ok of ['demo', 'demo-eu', 'demo-2']) expect(DEMO_TENANT_SLUG_PATTERN.test(ok)).toBe(true);
    for (const bad of ['northwind', 'demox', 'Demo', 'demo_', 'demo-', 'demo-EU', 'acme-demo', '']) {
      expect(DEMO_TENANT_SLUG_PATTERN.test(bad), bad).toBe(false);
    }
  });
});

describe('Redis keys', () => {
  const hash = 'ab'.repeat(32);
  const ipb = '0123456789abcdef';
  const sid = 'demo-3f2b8c1e-7a4d-4e5f-9a0b-1c2d3e4f5a6b';
  const now = at('2026-10-02T12:34:56.000Z');
  const m = demoWindow('m', now);
  const h = demoWindow('h', now);

  it('computes the minute and hour windows from the epoch', () => {
    expect(m).toBe(`m:${Math.floor(now / 60_000)}`);
    expect(h).toBe(`h:${Math.floor(now / 3_600_000)}`);
  });

  const built = (): string[] => [
    DEMO_KEYS.live,
    DEMO_KEYS.paused,
    DEMO_KEYS.build,
    DEMO_KEYS.active,
    DEMO_KEYS.events,
    DEMO_KEYS.resetLock,
    DEMO_KEYS.resetCooldown,
    DEMO_KEYS.resetRequested,
    DEMO_KEYS.resetBackoff,
    DEMO_KEYS.token(hash),
    DEMO_KEYS.activeForBucket(ipb),
    DEMO_KEYS.activeForBucket('unknown'),
    DEMO_KEYS.salt(ukDateKey(now)),
    DEMO_KEYS.mintPerBucket('portal', 'employee', ipb, m),
    DEMO_KEYS.mintPerBucket('workbench', 'agent', 'unknown', h),
    DEMO_KEYS.mintAll(m),
    DEMO_KEYS.mintAll(h),
    DEMO_KEYS.mintTop(m),
    DEMO_KEYS.mintTop(h),
    DEMO_KEYS.remint(sid, h),
    DEMO_KEYS.writesPerVisit(sid, m),
    DEMO_KEYS.writesPerVisitTotal(sid),
    DEMO_KEYS.writesPerBucket(ipb, h),
    DEMO_KEYS.writesAll(h),
    DEMO_KEYS.writesTop(h),
    DEMO_KEYS.readsPerBucket(ipb, m),
    ...DEMO_CAP_CATEGORIES.flatMap((category) => [DEMO_KEYS.capPerVisit(41, category, sid), DEMO_KEYS.capAll(41, category)]),
  ];

  it('spells every key of the contract table', () => {
    expect(DEMO_KEYS.token(hash)).toBe(`demo:tok:${hash}`);
    expect(DEMO_KEYS.activeForBucket(ipb)).toBe(`demo:active:ipb:${ipb}`);
    expect(DEMO_KEYS.salt('2026-10-02')).toBe('demo:salt:2026-10-02');
    expect(DEMO_KEYS.mintPerBucket('portal', 'employee', ipb, m)).toBe(`demo:rl:mint:portal:employee:${ipb}:${m}`);
    expect(DEMO_KEYS.mintAll(h)).toBe(`demo:rl:mint:all:${h}`);
    expect(DEMO_KEYS.mintTop(m)).toBe(`demo:rl:mint:top:${m}`);
    expect(DEMO_KEYS.remint(sid, h)).toBe(`demo:rl:remint:${sid}:${h}`);
    expect(DEMO_KEYS.writesPerVisit(sid, m)).toBe(`demo:wb:${sid}:${m}`);
    expect(DEMO_KEYS.writesPerVisitTotal(sid)).toBe(`demo:wb:${sid}:total`);
    expect(DEMO_KEYS.writesPerBucket(ipb, h)).toBe(`demo:wb:ip:${ipb}:${h}`);
    expect(DEMO_KEYS.writesAll(h)).toBe(`demo:wb:all:${h}`);
    expect(DEMO_KEYS.writesTop(h)).toBe(`demo:wb:top:${h}`);
    expect(DEMO_KEYS.readsPerBucket(ipb, m)).toBe(`demo:rb:ip:${ipb}:${m}`);
    expect(DEMO_KEYS.capPerVisit(41, 'mi.declare', sid)).toBe(`demo:cap:41:mi.declare:${sid}`);
    expect(DEMO_KEYS.capAll(41, 'mi.declare')).toBe('demo:cap:41:mi.declare:all');
  });

  it('recognises every key the builders produce', () => {
    for (const key of built()) expect(isDemoKey(key), key).toBe(true);
  });

  it('recognises nothing else, so the isolation scan still fails on tenant data', () => {
    for (const key of [
      'bff:portal:sess:abc',
      `bff:portal:rl:login:${ipb}:${m}`,
      'ops:demo',
      'ops:config-warnings',
      't:0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b:rl:default:x',
      'demo:anything',
      'demo:live:extra',
      'demo:tok:ITSMDEMO',
      `demo:tok:itsmdemo_${'a'.repeat(43)}`,
      `demo:tok:${hash}x`,
      'demo:active:ipb:203.0.113.7',
      `demo:cap:41:not.a.category:${sid}`,
      `demo:cap:0:mi.declare:all`,
      'demo:wb:not-a-sid:total',
      'demo:salt:today',
      'xdemo:live',
      '',
    ]) {
      expect(isDemoKey(key), key).toBe(false);
    }
    expect(isDemoKey(42)).toBe(false);
    expect(demoKeyPatternList().length).toBeGreaterThan(10);
  });

  it('refuses to build a key from a raw token, an address or an unknown category', () => {
    expect(() => DEMO_KEYS.token(`itsmdemo_${'a'.repeat(43)}`)).toThrow(RangeError);
    expect(() => DEMO_KEYS.token('*')).toThrow(RangeError);
    expect(() => DEMO_KEYS.activeForBucket('203.0.113.7')).toThrow(RangeError);
    expect(() => DEMO_KEYS.writesPerVisitTotal('alex')).toThrow(RangeError);
    expect(() => DEMO_KEYS.salt('2026-10-02*')).toThrow(RangeError);
    expect(() => DEMO_KEYS.capAll(0, 'mi.declare')).toThrow(RangeError);
    expect(() => DEMO_KEYS.capAll(1, 'nope' as 'mi.declare')).toThrow(RangeError);
  });
});

describe('computeDemoStatus', () => {
  const now = at('2026-10-02T12:00:00.000Z');
  const tenantId = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
  const userId = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';
  const live: DemoLiveRecord = {
    v: 1,
    tenantId,
    slug: 'demo',
    generation: 41,
    builtAt: now - 3_600_000,
    anchor: now - 3_600_000,
    lastResetAt: now - 3_500_000,
    lastResetReason: 'scheduled',
    personas: { employee: { userId }, agent: { userId }, admin: { userId } },
    agentTeamIds: ['0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5d'],
  };
  const build: DemoBuildState = {
    v: 1,
    state: 'building',
    generation: 42,
    reason: 'manual',
    startedAt: now - 60_000,
    step: 'history',
    stepIndex: 7,
    steps: 11,
    etaSec: 210,
  };
  const none: DemoStatusRecords = { live: null, build: null, cooldown: null, paused: false, backoff: null };
  const cooldown = (agoMs: number): DemoCooldown => ({ at: now - agoMs, generation: 41, reason: 'scheduled' });
  const backoff = (inMs: number): DemoBackoff => ({ v: 1, failures: 2, retryAt: now + inMs, step: 'checks' });

  const rows: {
    name: string;
    records: Partial<DemoStatusRecords>;
    state: string;
    blocked: boolean;
    availableAt: number | null;
  }[] = [
    { name: 'paused, with live data', records: { live, paused: true }, state: 'paused', blocked: true, availableAt: null },
    { name: 'paused while building', records: { live, build, paused: true }, state: 'paused', blocked: true, availableAt: null },
    { name: 'no live data and no build', records: {}, state: 'preparing', blocked: true, availableAt: null },
    { name: 'the first build', records: { build }, state: 'building', blocked: true, availableAt: null },
    { name: 'a build over live data', records: { live, build }, state: 'building', blocked: true, availableAt: null },
    { name: 'live data, nothing else', records: { live }, state: 'ready', blocked: false, availableAt: null },
    {
      name: 'live data in the cooldown',
      records: { live, cooldown: cooldown(12 * 60_000) },
      state: 'ready',
      blocked: true,
      availableAt: now + 18 * 60_000,
    },
    { name: 'a cooldown that has run out', records: { live, cooldown: cooldown(31 * 60_000) }, state: 'ready', blocked: false, availableAt: null },
    { name: 'a backoff after a failed build', records: { live, backoff: backoff(300_000) }, state: 'ready', blocked: true, availableAt: now + 300_000 },
    { name: 'a backoff that has run out', records: { live, backoff: backoff(-1) }, state: 'ready', blocked: false, availableAt: null },
    {
      name: 'a cooldown and a later backoff',
      records: { live, cooldown: cooldown(25 * 60_000), backoff: backoff(900_000) },
      state: 'ready',
      blocked: true,
      availableAt: now + 900_000,
    },
  ];

  for (const row of rows) {
    it(`answers ${row.state} for ${row.name}`, () => {
      const status = computeDemoStatus({ ...none, ...row.records }, now);
      expect(status.state).toBe(row.state);
      expect(status.resetBlocked).toBe(row.blocked);
      expect(status.manualResetAvailableAt).toBe(row.availableAt);
    });
  }

  it('carries the clock, the generation, the build estimate and the persona strings', () => {
    const status = computeDemoStatus({ ...none, live, build }, now);
    expect(status).toMatchObject({
      v: 1,
      demo: true,
      serverNow: now,
      resetTimeZone: 'Europe/London',
      resetLabel: '00:00 UK time',
      resetHour: 0,
      nextResetAt: nextResetAt(now),
      periodMs: 86_400_000,
      generation: 41,
      lastResetAt: live.lastResetAt,
      lastResetReason: 'scheduled',
      build: { startedAt: build.startedAt, etaSec: 210 },
      cooldownSeconds: 1800,
      uploads: false,
      company: { name: 'Northwind Traders (UK)', fictional: true },
    });
    expect(status.personas).toEqual(
      DEMO_PERSONAS.map((p) => ({ key: p.key, button: p.button, name: p.name, title: p.title, area: p.area })),
    );
  });

  it('reports no generation before the first build', () => {
    const status = computeDemoStatus(none, now);
    expect(status).toMatchObject({ generation: null, lastResetAt: null, lastResetReason: null, build: null });
  });

  it('honours a configured cooldown', () => {
    const status = computeDemoStatus({ ...none, live, cooldown: cooldown(5 * 60_000) }, now, { cooldownSeconds: 600 });
    expect(status.cooldownSeconds).toBe(600);
    expect(status.manualResetAvailableAt).toBe(now + 5 * 60_000);
  });

  it('names no tenant, user or team', () => {
    const text = JSON.stringify(computeDemoStatus({ ...none, live, build, cooldown: cooldown(1000) }, now));
    expect(text).not.toContain(tenantId);
    expect(text).not.toContain(userId);
    expect(text).not.toContain(live.agentTeamIds[0]);
    expect(text).not.toContain('@northwind.example');
  });
});

describe('the strip-list', () => {
  it('includes the features v3 added', () => {
    for (const feature of ['notifications', 'story', 'settings', 'uploads', 'ai', 'personas', 'shared-dashboards']) {
      expect(isDemoFeature(feature)).toBe(true);
    }
    expect(new Set(DEMO_FEATURES).size).toBe(DEMO_FEATURES.length);
  });

  it('gives every feature its sentence', () => {
    for (const feature of DEMO_FEATURES) {
      const sentence = demoDisabledSentence(feature);
      expect(sentence).toMatch(/^This is a shared demo, so .+ is turned off\. Everything else works as in the full product\.$/);
      expect(sentence).not.toContain('this action');
    }
    expect(demoDisabledSentence('uploads')).toBe(
      'This is a shared demo, so uploading files is turned off. Everything else works as in the full product.',
    );
    expect(demoDisabledSentence('integrations')).toContain('connecting to other systems');
    expect(demoDisabledSentence('notifications')).toContain('changing notification wording');
    expect(demoDisabledSentence('story')).toContain("changing the demo's story tickets");
    expect(demoDisabledSentence('settings')).toContain('changing this setting in the shared demo');
  });

  it('still says something true about a feature it does not know', () => {
    expect(demoDisabledSentence('from-a-newer-api')).toBe(
      'This is a shared demo, so this action is turned off. Everything else works as in the full product.',
    );
    expect(demoDisabledSentence(undefined)).toContain('this action');
  });

  it('maps every stripped permission to a feature, and the platform prefix to platform', () => {
    for (const [key, feature] of Object.entries(DEMO_STRIPPED_PERMISSIONS)) {
      expect(demoFeatureForPermission(key)).toBe(feature);
      expect(isDemoFeature(feature)).toBe(true);
    }
    expect(DEMO_STRIPPED_PREFIXES).toEqual({ 'platform.': 'platform' });
    expect(demoFeatureForPermission('platform.tenant.manage')).toBe('platform');
    expect(demoFeatureForPermission('notification.template.manage')).toBe('notifications');
    expect(demoFeatureForPermission('ticket.attachment.add')).toBe('uploads');
  });

  it('keeps reads, guarded people management, capped limits and AI suggestions', () => {
    for (const kept of [
      'ticket.read',
      'integration.credential.read',
      'identity.user.manage',
      'tenant.limit.manage',
      'ai.suggest',
      'ai.decision.read',
      'admin.setting.manage',
      'toString',
      '',
    ]) {
      expect(demoFeatureForPermission(kept), kept).toBeNull();
    }
  });

  it('strips only permissions some module declares', async () => {
    // Read through the platform's module list rather than a copy of it, so a
    // renamed key fails here instead of silently coming back in the demo. The
    // specifier is a variable so that type-checking the contracts package
    // does not pull every module into its program.
    const runtime = '@itsm/runtime';
    const { ALL_MODULES } = (await import(/* @vite-ignore */ runtime)) as {
      ALL_MODULES: readonly { readonly permissions: readonly { readonly key: string }[] }[];
    };
    const declared = new Set(ALL_MODULES.flatMap((manifest) => manifest.permissions.map((p) => p.key)));
    expect(declared.size).toBeGreaterThan(50);
    for (const key of Object.keys(DEMO_STRIPPED_PERMISSIONS)) expect(declared.has(key), key).toBe(true);
    for (const prefix of Object.keys(DEMO_STRIPPED_PREFIXES)) {
      expect([...declared].some((key) => key.startsWith(prefix)), prefix).toBe(true);
    }
  }, 60_000);
});

describe('locked settings', () => {
  it('locks whole families and one exact key', () => {
    expect(DEMO_LOCKED_SETTINGS).toEqual([
      'sla.*',
      'ticket.autoClose.*',
      'workflow.*',
      'rules.*',
      'knowledge.requireApprovalToPublish',
      'workload.*',
      'notification.*',
      'channel.*',
      'auth.*',
      'ai.*',
    ]);
    for (const key of [
      'sla.attainment.target',
      'ticket.autoClose.days',
      'workflow.maxActiveRuns',
      'rules.test.sampleSize',
      'knowledge.requireApprovalToPublish',
      'workload.defaultStrategy',
      'notification.email.enabled',
      'channel.email.transport',
      'auth.session.idleMinutes',
      'ai.tone',
    ]) {
      expect(isDemoLockedSetting(key), key).toBe(true);
    }
  });

  it('leaves other settings editable within their cap', () => {
    for (const key of [
      'ticket.reopen.windowDays',
      'knowledge.reviewIntervalDays',
      'incident.updateIntervalMinutes',
      'approval.reminder.hours',
      'slack.thing',
      'sla',
      'ticket.autoClose',
      'knowledge.requireApprovalToPublishX',
      '',
    ]) {
      expect(isDemoLockedSetting(key), key).toBe(false);
    }
  });
});

describe('caps', () => {
  it('holds the headline caps per visit and per generation', () => {
    const pairs = Object.fromEntries(
      DEMO_CAP_CATEGORIES.map((category) => [category, [DEMO_CAPS[category].perVisit, DEMO_CAPS[category].perGeneration]]),
    );
    expect(pairs).toEqual({
      'mi.declare': [1, 10],
      'mi.update': [10, 150],
      'mi.transition': [3, 30],
      'mi.review': [5, 50],
      'kb.publish': [3, 30],
      'kb.draft': [10, 200],
      'catalogue.change': [5, 50],
      'ticket.create': [25, 1500],
      'user.create': [5, 50],
      'user.deactivate': [3, 30],
      'dashboard.change': [5, 50],
      'metric.change': [3, 30],
      'report.change': [5, 50],
      'report.run': [10, 200],
      'rule.change': [5, 40],
      'rule.test': [30, 600],
      'workflow.change': [3, 20],
      'sla.change': [3, 20],
      'approval-policy.change': [3, 20],
      'setting.change': [5, 40],
      'pack.install': [1, 3],
      'field.change': [5, 30],
      'problem.publish': [3, 30],
      'usage.change': [3, 20],
    });
  });

  it('gives every category a sentence with its per-visit figure', () => {
    for (const category of DEMO_CAP_CATEGORIES) {
      const { perVisit, perGeneration } = DEMO_CAPS[category];
      expect(perVisit).toBeLessThanOrEqual(perGeneration);
      const sentence = demoLimitSentence(category);
      expect(sentence).toMatch(/^To keep this shared demo tidy for everyone, each visit can .+\. You've reached that limit\.$/);
      expect(sentence).toContain(perVisit === 1 ? 'one' : String(perVisit));
      expect(sentence).not.toMatch(/\b1 [a-z]+s\b/);
    }
    expect(demoLimitSentence('mi.declare')).toBe(
      "To keep this shared demo tidy for everyone, each visit can declare one major incident. You've reached that limit.",
    );
    expect(demoLimitSentence('ticket.create')).toContain('each visit can raise 25 tickets.');
  });

  it('words the write budget from the figure the API sent', () => {
    expect(demoLimitSentence('writes', { limit: 500 })).toContain('each visit can make 500 changes.');
    expect(demoLimitSentence('writes', { limit: 1500 })).toContain('make 1,500 changes');
    expect(demoLimitSentence('writes')).toContain('each visit can only make a limited number of changes.');
    expect(demoLimitSentence('nope')).toContain('only make a few changes like this');
  });
});

describe('links into the demo', () => {
  it('builds the one demo link shape', () => {
    expect(demoEntryHref('https://desk.example', 'agent')).toBe('https://desk.example/demo?persona=agent&demo=1');
    expect(demoEntryHref('https://desk.example/', 'agent', '/resume')).toBe(
      'https://desk.example/demo?persona=agent&demo=1&redirectTo=%2Fresume',
    );
    expect(demoEntryHref('https://desk.example', 'agent', '/tickets/INC-4101?tab=sla&x=1')).toBe(
      'https://desk.example/demo?persona=agent&demo=1&redirectTo=%2Ftickets%2FINC-4101%3Ftab%3Dsla%26x%3D1',
    );
  });

  it('marks a demo sign-in-again link, and keeps it on this origin', () => {
    expect(signInAgainHref('/overview')).toBe('/api/session/login?redirectTo=%2Foverview');
    expect(signInAgainHref('/overview', { demo: true })).toBe('/api/session/login?redirectTo=%2Foverview&demo=1');
    expect(signInAgainHref('https://evil.example/x')).toBe('/api/session/login?redirectTo=%2F');
    expect(signInAgainHref('//evil.example')).toBe('/api/session/login?redirectTo=%2F');
    expect(signInAgainHref('/\\evil.example')).toBe('/api/session/login?redirectTo=%2F');
  });

  it('names the browser storage keys', () => {
    expect(DEMO_LOCAL_KEYS).toEqual({ lastGeneration: 'itsm-demo:last-gen', noticeSeen: 'itsm-demo:notice-seen' });
  });
});

describe('the story and the build', () => {
  it('routes the listed heroes through the Service Desk', () => {
    expect(DEMO_SD_HEROES).toEqual(['H1', 'H2', 'H3', 'H4', 'H5', 'H8', 'H9', 'H10', 'H11', 'H12', 'A1', 'A2', 'A3', 'A4', 'E1', 'E3', 'E4']);
    expect(demoHeroRef('H1')).toBe('demo:hero:H1');
    expect(isDemoHeroRef('demo:hero:H1')).toBe(true);
    expect(isDemoHeroRef('demo:hero:')).toBe(false);
    expect(isDemoHeroRef('INC-4101')).toBe(false);
    expect(isDemoHeroRef(null)).toBe(false);
  });

  it('marks build rows so visitors see only their own changes', () => {
    expect(DEMO_BUILD_REASON).toBe('demo.build');
    expect(DEMO_BUILD_ACTOR).toEqual({ type: 'system', id: 'demo-build' });
  });

  it('lists eleven build steps in order', () => {
    expect(DEMO_BUILD_STEPS).toEqual([
      'prepare',
      'company',
      'people',
      'catalogue',
      'tickets',
      'service-levels',
      'history',
      'reports',
      'search',
      'checks',
      'switching',
    ]);
  });

  it('names the problem codes', () => {
    expect(Object.values(DEMO_PROBLEM_CODES).sort()).toEqual([
      'demo_disabled',
      'demo_limit',
      'demo_reset',
      'demo_session_ended',
      'demo_unavailable',
    ]);
  });
});

describe('copy', () => {
  it('words a build estimate, rounded up, and falls back without one', () => {
    expect(demoEtaPhrase(210)).toBe('about 4 minutes');
    expect(demoEtaPhrase(180)).toBe('about 3 minutes');
    expect(demoEtaPhrase(181)).toBe('about 4 minutes');
    expect(demoEtaPhrase(45)).toBe('about 1 minute');
    expect(demoEtaPhrase(60)).toBe('about 1 minute');
    expect(demoEtaPhrase(null)).toBe('a few minutes');
    expect(demoEtaPhrase(undefined)).toBe('a few minutes');
    expect(demoEtaPhrase(0)).toBe('a few minutes');
    expect(demoEtaPhrase(Number.NaN)).toBe('a few minutes');
    expect(DEMO_COPY.resettingNow(210)).toBe('Resetting now… about 4 minutes');
    expect(DEMO_COPY.resettingNow(null)).toBe('Resetting now… a few minutes');
    expect(DEMO_COPY.resetStarted(120)).toBe('Resetting the demo data. This takes about 2 minutes; you can keep exploring.');
  });

  it('words the reset notices by reason', () => {
    expect(demoResetNotice('fresh', 'scheduled')).toBe("Demo data was reset at 00:00 UK time. You're looking at the fresh data.");
    expect(demoResetNotice('stale', 'manual')).toBe('Demo data was reset by a visitor. Reload to see the fresh data.');
    expect(demoResetNotice('fresh', 'catch-up')).toContain('reset overnight.');
    expect(demoResetNotice('stale', 'operator')).toContain('reset by the operator.');
    expect(demoResetNotice('fresh', 'initial')).toBe('The demo has been prepared.');
  });

  it('keeps the shared sentences in the canonical wording', () => {
    expect(DEMO_COPY.resetsDaily).toBe('Demo data resets every day at 00:00 UK time.');
    expect(DEMO_COPY.fictional).toBe('Northwind Traders (UK) and its people are fictional.');
    expect(DEMO_COPY.sample).toBe('Sample');
    expect(DEMO_COPY.sampleData).toBe('Sample data');
    expect(DEMO_COPY.unavailable).toBe('The demo is paused or being prepared. It will be back in a few minutes.');
    expect(DEMO_COPY.resetCooldown(12, 18)).toBe(
      'The demo was reset 12 min ago. To keep fresh data safe for presenters, it can be reset again in 18 min.',
    );
  });

  it('writes British English without American spellings', () => {
    const text = JSON.stringify([
      DEMO_COPY,
      DEMO_FEATURES.map((feature) => demoDisabledSentence(feature)),
      DEMO_CAP_CATEGORIES.map((category) => demoLimitSentence(category)),
    ]);
    expect(text).not.toMatch(/\b(organization|color|canceled|license|analyze|behavior|center)\b/i);
  });
});
