import { registerModule, type ModuleManifest } from '@itsm/platform';
import type { DemoResetReason } from '@itsm/contracts/demo';

/**
 * MOD-25 The shared demo (SPEC v3 §5.2, A4 §2.2).
 *
 * The machinery that builds Northwind Traders (UK) beside the live demo every
 * night, checks it and swaps it in. It belongs to the deployment, not to any
 * tenant: `audience: 'platform'` keeps it out of every customer's module list
 * and settings (A4 §2.3), so nobody is shown a switch for our operations.
 *
 * It declares no permissions, routes, events or settings. Everything it writes
 * goes through the owning modules' public services as the system actor
 * `demo-build` (W1), so it needs nothing of its own to grant; and visitors
 * reach it only through the reset route in `apps/api`, which enqueues a job.
 *
 * The three jobs run on queue `demo` in the `data` family at concurrency 1
 * (R3). `demo.reset.check` is the minute tick that decides whether a build is
 * due; it never builds itself, it only enqueues.
 */

/** The job names, in one place for the manifest, the handlers and the API's reset route. */
export const DEMO_JOB_NAMES = Object.freeze({
  check: 'demo.reset.check',
  reset: 'demo.reset',
  purge: 'demo.purge',
} as const);

/** `demo.reset`'s payload (A4 §3.8). `requestedGeneration` is the live one a visitor saw. */
export interface DemoResetJobPayload {
  readonly reason: DemoResetReason;
  readonly requestedGeneration?: number;
}

/** `demo.purge`'s payload: the retired or half-built tenant to remove. */
export interface DemoPurgeJobPayload {
  readonly tenantId: string;
}

export const demoManifest: ModuleManifest = registerModule({
  id: 'MOD-25',
  key: 'demo',
  name: 'Shared demo',
  version: '1.0.0',
  phase: 'v3',
  // What the build writes through. Informational for a platform module: no
  // tenant enables or disables it, so no "required by" check reads this.
  dependsOn: ['MOD-21', 'MOD-01', 'MOD-04', 'MOD-07', 'MOD-12', 'MOD-09'],
  permissions: [],
  events: { publishes: [], consumes: [] },
  featureFlags: [],
  settings: [],
  jobs: [
    {
      name: DEMO_JOB_NAMES.check,
      queue: 'demo',
      // Every minute, against the Europe/London date key rather than a cron
      // time zone: that catches midnight on the 23- and 25-hour days and a
      // worker that was down at midnight (A4 §3.8).
      schedule: '* * * * *',
      description: 'Decide whether the shared demo needs a build, repair its live record and personas, and sweep old generations.',
    },
    {
      name: DEMO_JOB_NAMES.reset,
      queue: 'demo',
      description: 'Build a new demo generation beside the live one, check it and swap it in.',
    },
    {
      name: DEMO_JOB_NAMES.purge,
      queue: 'demo',
      description: 'Remove a retired or half-built demo generation, keeping its audit rows.',
    },
  ],
  enabledByDefault: false,
  optional: false,
  audience: 'platform',
});
