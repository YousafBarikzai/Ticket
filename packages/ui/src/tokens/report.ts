/**
 * The contrast audit as a report a person reads (`pnpm --filter @itsm/ui
 * contrast:report`, and a CI step summary).
 *
 * The unit tests enforce the audit: any failing pair fails the build. They
 * say nothing about the pairs that pass by a hair, which is what somebody
 * nudging a token needs to know before they nudge it. This prints, per theme,
 * how many pairs each contract checks and how many fail, the tightest passes
 * of each kind, and how far apart the surfaces are (the thing border-first
 * light cards and borderless dark ones depend on). It is the port of the
 * design-time script's console output into the package.
 *
 * Pure: it returns text, and the script decides where it goes.
 */
import {
  auditContract,
  contractNames,
  contrastRatio,
  materialContract,
  roundRatio,
  type AuditResult,
  type ContractName,
  type PairKind,
} from './contrast.js';
import { colour, themeNames, type ThemeName } from './tokens.js';

export interface ContrastReport {
  /** Plain text for a terminal. */
  readonly text: string;
  /** GitHub-flavoured Markdown for `$GITHUB_STEP_SUMMARY`. */
  readonly markdown: string;
  /** Pairs checked, across every contract and theme, the materials included. */
  readonly pairs: number;
  readonly failures: number;
}

/** One audited pair, from any contract, in the shape the report lists. */
interface Row {
  readonly contract: ContractName | 'material';
  readonly pair: string;
  readonly kind: PairKind;
  readonly ratio: number;
  readonly minimum: number;
}

const kinds: readonly PairKind[] = ['body', 'large', 'ui'];

/** How many of the tightest passes to list per kind. */
const TIGHTEST = 6;

/** The surface separations that make a card read as a card. */
function separations(theme: ThemeName): readonly (readonly [string, number])[] {
  const surface = colour[theme].surface;
  return [
    ['canvas / raised', roundRatio(contrastRatio(surface.canvas, surface.raised))],
    ['raised / hover', roundRatio(contrastRatio(surface.raised, surface.hover))],
    ['raised / selected', roundRatio(contrastRatio(surface.raised, surface.selected))],
  ];
}

interface ThemeSection {
  readonly theme: ThemeName;
  readonly counts: readonly (readonly [ContractName | 'material', number, number])[];
  readonly tightest: Readonly<Record<PairKind, readonly Row[]>>;
  readonly separations: readonly (readonly [string, number])[];
  readonly failed: readonly string[];
}

function section(theme: ThemeName): ThemeSection {
  const byContract = contractNames.map((contract) => [contract, auditContract(contract, theme)] as const);
  const materials = materialContract([theme]);
  const counts = [
    ...byContract.map(([contract, results]) => [contract, results.length, results.filter((r) => !r.passes).length] as const),
    ['material', materials.length, materials.filter((r) => !r.passes).length] as const,
  ];
  const rows: Row[] = [
    ...byContract.flatMap(([, results]) =>
      results.map((r: AuditResult) => ({ contract: r.contract, pair: r.pair, kind: r.kind, ratio: r.ratio, minimum: r.minimum })),
    ),
    ...materials.map((r) => ({
      contract: 'material' as const,
      pair: `${r.token} on ${r.material}`,
      kind: r.kind,
      ratio: r.ratio,
      minimum: r.minimum,
    })),
  ];
  const margin = (row: Row): number => row.ratio - row.minimum;
  const tightest = Object.fromEntries(
    kinds.map((kind) => [
      kind,
      rows
        .filter((row) => row.kind === kind && margin(row) >= 0)
        .sort((a, b) => margin(a) - margin(b) || a.pair.localeCompare(b.pair))
        .slice(0, TIGHTEST),
    ]),
  ) as Record<PairKind, Row[]>;
  const failed = rows
    .filter((row) => margin(row) < 0)
    .map((row) => `${row.contract}: ${row.pair} is ${row.ratio}:1, needs ${row.minimum}:1`);
  return { theme, counts, tightest, separations: separations(theme), failed };
}

function plain(sections: readonly ThemeSection[], pairs: number, failures: number): string {
  const lines: string[] = [`Contrast audit: ${pairs} pairs in ${sections.length} themes, ${failures} failing`, ''];
  for (const s of sections) {
    const total = s.counts.reduce((sum, [, n]) => sum + n, 0);
    lines.push(`${s.theme} (${total} pairs)`);
    lines.push(`  ${s.counts.map(([name, n, failed]) => `${name} ${n}${failed > 0 ? ` (${failed} failing)` : ''}`).join(' · ')}`);
    for (const failure of s.failed) lines.push(`  FAIL ${failure}`);
    for (const kind of kinds) {
      if (s.tightest[kind].length === 0) continue;
      lines.push(`  tightest ${kind}: ${s.tightest[kind].map((t) => `${t.pair} ${t.ratio} (≥ ${t.minimum})`).join('; ')}`);
    }
    lines.push(`  separation: ${s.separations.map(([name, ratio]) => `${name} ${ratio}`).join(' · ')}`);
    lines.push('');
  }
  return `${lines.join('\n')}`;
}

function markdown(sections: readonly ThemeSection[], pairs: number, failures: number): string {
  const lines: string[] = [
    '## Contrast audit',
    '',
    `${pairs} pairs in ${sections.length} themes, **${failures} failing**.`,
    '',
    `| Theme | ${[...contractNames, 'material'].join(' | ')} | Failing | canvas / raised | raised / selected |`,
    `|---|${[...contractNames, 'material'].map(() => '---:').join('|')}|---:|---:|---:|`,
  ];
  for (const s of sections) {
    const failing = s.counts.reduce((sum, [, , failed]) => sum + failed, 0);
    const separation = new Map(s.separations);
    lines.push(
      `| \`${s.theme}\` | ${s.counts.map(([, n]) => n).join(' | ')} | ${failing} | ${separation.get('canvas / raised')} | ${separation.get('raised / selected')} |`,
    );
  }
  lines.push('');
  for (const s of sections) {
    lines.push(`### \`${s.theme}\`: tightest passes`, '', '| Kind | Pair | Ratio | Floor |', '|---|---|---:|---:|');
    for (const kind of kinds) {
      for (const t of s.tightest[kind]) lines.push(`| ${kind} | ${t.contract}: ${t.pair} | ${t.ratio} | ${t.minimum} |`);
    }
    if (s.failed.length > 0) lines.push('', ...s.failed.map((failure) => `- **Failing** ${failure}`));
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

/** The audit of every contract in every theme, as text and as Markdown. */
export function contrastReport(): ContrastReport {
  const sections = themeNames.map(section);
  const pairs = sections.reduce((sum, s) => sum + s.counts.reduce((n, [, count]) => n + count, 0), 0);
  const failures = sections.reduce((sum, s) => sum + s.failed.length, 0);
  return { text: plain(sections, pairs, failures), markdown: markdown(sections, pairs, failures), pairs, failures };
}
