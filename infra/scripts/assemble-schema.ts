/**
 * Assembles `prisma/schema.prisma` from the per-module fragments.
 *
 * Each module owns its tables and its schema fragment
 * (`modules/<m>/prisma/schema.prisma`, mapped to the owning squad in
 * CODEOWNERS). Prisma needs one datamodel, so this script concatenates the
 * fragments before any Prisma command runs. The output is generated and is
 * never edited by hand; a CI check re-runs it and fails on a difference.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..');
const output = join(root, 'prisma', 'schema.prisma');

const modules = readdirSync(join(root, 'modules'), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

const parts: string[] = [
  '// GENERATED FILE — do not edit.',
  '// Assembled by `pnpm db:assemble` from each module\'s prisma/schema.prisma.',
  '// Edit the module fragment instead; a module owns its own tables (ADR-0001).',
  '',
  readFileSync(join(root, 'prisma', 'base.prisma'), 'utf8').trim(),
  '',
];

const assembled: string[] = [];
for (const name of modules) {
  const fragment = join(root, 'modules', name, 'prisma', 'schema.prisma');
  if (!existsSync(fragment)) continue;
  parts.push(
    '// ' + '='.repeat(75),
    `// modules/${name}/prisma/schema.prisma`,
    '// ' + '='.repeat(75),
    '',
    readFileSync(fragment, 'utf8').trim(),
    '',
  );
  assembled.push(name);
}

const next = parts.join('\n') + '\n';
const changed = !existsSync(output) || readFileSync(output, 'utf8') !== next;

if (process.argv.includes('--check')) {
  if (changed) {
    console.error('prisma/schema.prisma is out of date. Run `pnpm db:assemble` and commit the result.');
    process.exit(1);
  }
  console.log('prisma/schema.prisma is up to date');
} else {
  writeFileSync(output, next);
  console.log(`assembled ${assembled.length} module schemas: ${assembled.join(', ')}`);
}
