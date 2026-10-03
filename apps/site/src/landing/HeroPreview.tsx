import type { ReactNode } from 'react';
import { AREAS, SERVICE_DESK_NAV_PREVIEW, SERVICE_DESK_OVERVIEW_PURPOSE } from '@itsm/contracts/areas';
import { DEMO_RESET, ukDateKey } from '@itsm/contracts/demo';
import { Avatar, BrandMark, DeltaPill, Icon, IconTile, StatusPill } from '@itsm/ui';
import { AreaChart, Gauge, Sparkline, StatGrid, chartToneVar, describeTrend } from '@itsm/ui/charts';
import { isIconName } from '@itsm/ui/icons';
import { PREVIEW, SHOT_ALT } from './content.js';
import { HERO_KPIS, HERO_NAV_COUNTS, HERO_SLA, SHOT_ROWS, heroHeadline, heroSeries, heroSlaHeadline, type HeroKpi } from './hero-sample.js';
import { shotSpec, type ShotId } from './shots.config.js';

/**
 * The landing's live preview of the Service Desk Overview (SPEC v3 §6.2,
 * X-M2; A5 §4.4), and the stand-ins for the screenshots until the final wave
 * captures them (X-M9).
 *
 * Drawn by the product's own kit — `AreaChart`, `Gauge`, `Sparkline`,
 * `DeltaPill`, and the tiles' and cards' own markup and classes — on the server, from sample data (`hero-sample.ts`): crisp at any
 * pixel density, recoloured by the dark scheme, and it costs no chart
 * JavaScript, because every chart is static (`interactive={false}`) and no
 * client component is imported (the tiles and cards below say why).
 *
 * It must look like the product a prospect meets one click later, so the
 * sidebar is `SERVICE_DESK_NAV_PREVIEW` and the purpose line is
 * `SERVICE_DESK_OVERVIEW_PURPOSE`, both from `@itsm/contracts/areas`; the
 * Service Desk's own navigation test fails if either drifts from the real
 * navigation (V-m2). The tiles are the first four of the Overview's, and the
 * chart titles are its titles. The frame itself (top bar, sidebar) is static
 * markup in `site.css` that copies the frame's anatomy, because mounting the
 * real shell would bring its client code with it.
 *
 * `data-hero-preview` is the hook the PMO parity check reads (§7.0.1).
 */

const TIME_ZONE = DEMO_RESET.timeZone;

/** The Service Desk's sidebar, as the preview draws it: the area card, the nav from the contracts, the persona's card. */
function PreviewSidebar(): ReactNode {
  const sections: { readonly section: string | undefined; readonly items: (typeof SERVICE_DESK_NAV_PREVIEW)[number][] }[] = [];
  for (const item of SERVICE_DESK_NAV_PREVIEW) {
    const last = sections.at(-1);
    if (last && last.section === item.section) last.items.push(item);
    else sections.push({ section: item.section, items: [item] });
  }
  return (
    <div className="app-Preview__side">
      <div className="app-Preview__area">
        <BrandMark app="workbench" size={28} />
        <span className="app-Preview__areaText">
          <span className="app-Preview__areaName">{AREAS.workbench.name}</span>
          <span className="app-Preview__areaLine">{AREAS.workbench.description}</span>
        </span>
        <Icon name="chevrons-up-down" size={14} className="app-Preview__areaChevron" />
      </div>
      <div className="app-Preview__nav">
        {sections.map((group) => (
          <div key={group.section ?? 'top'} className="app-Preview__group">
            {group.section ? <span className="app-Preview__groupLabel">{group.section}</span> : null}
            {group.items.map((item) => (
              <span key={item.id} className="app-Preview__navItem" data-preview-nav={item.id} data-current={item.id === 'overview' ? '' : undefined}>
                {isIconName(item.icon) ? <Icon name={item.icon} size={16} /> : null}
                <span className="app-Preview__navLabel">{item.label}</span>
                {HERO_NAV_COUNTS[item.id] !== undefined ? <span className="app-Preview__navCount">{HERO_NAV_COUNTS[item.id]}</span> : null}
              </span>
            ))}
          </div>
        ))}
      </div>
      <div className="app-Preview__user">
        <Avatar name={PREVIEW.user.name} initials={PREVIEW.user.initials} size={28} decorative />
        <span className="app-Preview__userText">
          <span className="app-Preview__userName">{PREVIEW.user.name}</span>
          <span className="app-Preview__userTitle">{PREVIEW.user.title}</span>
        </span>
      </div>
    </div>
  );
}

const STATUS_ICON = {
  attention: { icon: 'triangle-alert', label: 'Needs attention' },
  critical: { icon: 'circle-alert', label: 'Critical' },
} as const;

/**
 * One tile, as the Overview draws it: a sparkline for Open, a 6 px strip for
 * the others.
 *
 * The design system's own markup and classes (`StatCard`'s ready state), not
 * the component: `StatCard`'s module also holds its link, info tip and retry
 * button, which are client components, and importing it would put them —
 * with the provider they read — into the site's first load for a tile that
 * uses none of them. The preview is a picture, so the static markup is all it
 * needs; the kit's stylesheet draws it exactly as the product does.
 */
function Kpi({ kpi }: { readonly kpi: HeroKpi }): ReactNode {
  const total = kpi.split ? kpi.split.segments.reduce((sum, segment) => sum + segment.value, 0) : 0;
  const status = kpi.status ?? 'default';
  return (
    <div className="itsm-StatCard" data-layout="tile" data-status={status} data-surface="raised" data-spark="" data-delta={kpi.delta ? '' : undefined}>
      <div className="itsm-StatCard__grid">
        <div className="itsm-StatCard__head">
          <p className="itsm-StatCard__label">{kpi.label}</p>
          {status !== 'default' ? <Icon name={STATUS_ICON[status].icon} size="sm" label={STATUS_ICON[status].label} className="itsm-StatCard__status" /> : null}
        </div>
        <p className="itsm-StatCard__value">
          <span className="itsm-StatCard__number">{kpi.value}</span>
        </p>
        {kpi.delta ? (
          <div className="itsm-StatCard__delta">
            <DeltaPill value={kpi.delta.value} period={kpi.delta.period} goodDirection={kpi.delta.goodDirection} />
          </div>
        ) : null}
        {kpi.trend ? (
          <div className="itsm-StatCard__spark" data-kind="trend">
            <Sparkline values={kpi.trend} label={`Trend: ${describeTrend(kpi.trend)}`} tone="accent" width="fill" height={40} className="itsm-StatCard__trend" />
          </div>
        ) : kpi.split ? (
          <div className="itsm-StatCard__spark" data-kind="visual">
            <span className="app-Strip" role="img" aria-label={kpi.split.label}>
              {kpi.split.segments
                .filter((segment) => segment.value > 0)
                .map((segment) => (
                  <span key={segment.id} className="app-Strip__part" style={{ flexGrow: segment.value / total, background: chartToneVar[segment.tone] }} />
                ))}
            </span>
          </div>
        ) : null}
        <p className="itsm-StatCard__context">
          <span className="itsm-StatCard__footnote">{kpi.context}</span>
        </p>
      </div>
    </div>
  );
}

/**
 * A chart card, as `ChartCard` draws it (title, written headline, plot), in
 * the design system's markup for the same reason as the tiles: `ChartCard`
 * is built on `Card`, a client component that reads the provider.
 */
function PreviewCard({ title, headline, children }: { readonly title: string; readonly headline: string; readonly children: ReactNode }): ReactNode {
  return (
    <div className="itsm-Surface itsm-Card itsm-ChartCard" data-padding="none" data-state="ready" data-lede="">
      <div className="itsm-Card__header">
        <div className="itsm-Card__heading">
          <div className="itsm-Card__titles">
            <div className="itsm-Card__titleRow">
              <p className="itsm-Card__title">{title}</p>
            </div>
          </div>
        </div>
      </div>
      <div className="itsm-Card__body">
        <div className="itsm-ChartCard__lede">
          <p className="itsm-ChartCard__headline">{headline}</p>
        </div>
        <div className="itsm-ChartCard__plot">{children}</div>
      </div>
    </div>
  );
}

export interface HeroPreviewProps {
  /** The instant the page is rendered for: anchors the series to today's UK date and places the "As at" marker. */
  readonly now: number;
}

export function HeroPreview({ now }: HeroPreviewProps): ReactNode {
  const series = heroSeries(ukDateKey(now));
  const asAt = new Date(now).toISOString();
  return (
    <div className="app-Preview" data-hero-preview="">
      <PreviewSidebar />
      <div className="app-Preview__main">
        <div className="app-Preview__top">
          <span className="app-Preview__heading">
            <span className="app-Preview__title">{PREVIEW.title}</span>
            <span className="app-Preview__purpose">{SERVICE_DESK_OVERVIEW_PURPOSE}</span>
          </span>
          <span className="app-Preview__chips">
            <StatusPill label={PREVIEW.company} tone="neutral" icon="home" size="sm" className="app-Preview__company" />
            <StatusPill label={PREVIEW.sample} tone="neutral" icon="info" size="sm" />
          </span>
        </div>
        <div className="app-Preview__body">
          <StatGrid columns={4}>
            {HERO_KPIS.map((kpi) => (
              <Kpi key={kpi.id} kpi={kpi} />
            ))}
          </StatGrid>
          <div className="app-Preview__charts">
            <div className="app-Preview__trend">
              <PreviewCard title={PREVIEW.trendTitle} headline={heroHeadline(series)}>
                <AreaChart
                  title={PREVIEW.trendTitle}
                  xType="time"
                  series={[
                    { id: 'raised', label: 'Raised', style: 'comparison', points: series.raised },
                    { id: 'resolved', label: 'Resolved', points: series.resolved },
                  ]}
                  fill="gradient"
                  curve="monotone"
                  endLabels="auto"
                  markers={[{ kind: 'today' }]}
                  asAt={asAt}
                  timeZone={TIME_ZONE}
                  interactive={false}
                  table="hidden"
                  height={176}
                  locale="en-GB"
                />
              </PreviewCard>
            </div>
            <div className="app-Preview__sla">
              <PreviewCard title={PREVIEW.slaTitle} headline={heroSlaHeadline()}>
                <Gauge label={PREVIEW.slaTitle} value={HERO_SLA.value} target={HERO_SLA.target} locale="en-GB" />
              </PreviewCard>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const TONE_FOR_ROW = { danger: 'danger', high: 'high', warning: 'warning', info: 'info', neutral: 'neutral', hold: 'hold', neutralSoft: 'neutral' } as const;

/**
 * A screenshot's stand-in (X-M9): the screen it will show, drawn small from
 * the same kit and sample data, with its area's mark, its title and a
 * "Sample data" chip. One image to assistive technology, named by the
 * picture's own alt text, so the page reads the same before and after the
 * pictures arrive.
 */
export function ShotPreview({ id }: { readonly id: ShotId }): ReactNode {
  const spec = shotSpec(id);
  const rows = SHOT_ROWS[id] ?? [];
  return (
    <div className="app-ShotPreview" role="img" aria-label={SHOT_ALT[id]} data-shot-preview={id}>
      <div className="app-ShotPreview__bar">
        <BrandMark app={spec.area} size={20} />
        <span className="app-ShotPreview__title">{spec.preview.title}</span>
        <StatusPill label={PREVIEW.sample} tone="neutral" icon="info" size="sm" />
      </div>
      <div className="app-ShotPreview__body" data-kind={spec.preview.kind}>
        {spec.preview.kind === 'overview' ? <MiniOverview /> : null}
        {spec.preview.kind === 'list' ? (
          <ul className="app-ShotPreview__rows">
            {rows.map((row) => (
              <li key={row.title} className="app-ShotPreview__row">
                <span className="app-ShotPreview__rowTitle">{row.title}</span>
                {row.meta ? <StatusPill label={row.meta} tone={TONE_FOR_ROW[row.tone]} size="sm" /> : null}
              </li>
            ))}
          </ul>
        ) : null}
        {spec.preview.kind === 'board' ? (
          <div className="app-ShotPreview__columns">
            {rows.map((column) => (
              <div key={column.title} className="app-ShotPreview__column">
                <span className="app-ShotPreview__columnHead">
                  {column.title} <span className="app-ShotPreview__count">{column.meta}</span>
                </span>
                <span className="app-ShotPreview__card" />
                <span className="app-ShotPreview__card" />
              </div>
            ))}
          </div>
        ) : null}
        {spec.preview.kind === 'tiles' ? (
          <div className="app-ShotPreview__tiles">
            {rows.map((tile, index) => (
              <span key={tile.title} className="app-ShotPreview__tile">
                <IconTile icon={(['circle-alert', 'sparkles', 'book-open', 'inbox'] as const)[index % 4]!} size={28} />
                {tile.title}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Three small tiles and a trend, from the hero's own sample data. */
function MiniOverview(): ReactNode {
  const open = HERO_KPIS[0]!;
  return (
    <div className="app-ShotPreview__overview">
      {HERO_KPIS.slice(0, 3).map((kpi) => (
        <span key={kpi.id} className="app-ShotPreview__kpi">
          <span className="app-ShotPreview__kpiLabel">{kpi.label}</span>
          <span className="app-ShotPreview__kpiValue">{kpi.value}</span>
        </span>
      ))}
      <span className="app-ShotPreview__spark">
        <Sparkline values={open.trend ?? []} label="Sample trend" width="fill" height={56} tone="accent" curve="monotone" />
      </span>
    </div>
  );
}
