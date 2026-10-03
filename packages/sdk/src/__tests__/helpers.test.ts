import { describe, expect, it } from 'vitest';
import { attainmentTarget, honoured, permissionScope } from '../helpers.js';
import type { Me } from '../resources/types.js';

/**
 * The three questions pages ask of what the API answered.
 *
 * Each has a wrong answer that looks right. A page that guessed an agent's
 * analytics from their role would draw cards that 403; one that typed "90"
 * would disagree with the tenant's own target the day it was changed; one
 * that trusted a count from an API that dropped its filter would show a
 * figure for everything as if it were the breached ones.
 */

type Grants = Pick<Me, 'permissions'>;

const grants = (...pairs: [key: string, scope: string | null][]): Grants => ({
  permissions: pairs.map(([key, scope]) => ({ key, scope })),
});

describe('permissionScope', () => {
  it('is null for a permission the person does not hold — an agent and analytics (D9)', () => {
    const agent = grants(['ticket.read', 'team'], ['ticket.update', 'team'], ['incident.major.read', 'any']);
    expect(permissionScope(agent, 'analytics.read')).toBeNull();
  });

  it('answers the scope the person holds it at', () => {
    const lead = grants(['analytics.read', 'team'], ['ticket.read', 'team']);
    expect(permissionScope(lead, 'analytics.read')).toBe('team');
    expect(permissionScope(grants(['ticket.read', 'own']), 'ticket.read')).toBe('own');
  });

  it('picks the widest scope when a key appears more than once', () => {
    // `/me` sends one row per key today, but the widest grant is the one
    // that decides, whatever order or number of rows the list arrives in.
    expect(permissionScope(grants(['analytics.read', 'team'], ['analytics.read', 'any'], ['analytics.read', 'own']), 'analytics.read')).toBe('any');
    expect(permissionScope(grants(['ticket.read', 'own'], ['ticket.read', 'team']), 'ticket.read')).toBe('team');
  });

  it('ignores a scope it does not know rather than guessing what it grants', () => {
    expect(permissionScope(grants(['analytics.read', null]), 'analytics.read')).toBeNull();
    expect(permissionScope(grants(['analytics.read', 'galaxy']), 'analytics.read')).toBeNull();
    expect(permissionScope(grants(['analytics.read', 'galaxy'], ['analytics.read', 'team']), 'analytics.read')).toBe('team');
  });

  it('matches the whole key, never a prefix', () => {
    expect(permissionScope(grants(['analytics.read.all', 'any']), 'analytics.read')).toBeNull();
  });

  it('is null with nobody to ask about', () => {
    expect(permissionScope(null, 'analytics.read')).toBeNull();
    expect(permissionScope(undefined, 'analytics.read')).toBeNull();
    expect(permissionScope(grants(), 'analytics.read')).toBeNull();
  });
});

describe('attainmentTarget', () => {
  it('reads the target the tenant set', () => {
    expect(attainmentTarget({ target: { value: 95, unit: 'percent', source: 'setting' } })).toEqual({ fraction: 0.95, percent: 95, source: 'setting' });
  });

  it('reads the platform default as the API reported it', () => {
    expect(attainmentTarget({ target: { value: 90, unit: 'percent', source: 'default' } })).toEqual({ fraction: 0.9, percent: 90, source: 'default' });
  });

  it('uses the value it was sent, not 90, whenever there is one', () => {
    expect(attainmentTarget({ target: { value: 50, unit: 'percent', source: 'setting' } }).percent).toBe(50);
    expect(attainmentTarget({ target: { value: 100, unit: 'percent', source: 'setting' } }).fraction).toBe(1);
  });

  it('falls back to 90 % only when the answer carries no target', () => {
    const fallback = { fraction: 0.9, percent: 90, source: 'fallback' };
    expect(attainmentTarget({})).toEqual(fallback);
    expect(attainmentTarget({ target: undefined })).toEqual(fallback);
    expect(attainmentTarget(null)).toEqual(fallback);
    expect(attainmentTarget()).toEqual(fallback);
  });

  it('treats a target with no usable number as no target', () => {
    const broken = { target: { value: Number.NaN, unit: 'percent', source: 'setting' } } as const;
    expect(attainmentTarget(broken)).toEqual({ fraction: 0.9, percent: 90, source: 'fallback' });
  });
});

describe('honoured', () => {
  it('is true when every key asked for was applied', () => {
    expect(honoured({ applied: ['dueBefore', 'sla', 'statusCategory'] }, ['sla', 'dueBefore'])).toBe(true);
  });

  it('is false when the server left one out', () => {
    expect(honoured({ applied: ['statusCategory'] }, ['statusCategory', 'sla'])).toBe(false);
  });

  it('is false when `applied` is missing, because only an older API leaves it out', () => {
    expect(honoured({}, ['sla'])).toBe(false);
    expect(honoured({ count: 412, capped: false } as { applied?: string[] }, ['sla'])).toBe(false);
    expect(honoured(null, ['sla'])).toBe(false);
  });

  it('is true when nothing was asked that could have been dropped', () => {
    expect(honoured({}, [])).toBe(true);
    expect(honoured({ applied: [] }, [])).toBe(true);
  });
});
