import { afterEach, describe, expect, it } from 'vitest';
import { assertWithinLimit, clearLimitChecker, registerLimitChecker } from '../limits.js';
import { LimitReachedError } from '../errors.js';
import { createContext } from '../context.js';
import { buildPermissionSet } from '../authz.js';

/**
 * The socket a module plugs a plan into. Three behaviours, and the last two
 * are the ones that matter at three in the morning.
 */

const ctx = createContext({ tenantId: '11111111-1111-4111-8111-111111111111', actor: { type: 'system', id: null }, permissions: buildPermissionSet([]) });

afterEach(() => clearLimitChecker());

describe('checking a limit', () => {
  it('does nothing at all when nothing is registered', async () => {
    // A unit test, or a deployment that sells nothing: every check passes.
    await expect(assertWithinLimit(ctx, 'tickets')).resolves.toBeUndefined();
  });

  it('lets ok and warned through, and refuses blocked with the message', async () => {
    registerLimitChecker(async (_ctx, meter) => (meter === 'tickets' ? { state: 'blocked', message: 'the trial plan stops at 500' } : { state: 'warned' }));
    await expect(assertWithinLimit(ctx, 'agents')).resolves.toBeUndefined();
    await expect(assertWithinLimit(ctx, 'tickets')).rejects.toThrow(LimitReachedError);
    await expect(assertWithinLimit(ctx, 'tickets')).rejects.toThrow(/trial plan stops at 500/);
  });

  it('answers 402, not 403: the caller is permitted and the obstacle is commercial', async () => {
    registerLimitChecker(async () => ({ state: 'blocked' }));
    const error = await assertWithinLimit(ctx, 'agents').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LimitReachedError);
    expect((error as LimitReachedError).status).toBe(402);
    expect((error as LimitReachedError).meter).toBe('agents');
  });

  it('fails open when the checker itself fails', async () => {
    // A limit is a commercial control, not a security one. Refusing every
    // ticket in the company because Redis restarted is the worse outcome.
    registerLimitChecker(async () => {
      throw new Error('redis is unreachable');
    });
    await expect(assertWithinLimit(ctx, 'tickets')).resolves.toBeUndefined();
  });
});
