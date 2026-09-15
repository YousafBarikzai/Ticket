/**
 * A circuit breaker per (tenant, connector).
 *
 * Per tenant *and* connector rather than per connector, because one customer's
 * broken endpoint must not open the breaker on another customer's working one —
 * they are different systems that happen to share a connector kind. Getting
 * this wrong turns one tenant's outage into everybody's.
 *
 * The purpose is not to be clever about failure. It is to stop a dead endpoint
 * consuming the worker pool: without a breaker, a connector that takes thirty
 * seconds to time out and is called on every ticket will occupy every worker,
 * and the symptom nobody connects to the cause is that SLA timers stop firing.
 */

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface BreakerOptions {
  /** Consecutive failures before the circuit opens. */
  threshold: number;
  /** How long it stays open before one call is allowed through. */
  cooldownMs: number;
}

interface Circuit {
  failures: number;
  openedAt: number | null;
  /** Set while a half-open probe is in flight, so only one call gets through. */
  probing: boolean;
}

const DEFAULTS: BreakerOptions = { threshold: 5, cooldownMs: 30_000 };

export class CircuitOpenError extends Error {
  constructor(readonly key: string, readonly retryAfterMs: number) {
    super(`this connector is failing and calls to it are paused for ${Math.ceil(retryAfterMs / 1000)}s`);
  }
}

export class CircuitBreakers {
  private readonly circuits = new Map<string, Circuit>();

  constructor(private readonly options: BreakerOptions = DEFAULTS) {}

  private keyFor(tenantId: string, connector: string): string {
    return `${tenantId}:${connector}`;
  }

  private circuit(key: string): Circuit {
    let circuit = this.circuits.get(key);
    if (!circuit) {
      circuit = { failures: 0, openedAt: null, probing: false };
      this.circuits.set(key, circuit);
    }
    return circuit;
  }

  state(tenantId: string, connector: string, now = Date.now()): CircuitState {
    const circuit = this.circuit(this.keyFor(tenantId, connector));
    if (circuit.openedAt === null) return 'closed';
    return now - circuit.openedAt >= this.options.cooldownMs ? 'half-open' : 'open';
  }

  /**
   * Throws if the call must not be made.
   *
   * Half-open lets exactly one call through: a hundred workers all probing a
   * recovering endpoint at once is how a service that was coming back goes down
   * again.
   */
  assertClosed(tenantId: string, connector: string, now = Date.now()): void {
    const key = this.keyFor(tenantId, connector);
    const circuit = this.circuit(key);
    const state = this.state(tenantId, connector, now);

    if (state === 'closed') return;
    if (state === 'open') {
      throw new CircuitOpenError(key, this.options.cooldownMs - (now - circuit.openedAt!));
    }

    if (circuit.probing) throw new CircuitOpenError(key, 1000);
    circuit.probing = true;
  }

  recordSuccess(tenantId: string, connector: string): void {
    const circuit = this.circuit(this.keyFor(tenantId, connector));
    circuit.failures = 0;
    circuit.openedAt = null;
    circuit.probing = false;
  }

  recordFailure(tenantId: string, connector: string, now = Date.now()): void {
    const circuit = this.circuit(this.keyFor(tenantId, connector));
    circuit.probing = false;
    circuit.failures += 1;
    if (circuit.failures >= this.options.threshold) circuit.openedAt = now;
  }

  /** Test and operator helper: forget everything, as a restart would. */
  reset(): void {
    this.circuits.clear();
  }

  /** What the admin console shows: which connectors are currently paused. */
  open(now = Date.now()): { tenantId: string; connector: string; retryAfterMs: number }[] {
    const out: { tenantId: string; connector: string; retryAfterMs: number }[] = [];
    for (const [key, circuit] of this.circuits) {
      if (circuit.openedAt === null) continue;
      const elapsed = now - circuit.openedAt;
      if (elapsed >= this.options.cooldownMs) continue;
      const [tenantId, connector] = key.split(':');
      out.push({ tenantId: tenantId!, connector: connector!, retryAfterMs: this.options.cooldownMs - elapsed });
    }
    return out;
  }
}

export const breakers = new CircuitBreakers();
