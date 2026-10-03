import { describe, expect, it } from 'vitest';
import { DEMO_FEATURES, demoDisabledSentence } from '@itsm/contracts/demo';
import { buildAreaModel, crossAreaTicketHref } from '@itsm/contracts/areas';
import type { Me } from '@itsm/sdk';
import { agentTeamIds, demoDisabled, demoLock, employeeUserId, isDemo } from '../server/demo.js';

/**
 * The Help Portal's one reader of `me.demo` (WP-38; A6 §3.2 rule 7, SPEC
 * §7.0.2). A real account never carries `demo` and gets the full product; a
 * demo session's controls lock with the contract's sentence, never hide; and
 * the personas and Alex Morgan's teams come only from what the API sent.
 */

const visitor: Pick<Me, 'demo'> = {
  demo: {
    persona: 'employee',
    area: 'portal',
    generation: 3,
    company: 'Northwind Traders (UK)',
    disabledFeatures: ['uploads', 'notifications', 'sessions'],
    personaUserIds: { employee: 'u-emma', agent: 'u-alex', admin: 'u-jordan' },
    agentTeamIds: ['t-service-desk'],
  },
};

describe('a real account', () => {
  it('is not a demo, has nothing locked and names no persona', () => {
    for (const me of [{}, { demo: undefined }, null, undefined]) {
      expect(isDemo(me)).toBe(false);
      for (const feature of DEMO_FEATURES) {
        expect(demoDisabled(me, feature)).toBeNull();
        expect(demoLock(me, feature)).toEqual({});
      }
      expect(employeeUserId(me)).toBeNull();
      expect(agentTeamIds(me)).toEqual([]);
    }
  });
});

describe('a demo session', () => {
  it('is a demo', () => {
    expect(isDemo(visitor)).toBe(true);
  });

  it('locks exactly the features the API turned off, each with its own sentence and a lock', () => {
    expect(demoDisabled(visitor, 'uploads')).toBe('This is a shared demo, so uploading files is turned off. Everything else works as in the full product.');
    expect(demoLock(visitor, 'sessions')).toEqual({ disabledReason: demoDisabledSentence('sessions'), disabledIcon: 'lock' });
    const locked = DEMO_FEATURES.filter((feature) => demoDisabled(visitor, feature) !== null);
    expect(locked).toEqual(['sessions', 'uploads', 'notifications']);
  });

  it('ignores a feature this build does not know: only the API can refuse it', () => {
    const newer = { demo: { ...visitor.demo!, disabledFeatures: ['time-travel'] } };
    expect(DEMO_FEATURES.some((feature) => demoDisabled(newer, feature) !== null)).toBe(false);
  });

  it("names Emma Clarke's user id, and Alex Morgan's teams", () => {
    expect(employeeUserId(visitor)).toBe('u-emma');
    expect(agentTeamIds(visitor)).toEqual(['t-service-desk']);
  });

  it('trusts no malformed persona id or team id', () => {
    const odd = {
      demo: { ...visitor.demo!, personaUserIds: { employee: '', agent: 'u-alex', admin: 'u-jordan' }, agentTeamIds: [null, 't-1', ''] as unknown as string[] },
    };
    expect(employeeUserId(odd)).toBeNull();
    expect(agentTeamIds(odd)).toEqual(['t-1']);
    const missing = { demo: { ...visitor.demo!, agentTeamIds: undefined as unknown as string[], disabledFeatures: undefined as unknown as string[] } };
    expect(agentTeamIds(missing)).toEqual([]);
    expect(demoDisabled(missing, 'uploads')).toBeNull();
  });

  it("feeds the area model's team check: 'Open in Service Desk' only for Alex Morgan's teams (X-B2)", () => {
    const model = buildAreaModel({
      app: 'portal',
      held: [],
      session: { kind: 'demo', persona: 'employee' },
      origins: { portal: 'https://help.example', workbench: 'https://desk.example', admin: 'https://admin.example' },
      agentTeamIds: agentTeamIds(visitor),
    });
    expect(crossAreaTicketHref(model, { number: 'REQ-000123', groupId: 't-service-desk' })).toContain('/demo?');
    expect(crossAreaTicketHref(model, { number: 'REQ-000124', groupId: 't-facilities' })).toBeNull();
  });
});
