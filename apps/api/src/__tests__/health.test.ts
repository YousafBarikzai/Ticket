import { describe, expect, it } from 'vitest';
import { failureDetail } from '../app.js';

/**
 * `/health/ready` answered `redis: failed` for an evening while every part of
 * the connection — host, port, user, password — was correct. The API knew
 * which of them was wrong and discarded it, so the fault could only be guessed
 * at from outside. These tests are about the two things that has to satisfy at
 * once: say enough to identify the fault, and say nothing that is a secret.
 */

describe('what a failed dependency reports', () => {
  it('names the fault, so a resolver problem is not read as a bad password', () => {
    expect(failureDetail(new Error('getaddrinfo ENOTFOUND redis.railway.internal'))).toBe(
      'failed: getaddrinfo ENOTFOUND redis.railway.internal',
    );
    expect(failureDetail(new Error('WRONGPASS invalid username-password pair or user is disabled.'))).toContain('WRONGPASS');
    expect(failureDetail(new Error('connect ECONNREFUSED ::1:6379'))).toContain('ECONNREFUSED');
  });

  it('takes the credentials out, because this endpoint is unauthenticated', () => {
    // ioredis and Prisma both quote the URL they were given, and Railway's
    // health check is not the only thing that can call /health/ready.
    const detail = failureDetail(new Error('connect ECONNREFUSED redis://default:hunter2@redis.railway.internal:6379'));
    expect(detail).not.toContain('hunter2');
    expect(detail).toContain('redis://***@redis.railway.internal:6379');

    const prisma = failureDetail(new Error('P1001: Can\'t reach database server at postgresql://app_owner:s3cret@postgres.railway.internal:5432/railway'));
    expect(prisma).not.toContain('s3cret');
    expect(prisma).toContain('postgresql://***@postgres.railway.internal');
  });

  it('keeps it to one bounded line, since this is a polled JSON body', () => {
    const detail = failureDetail(new Error('first line\nsecond line\n  at somewhere (file.ts:1:1)'));
    expect(detail).toBe('failed: first line');
    expect(failureDetail(new Error('x'.repeat(500))).length).toBeLessThanOrEqual('failed: '.length + 200);
  });

  it('still says failed when the error says nothing', () => {
    // A thrown string, a thrown object, an Error with an empty message: the
    // check must not answer `ok` by accident, and must not answer `failed: `.
    expect(failureDetail(new Error(''))).toBe('failed');
    expect(failureDetail('   ')).toBe('failed');
    expect(failureDetail({ nope: true })).toBe('failed: [object Object]');
  });
});
