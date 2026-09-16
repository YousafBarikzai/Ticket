import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The session denylist — the thing that makes revocation take effect.
 *
 * Redis is mocked rather than run, because what is being tested is not that
 * `SET` works. It is the two decisions that only show themselves when Redis
 * misbehaves: that an unreachable denylist fails the revocation loudly instead
 * of reporting a success that did not happen, and that a partial failure
 * across several sessions is a failure rather than "four of your five".
 */

const set = vi.fn();
const get = vi.fn();
const pipelineSet = vi.fn();
const exec = vi.fn();

vi.mock('@itsm/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itsm/platform')>();
  return {
    ...actual,
    cache: () => ({
      set,
      get,
      pipeline: () => ({ set: pipelineSet, exec }),
    }),
    metrics: { increment: vi.fn(), observe: vi.fn(), gauge: vi.fn() },
    logger: { ...actual.logger, error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  };
});

const { denySession, denySessions, denyTtlSeconds, isDenied, RevocationUnavailable } = await import(
  '../service/session-denylist.js'
);

beforeEach(() => {
  set.mockReset().mockResolvedValue('OK');
  get.mockReset().mockResolvedValue(null);
  pipelineSet.mockReset();
  exec.mockReset().mockResolvedValue([[null, 'OK']]);
});

describe('how long a denial is kept', () => {
  const now = new Date('2026-01-01T12:00:00.000Z');

  it('outlives the session by an hour, for clock skew between us and the provider', () => {
    const expiresAt = new Date('2026-01-01T13:00:00.000Z');
    expect(denyTtlSeconds(expiresAt, now)).toBe(3600 + 3600);
  });

  it('still denies a session that has already expired', () => {
    // The `exp` in the token and the expiry on the row are not always the same
    // number, and the gap is exactly where a revoked token would slip through.
    const expiresAt = new Date('2025-01-01T00:00:00.000Z');
    expect(denyTtlSeconds(expiresAt, now)).toBe(60);
  });
});

describe('denying one session', () => {
  it('writes the key the token verifier actually reads', async () => {
    await denySession('sid-1', new Date(Date.now() + 600_000));
    expect(set).toHaveBeenCalledTimes(1);
    expect(set.mock.calls[0]![0]).toBe('sess:deny:sid-1');
    expect(set.mock.calls[0]![1]).toBe('1');
    expect(set.mock.calls[0]![2]).toBe('EX');
  });

  it('throws when Redis is unreachable, rather than reporting a revocation that did not happen', async () => {
    set.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(denySession('sid-1', new Date())).rejects.toBeInstanceOf(RevocationUnavailable);
  });
});

describe('denying several at once', () => {
  it('pipelines one write per session', async () => {
    exec.mockResolvedValue([
      [null, 'OK'],
      [null, 'OK'],
    ]);
    await denySessions([
      { sid: 'a', expiresAt: new Date(Date.now() + 600_000) },
      { sid: 'b', expiresAt: new Date(Date.now() + 600_000) },
    ]);
    expect(pipelineSet).toHaveBeenCalledTimes(2);
    expect(pipelineSet.mock.calls.map((call) => call[0])).toEqual(['sess:deny:a', 'sess:deny:b']);
  });

  it('does nothing at all for an empty list', async () => {
    await denySessions([]);
    expect(pipelineSet).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
  });

  it('fails the whole call when one write failed', async () => {
    // "We revoked four of your five sessions" is not an outcome an
    // administrator can act on, and it reads as a success.
    exec.mockResolvedValue([
      [null, 'OK'],
      [new Error('OOM'), null],
    ]);
    await expect(
      denySessions([
        { sid: 'a', expiresAt: new Date() },
        { sid: 'b', expiresAt: new Date() },
      ]),
    ).rejects.toBeInstanceOf(RevocationUnavailable);
  });
});

describe('reading the list back', () => {
  it('is false for a session nobody denied', async () => {
    await expect(isDenied('sid-1')).resolves.toBe(false);
  });

  it('is true once the key is there', async () => {
    get.mockResolvedValue('1');
    await expect(isDenied('sid-1')).resolves.toBe(true);
  });
});
