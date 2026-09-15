import { build } from 'esbuild';
import { rm } from 'node:fs/promises';
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
}

console.log(`bundled ${targets.length} deployable(s) into dist/`);
