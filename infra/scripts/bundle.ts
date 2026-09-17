import { build } from 'esbuild';
import { readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Bundles each deployable into one JavaScript file.
 *
 * The production image used to run TypeScript directly through `tsx`, which
 * meant shipping the whole build toolchain — including esbuild's Go binary, and
 * whatever CVEs the Go release it was compiled with happens to carry. A
 * transpiler in a production image is a supply-chain surface for no benefit:
 * nothing in production ever needs to compile anything.
 *
 * Workspace code is bundled in; everything from node_modules stays external and
 * is installed as an ordinary production dependency. Bundling third-party
 * packages would break Prisma, which loads a native engine at run time, and
 * would make a dependency's licence and provenance harder to see, not easier.
 */

const root = resolve(import.meta.dirname, '..', '..');

/** Bundle `@itsm/*` sources; leave every other package to node_modules. */
const workspaceOnly = {
  name: 'workspace-only',
  setup(build: { onResolve: (options: { filter: RegExp }, callback: (args: { path: string }) => unknown) => void }) {
    build.onResolve({ filter: /^[^.\/]|^@/ }, (args: { path: string }) => {
      if (args.path.startsWith('@itsm/')) return null;
      return { path: args.path, external: true };
    });
  },
};

const targets = [
  { entry: 'apps/api/src/main.ts', out: 'dist/api.js' },
  { entry: 'apps/worker/src/main.ts', out: 'dist/worker.js' },
  // The migration runner is a deployable too. It used to be shipped as its own
  // image built `FROM build`, which meant the one thing that runs with
  // `app_owner` carried the whole toolchain — pnpm, its bundled `tar`, and
  // esbuild's Go binary, two CRITICAL advisories between them. Bundled, it runs
  // on the same runtime base as everything else.
  { entry: 'infra/scripts/migrate.ts', out: 'dist/migrate.js' },
  // The seed runs in preview environments, from the same image as the
  // migration (services.json, phase 1). It is bundled for the same reason: the
  // image it runs in has no package manager to run `pnpm seed` with.
  { entry: 'infra/scripts/seed.ts', out: 'dist/seed.js' },
  // The first tenant and the first administrator, from the same image as the
  // migration (services.json, phase 1). Separate from the seed because it must
  // never delete anything, and separate from the migration because it connects
  // as the application role rather than `app_owner`.
  { entry: 'infra/scripts/bootstrap.ts', out: 'dist/bootstrap.js' },
];

await rm(resolve(root, 'dist'), { recursive: true, force: true });

for (const target of targets) {
  const result = await build({
    entryPoints: [resolve(root, target.entry)],
    outfile: resolve(root, target.out),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    sourcemap: true,
    // Kept readable: a stack trace from production should name the function it
    // came from, and the bundle is not shipped over a network.
    minify: false,
    plugins: [workspaceOnly as never],
    banner: {
      // Bundled ESM loses `require`, which a few CommonJS dependencies still
      // reach for through interop shims.
      js: [
        "import { createRequire as __createRequire } from 'node:module';",
        'const require = __createRequire(import.meta.url);',
      ].join('\n'),
    },
    logLevel: 'info',
  });

  if (result.errors.length > 0) process.exit(1);

  /**
   * An entry-point guard that names a `.ts` file is a bundle that does nothing.
   *
   * Several scripts here end with `if (process.argv[1]?.endsWith('x.ts'))` so
   * that importing them from a test does not run them. Bundled, `process.argv[1]`
   * is `dist/x.js`, the guard is false, and the whole script is skipped — it
   * prints nothing, writes nothing and exits 0. `dist/seed.js` did exactly that:
   * a preview environment would have come up as an empty service desk, with a
   * green deploy and no error anywhere to explain it.
   *
   * Cheaper to refuse here than to find in an environment. A guard that has to
   * survive bundling matches both extensions.
   */
  const bundled = await readFile(resolve(root, target.out), 'utf8');
  const guard = /endsWith\((['"])[^'"]*\.ts\1\)/.exec(bundled);
  if (guard) {
    console.error(
      `${target.out} contains an entry-point guard on a .ts path (${guard[0]}). ` +
        'Bundled, that guard is always false and the script silently does nothing. ' +
        'Match both extensions instead, e.g. /name\\.(ts|js)$/.test(process.argv[1] ?? \'\').',
    );
    process.exit(1);
  }
}

console.log(`bundled ${targets.length} deployable(s) into dist/`);
