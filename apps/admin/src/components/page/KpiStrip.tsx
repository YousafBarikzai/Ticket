import type { ReactNode } from 'react';
import type { IconName, Problem } from '@itsm/ui';
import { StatCard, StatGrid, type StatCardDelta, type StatCardInfo, type StatCardProps } from '@itsm/ui/charts';
import './page.css';

/** The exact-count ceiling of `/tickets/count` (A8-2): at or above it, the tile reads "999+". */
export const COUNT_CAP = 999;

/** One KPI tile (A7 §2.3): the figure for the page's **whole** scope, never the rows a table happened to load. */
export interface KpiSpec {
  readonly id: string;
  readonly label: string;
  /** `null` is "not available" ("—", heard as "Not available"), never zero. */
  readonly value: number | null;
  readonly unit?: string;
  readonly format?: StatCardProps['format'];
  /** The value is a lower bound ("200+"): a list that had more than it read. */
  readonly approx?: 'atLeast';
  /**
   * The count reached the API's exact ceiling (`countTickets()` answers
   * `capped`): the tile reads "999+", heard as "at least 999", whatever the
   * value says.
   */
  readonly capped?: boolean;
  readonly delta?: StatCardDelta;
  /** Recent values, oldest first. Leave out where there is no history: the tile then has no spark row. */
  readonly trend?: readonly (number | null)[];
  readonly visual?: ReactNode;
  /** The line at the foot: "2 P2 · 4 P3 · 3 P4". */
  readonly context?: string;
  readonly info?: StatCardInfo;
  readonly icon?: IconName;
  readonly href?: string;
  readonly status?: 'default' | 'attention' | 'critical';
  readonly problem?: Problem;
}

export interface KpiStripProps {
  /** The section's name: "Desk pulse", "Rules at a glance". */
  readonly label: string;
  readonly items: readonly KpiSpec[];
  /** Six on a dashboard; four to six on a register. Every count folds to two on a phone. */
  readonly columns?: 3 | 4 | 6;
  /**
   * Set only when the figures were counted from a loaded list rather than
   * the whole scope (A7 §2.2 T2): every tile then says "of the first {n}", so
   * the strip never claims the whole register silently.
   */
  readonly sample?: number;
  /** `en-GB` by default. */
  readonly locale?: string;
  readonly className?: string;
}

function contextFor(spec: KpiSpec, sample: number | undefined, locale: string): string | undefined {
  if (sample === undefined) return spec.context;
  const note = `of the first ${new Intl.NumberFormat(locale).format(sample)}`;
  return spec.context ? `${spec.context} · ${note}` : note;
}

/** The `StatCard` props for one KPI: the honest states (capped, sampled, unavailable) applied. */
export function kpiCardProps(spec: KpiSpec, options: { readonly sample?: number; readonly locale?: string } = {}): StatCardProps {
  const locale = options.locale ?? 'en-GB';
  const capped = spec.capped === true && spec.value !== null;
  const context = contextFor(spec, options.sample, locale);
  return {
    label: spec.label,
    value: capped ? COUNT_CAP : spec.value,
    locale,
    ...(capped || spec.approx ? { approx: 'atLeast' as const } : {}),
    ...(spec.unit ? { unit: spec.unit } : {}),
    ...(spec.format ? { format: spec.format } : {}),
    ...(spec.delta ? { delta: spec.delta } : {}),
    ...(spec.trend ? { trend: spec.trend } : {}),
    ...(spec.visual ? { visual: spec.visual } : {}),
    ...(context ? { context } : {}),
    ...(spec.info ? { info: spec.info } : {}),
    ...(spec.icon ? { icon: spec.icon } : {}),
    ...(spec.href ? { href: spec.href } : {}),
    ...(spec.status ? { status: spec.status } : {}),
    ...(spec.problem ? { problem: spec.problem } : {}),
  };
}

/**
 * The KPI row (G5, A7 §2.3): a named section of `StatCard` v3 tiles in a
 * `StatGrid`, on dashboards (six) and registers (four to six).
 *
 * What each tile counts is the caller's, but the strip keeps the counting
 * honest: a capped count reads "999+" (A7 §2.4 rule 9), a figure from a loaded
 * list says so, and an unknown value is "—" with words, never 0. A server
 * component; the tiles are server-safe (RV2), so a strip adds no JavaScript.
 */
export function KpiStrip({ label, items, columns = 6, sample, locale = 'en-GB', className }: KpiStripProps): ReactNode {
  if (items.length === 0) return null;
  return (
    <section aria-label={label} className={className ? `app-KpiStrip ${className}` : 'app-KpiStrip'}>
      <StatGrid columns={columns}>
        {items.map((spec) => (
          <StatCard key={spec.id} {...kpiCardProps(spec, { ...(sample !== undefined ? { sample } : {}), locale })} />
        ))}
      </StatGrid>
    </section>
  );
}
