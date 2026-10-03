import { loadConfig, type PlatformConfig } from '@itsm/platform';

/**
 * The generator's configuration (A4 §3.11), read from the platform's validated
 * configuration so a bad value stops the worker at boot rather than half-way
 * through a build. Nothing here is a secret, and every value but `DEMO_MODE`
 * is a code default: a deployment that never heard of the demo runs as before.
 */

/**
 * Recorded on every generation in the ledger and in `settings.demo`. Bump it
 * whenever the planner's output changes for the same (seed, T0, scale), so a
 * plan hash is only ever compared with one made by the same rules (W8).
 */
export const DEMO_GENERATOR_VERSION = '3.0.0';

export interface DemoConfig {
  /** `on` builds and serves the demo; `off` leaves every demo job idle. */
  readonly mode: 'on' | 'off';
  /** The live generation's slug; the swap moves it, the purge never touches it. */
  readonly tenantSlug: string;
  /** The operator's own tenant, which a demo slug may never equal. */
  readonly bootstrapSlug: string | null;
  readonly seed: number;
  /** 0.1–1: tickets and their history scale with it; people and configuration do not. */
  readonly scale: number;
  /** 60–150 days of history behind T0 (D17). */
  readonly historyDays: number;
  /** A build that runs longer is abandoned; also the reset lock's lifetime. */
  readonly buildTimeoutSeconds: number;
  /** The cooldown written at every swap (D12, D28). */
  readonly cooldownSeconds: number;
  /** Batches replayed and reprojected at once (R3). */
  readonly parallelism: number;
  readonly generatorVersion: string;
}

/** The demo's slice of a platform configuration. Pure, for tests. */
export function demoConfigFrom(config: PlatformConfig): DemoConfig {
  return Object.freeze({
    mode: config.DEMO_MODE,
    tenantSlug: config.DEMO_TENANT_SLUG,
    bootstrapSlug: config.BOOTSTRAP_TENANT_SLUG ?? null,
    seed: config.DEMO_SEED,
    scale: config.DEMO_SCALE,
    historyDays: config.DEMO_HISTORY_DAYS,
    buildTimeoutSeconds: config.DEMO_BUILD_TIMEOUT_SECONDS,
    cooldownSeconds: config.DEMO_RESET_COOLDOWN_SECONDS,
    parallelism: config.DEMO_BUILD_PARALLELISM,
    generatorVersion: DEMO_GENERATOR_VERSION,
  });
}

/** The running process's demo configuration. */
export function demoConfig(): DemoConfig {
  return demoConfigFrom(loadConfig());
}
