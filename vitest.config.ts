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
          include: ['packages/*/src/**/__tests__/**/*.test.ts?(x)', 'modules/*/src/**/__tests__/**/*.test.ts?(x)'],
          environment: 'node',
        },
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
