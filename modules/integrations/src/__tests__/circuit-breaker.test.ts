import { describe, expect, it } from 'vitest';
import { CircuitBreakers, CircuitOpenError } from '../gateway/circuit-breaker.js';

describe('the circuit breaker', () => {
  const options = { threshold: 3, cooldownMs: 1000 };

  it('stays closed while calls succeed', () => {
    const breakers = new CircuitBreakers(options);
    for (let i = 0; i < 10; i += 1) {
      breakers.assertClosed('t1', 'jira');
      breakers.recordSuccess('t1', 'jira');
    }
    expect(breakers.state('t1', 'jira')).toBe('closed');
  });

  it('opens after consecutive failures, and says how long for', () => {
    const breakers = new CircuitBreakers(options);
    for (let i = 0; i < 3; i += 1) breakers.recordFailure('t1', 'jira', 1000);

    expect(breakers.state('t1', 'jira', 1000)).toBe('open');
    try {
      breakers.assertClosed('t1', 'jira', 1000);
      expect.unreachable('should have refused');
    } catch (error) {
      expect(error).toBeInstanceOf(CircuitOpenError);
      expect((error as CircuitOpenError).retryAfterMs).toBe(1000);
    }
  });

  it('forgets failures once a call succeeds', () => {
    // Consecutive, not cumulative: an endpoint that fails one call in fifty is
    // not broken, and pausing it would be worse than the failures.
    const breakers = new CircuitBreakers(options);
    breakers.recordFailure('t1', 'jira');
    breakers.recordFailure('t1', 'jira');
    breakers.recordSuccess('t1', 'jira');
    breakers.recordFailure('t1', 'jira');
    breakers.recordFailure('t1', 'jira');
    expect(breakers.state('t1', 'jira')).toBe('closed');
  });

  it("never opens one tenant's circuit because of another's", () => {
    // The failure that turns one customer's outage into everybody's. Two
    // tenants using the same connector kind are talking to different systems.
    const breakers = new CircuitBreakers(options);
    for (let i = 0; i < 5; i += 1) breakers.recordFailure('t1', 'jira');

    expect(breakers.state('t1', 'jira')).toBe('open');
    expect(breakers.state('t2', 'jira')).toBe('closed');
    expect(() => breakers.assertClosed('t2', 'jira')).not.toThrow();
  });

  it('lets exactly one call through when it goes half-open', () => {
    // A hundred workers all probing a recovering endpoint at once is how a
    // service that was coming back goes down again.
    const breakers = new CircuitBreakers(options);
    for (let i = 0; i < 3; i += 1) breakers.recordFailure('t1', 'jira', 0);

    expect(breakers.state('t1', 'jira', 1500)).toBe('half-open');
    expect(() => breakers.assertClosed('t1', 'jira', 1500)).not.toThrow();
    expect(() => breakers.assertClosed('t1', 'jira', 1500)).toThrow(CircuitOpenError);
  });

  it('closes again when the probe succeeds', () => {
    const breakers = new CircuitBreakers(options);
    for (let i = 0; i < 3; i += 1) breakers.recordFailure('t1', 'jira', 0);
    breakers.assertClosed('t1', 'jira', 1500);
    breakers.recordSuccess('t1', 'jira');
    expect(breakers.state('t1', 'jira', 1500)).toBe('closed');
  });

  it('re-opens when the probe fails, rather than letting the flood through', () => {
    const breakers = new CircuitBreakers(options);
    for (let i = 0; i < 3; i += 1) breakers.recordFailure('t1', 'jira', 0);
    breakers.assertClosed('t1', 'jira', 1500);
    breakers.recordFailure('t1', 'jira', 1500);
    expect(breakers.state('t1', 'jira', 1500)).toBe('open');
  });

  it('lists what is paused, for the admin console', () => {
    const breakers = new CircuitBreakers(options);
    for (let i = 0; i < 3; i += 1) breakers.recordFailure('t1', 'jira', 1000);
    expect(breakers.open(1200)).toEqual([{ tenantId: 't1', connector: 'jira', retryAfterMs: 800 }]);
  });
});
