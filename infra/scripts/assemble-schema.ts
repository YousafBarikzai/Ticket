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

/**
 * Every table a migration alters has to exist.
 *
 * Migrations here are hand-written — `prisma migrate diff` proposes dropping
 * the generated tsvector columns, the trigram indexes and
 * `platform_table_allowlist`, which exist only in hand-written SQL — so table
 * names are typed from memory, and a model called `ActivityType` maps to
 * `activity_type` rather than to the `time_activity_type` somebody reaches for
 * because the module is called `time`.
 *
 * That mistake used to surface four minutes into CI stage 3, as a Postgres
 * error inside a container log, on a branch whose unit tests were all green.
 * It is a string comparison against the schema that was just assembled, so it
 * belongs here and takes a millisecond.
 *
 * Only `ALTER TABLE` is checked. `CREATE TABLE` names something that does not
 * exist yet by definition, and a migration that creates and then alters in the
 * same file is the normal case rather than an error.
 */
function checkMigrationTables(schema: string): string[] {
  const mapped = new Set([...schema.matchAll(/@@map\("([^"]+)"\)/g)].map((match) => match[1]!));
  const problems: string[] = [];
  const dir = join(root, 'prisma', 'migrations');
  if (!existsSync(dir)) return problems;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(dir, entry.name, 'migration.sql');
    if (!existsSync(file)) continue;
    const sql = readFileSync(file, 'utf8');
    const created = new Set(
      [...sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?"?([A-Za-z0-9_]+)"?/gi)].map((match) => match[1]!),
    );
    for (const match of sql.matchAll(/ALTER TABLE (?:IF EXISTS )?"?([A-Za-z0-9_]+)"?/gi)) {
      const table = match[1]!;
      if (mapped.has(table) || created.has(table)) continue;
      problems.push(`${entry.name}: ALTER TABLE "${table}" names no @@map in the schema`);
    }
  }
  return problems;
}

if (process.argv.includes('--check')) {
  if (changed) {
    console.error('prisma/schema.prisma is out of date. Run `pnpm db:assemble` and commit the result.');
    process.exit(1);
  }
  const problems = checkMigrationTables(next);
  if (problems.length > 0) {
    console.error('a migration alters a table that does not exist:');
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }
  console.log('prisma/schema.prisma is up to date');
} else {
  writeFileSync(output, next);
  console.log(`assembled ${assembled.length} module schemas: ${assembled.join(', ')}`);
}
