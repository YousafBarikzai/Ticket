import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          // `.tsx` as well as `.ts`: a component test that can write JSX reads
          // like the thing it is testing, where one that calls `createElement`
          // reads like a puzzle.
          include: [
            'packages/*/src/**/__tests__/**/*.test.ts?(x)',
            'modules/*/src/**/__tests__/**/*.test.ts?(x)',
            // Applications too: the BFF's rules — what the proxy forwards, what
            // a `__Host-` cookie may carry, where a sign-in is allowed to land
            // — are pure functions, and leaving them out of the unit project
            // would mean the only tested part of an app was the part that
            // happened to live in a package.
            'apps/*/src/**/__tests__/**/*.test.ts?(x)',
          ],
          environment: 'node',
        },
        // The automatic JSX runtime, spelled out rather than inherited: each
        // workspace has its own tsconfig, and `apps/workbench` sets
        // `jsx: preserve` because Next compiles its own JSX. Without this, a
        // component test in that app transforms to `React.createElement` and
        // fails with `React is not defined`.
        esbuild: { jsx: 'automatic' },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts', 'tests/isolation/**/*.test.ts', 'tests/permissions/**/*.test.ts'],
          environment: 'node',
          globalSetup: ['tests/support/global-setup.ts'],
          hookTimeout: 60_000,
          testTimeout: 60_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
