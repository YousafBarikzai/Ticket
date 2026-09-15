import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { build } from 'esbuild';

/**
 * Bundles the service worker into each application's `public/sw.js`.
 *
 * A separate step rather than a framework plugin, for one reason: a service
 * worker is the only code in this product that can keep serving a wrong answer
 * after the code that produced it has been replaced. It is worth being one
 * file, built by something legible, with a version somebody can look at.
 *
 * The version is a hash of the bundle itself. That matters more than it looks:
 * the worker names its caches after it and deletes every other `itsm-` cache on
 * activate, so a version that changed on every build would throw away a
 * perfectly good cache on a deploy that did not touch the worker — and a
 * version that never changed would keep a stale one for ever.
 */

const root = resolve(import.meta.dirname, '..', '..');
const ENTRY = resolve(root, 'packages/pwa/src/sw.ts');
const PLACEHOLDER = '__SW_VERSION_PLACEHOLDER__';

const TARGETS = ['apps/workbench/public/sw.js', 'apps/portal/public/sw.js'];

async function main(): Promise<void> {
  const result = await build({
    entryPoints: [ENTRY],
    bundle: true,
    // A service worker is a classic script in every browser that matters, and
    // `importScripts` is the only module system it is guaranteed to have.
    format: 'iife',
    target: 'es2022',
    platform: 'browser',
    minify: true,
    write: false,
    define: { __SW_VERSION__: JSON.stringify(PLACEHOLDER) },
    legalComments: 'none',
  });

  const output = result.outputFiles?.[0];
  if (!output) throw new Error('esbuild produced no output for the service worker');

  const withoutVersion = output.text;
  const version = createHash('sha256').update(withoutVersion).digest('hex').slice(0, 12);
  const source = withoutVersion.replaceAll(PLACEHOLDER, version);

  for (const target of TARGETS) {
    const path = resolve(root, target);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source, 'utf8');
    process.stdout.write(`service worker → ${target} (${version}, ${(source.length / 1024).toFixed(1)} kB)\n`);
  }
}

await main();
