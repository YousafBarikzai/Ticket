// @vitest-environment jsdom
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { act, forwardRef, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let search = '';
let pathname = '/rules';
const router = { refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), forward: vi.fn() };
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(search),
}));

const { ItsmProvider } = await import('@itsm/ui');
const { PageToolbar } = await import('../components/page/PageToolbar.js');
const { AsAt, asAtText } = await import('../components/page/AsAt.js');
const { RangeControl } = await import('../components/page/RangeControl.js');
const { Freshness } = await import('../components/page/Freshness.js');
const { updatedText } = await import('../components/page/UpdatedAt.js');
const { KpiStrip, kpiCardProps, COUNT_CAP } = await import('../components/page/KpiStrip.js');
const { RegisterCard, registerHeadline, HEADLINE_MAX } = await import('../components/page/RegisterCard.js');
const { RecordHero } = await import('../components/page/RecordHero.js');
const { ExportMenu, exportItems } = await import('../components/page/ExportMenu.js');
const { CardCsv } = await import('../components/page/CardCsv.js');
const { csvCell, csvFileName, tableRows, toCsv } = await import('../components/page/csv.js');
const { SampleNote, sampleNoteText } = await import('../components/page/SampleNote.js');
const { ScopeSelect, scopeHref } = await import('../components/page/ScopeSelect.js');
const { SectionJump } = await import('../components/page/SectionJump.js');
const { rangeHref, visibleRanges, DEMO_HIDDEN_RANGES } = await import('../components/page/range.js');
const { cleanupDocument, click, render } = await import('./support/render.js');

/**
 * The Administration page kit (WP-45a, A7 §2.3, SPEC §7.0.1 and §7.3): the
 * toolbar row and its fixed order, the one "As at", the page range and the
 * demo's hidden periods, the KPI strip's honest counts, the register card's
 * headline, the record hero's `<h1>`, CSV out of the tables on screen — and
 * axe over a dashboard and a register built from the kit, light and dark.
 */

const Link = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean | null }>(function Link(
  { prefetch: _prefetch, ...props },
  ref,
) {
  return <a ref={ref} {...props} />;
});

function Frame({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <ItsmProvider
      app="admin"
      Link={Link}
      router={router}
      usePathname={() => pathname}
      useSearchParams={() => new URLSearchParams(search)}
      locale="en-GB"
      timeZone="Europe/London"
    >
      {children}
    </ItsmProvider>
  );
}

/* axe-core is the design system's devDependency, resolved through `@itsm/ui` (as `deployment-warnings.test.tsx`). */
interface AxeRule {
  readonly id: string;
  readonly nodes: readonly { readonly html: string }[];
}
interface Axe {
  run(context: Element, options: Record<string, unknown>): Promise<{ violations: AxeRule[] }>;
}
const axe = createRequire(createRequire(import.meta.url).resolve('@itsm/ui'))('axe-core') as Axe;
const OFF = ['region', 'page-has-heading-one', 'html-has-lang', 'landmark-one-main', 'bypass', 'document-title', 'html-lang-valid', 'color-contrast', 'color-contrast-enhanced', 'target-size'];
const AXE = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
  rules: Object.fromEntries(OFF.map((rule) => [rule, { enabled: false }])),
};
async function violations(container: Element): Promise<string[]> {
  const results = await axe.run(container, AXE);
  return results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.html).join(' | ')}`);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE_DIR = join(HERE, '..', 'components', 'page');

const text = (element: Element | null | undefined): string => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const AT = '2026-10-02T09:04:00.000Z';

/** Lets lazily imported modules (the menu, the date picker, a popover) arrive and render. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** Waits, a tick at a time, until `found` answers something (a lazy module's first import can take a while). */
async function waitFor<T>(found: () => T | null | undefined, timeoutMs = 5_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = found();
    if (value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0)) return value;
    if (Date.now() > until) throw new Error('waitFor: timed out');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

beforeEach(() => {
  search = '';
  pathname = '/rules';
});

afterEach(() => {
  cleanupDocument();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function DashboardToolbar({ demo = false }: { readonly demo?: boolean }): ReactNode {
  return (
    <PageToolbar
      label="Command centre controls"
      primary={<button type="button">New rule</button>}
      actions={<ExportMenu print csv={{ selector: '[data-export-table]', filename: 'rules', caption: 'Exports the 3 rows shown' }} />}
      freshness={<Freshness at={AT} announcement="Command centre updated" />}
      range={<RangeControl label="Period" value="30d" options={['7d', '30d', '90d', '12m', 'ytd', 'custom']} demo={demo} />}
      asAt={<AsAt at={AT} timeZone="Europe/London" />}
      scope={<ScopeSelect value="all" options={[{ value: 'all', label: 'Whole desk' }, { value: 'mine', label: 'My teams' }]} />}
    />
  );
}

describe('PageToolbar', () => {
  it('lays the parts out as scope · As at · range, then freshness · Export · the primary, whatever order they are given in', () => {
    const { container } = render(
      <Frame>
        <DashboardToolbar />
      </Frame>,
    );
    const group = container.querySelector('[role="group"]')!;
    expect(group.getAttribute('aria-label')).toBe('Command centre controls');
    expect([...group.querySelectorAll('[data-slot]')].map((slot) => slot.getAttribute('data-slot'))).toEqual([
      'scope',
      'as-at',
      'range',
      'freshness',
      'actions',
      'primary',
    ]);
    expect(group.querySelector('.app-Toolbar__start [data-slot="scope"]')).not.toBeNull();
    expect(group.querySelector('.app-Toolbar__end [data-slot="primary"]')).not.toBeNull();
    // The primary is the last control in the row.
    expect(text([...group.querySelectorAll('button')].at(-1))).toBe('New rule');
  });

  it('carries exactly one "As at", the hook the parity checks count', () => {
    const { container } = render(
      <Frame>
        <DashboardToolbar />
      </Frame>,
    );
    const asAt = container.querySelectorAll('[data-as-at="page"]');
    expect(asAt).toHaveLength(1);
    expect(text(asAt[0])).toBe('As at 10:04 · Fri 2 Oct');
    expect(asAt[0]!.querySelector('time')!.getAttribute('dateTime')).toBe(AT);
  });

  it('is a group, not a toolbar, sticks only when asked, and draws nothing when it has nothing', () => {
    const { container } = render(
      <div>
        <PageToolbar sticky asAt={<AsAt at={AT} timeZone="UTC" />} />
        <PageToolbar />
      </div>,
    );
    expect(container.querySelectorAll('.app-Toolbar')).toHaveLength(1);
    expect(container.querySelector('[role="toolbar"]')).toBeNull();
    expect(container.querySelector('.app-Toolbar')!.hasAttribute('data-sticky')).toBe(true);
    expect(container.querySelector('.app-Toolbar__end')).toBeNull();
  });
});

describe('AsAt', () => {
  it('writes the time, then the short day, in the reader’s zone', () => {
    expect(asAtText(AT, 'Europe/London')).toBe('10:04 · Fri 2 Oct');
    expect(asAtText(AT, 'UTC')).toBe('09:04 · Fri 2 Oct');
    expect(asAtText('2026-10-02T23:30:00Z', 'Europe/London')).toBe('00:30 · Sat 3 Oct');
  });

  it('shows nothing for an instant or a zone it cannot read', () => {
    expect(asAtText('not a date', 'Europe/London')).toBeNull();
    expect(asAtText(AT, 'Mars/Olympus')).toBeNull();
    const { container } = render(<AsAt at="nope" timeZone="UTC" />);
    expect(container.innerHTML).toBe('');
  });
});

describe('range', () => {
  it('keeps every other parameter, replaces the period and drops a list’s cursor', () => {
    expect(rangeHref('/insights', 'view=sla&range=7d&cursor=abc', '90d')).toBe('/insights?view=sla&range=90d');
    expect(rangeHref('/', '', '30d')).toBe('/?range=30d');
    expect(rangeHref('/sla/performance', { team: ['a', 'b'], from: '2026-09-01', to: '2026-09-30' }, '7d')).toBe('/sla/performance?team=a&team=b&range=7d');
    expect(rangeHref('/insights', '?range=7d', 'custom', { from: '2026-09-01', to: '2026-09-30' })).toBe('/insights?range=custom&from=2026-09-01&to=2026-09-30');
    // Never somewhere else.
    expect(rangeHref('//evil.example', '', '7d')).toBe('/?range=7d');
  });

  it('hides 12 months, year to date and 180 days in the demo (D17), and nothing else', () => {
    expect([...DEMO_HIDDEN_RANGES].sort()).toEqual(['12m', '180d', 'ytd']);
    const all = ['7d', '30d', '90d', '180d', '12m', 'ytd', 'custom'] as const;
    expect(visibleRanges(all, true).map((option) => option.value)).toEqual(['7d', '30d', '90d', 'custom']);
    expect(visibleRanges(all, false).map((option) => option.value)).toEqual([...all]);
    expect(visibleRanges([{ value: '7d', label: 'Week' }, '7d', '30d'], false)).toEqual([
      { value: '7d', label: 'Week' },
      { value: '30d', label: '30 days' },
    ]);
  });
});

describe('RangeControl', () => {
  const options = ['7d', '30d', '90d', '12m', 'ytd', 'custom'] as const;
  const labels = (root: Element): string[] => [...root.querySelectorAll('a')].map((link) => text(link));

  it('offers 12 months and year to date to a real tenant, as links that keep the page’s filters', () => {
    search = 'view=sla&cursor=x';
    pathname = '/insights';
    const { container } = render(
      <Frame>
        <RangeControl label="Period" value="30d" options={options} />
      </Frame>,
    );
    expect(labels(container)).toEqual(['7 days', '30 days', '90 days', '12 months', 'Year to date', 'Custom']);
    const twelve = [...container.querySelectorAll('a')].find((link) => text(link) === '12 months')!;
    expect(twelve.getAttribute('href')).toBe('/insights?view=sla&range=12m');
    expect(container.querySelector('[aria-current="page"], [aria-current="true"]') ?? container.querySelector('a[data-state="on"]')).not.toBeNull();
  });

  it('hides 12 months and year to date when me.demo, even if the page offers them', () => {
    const { container } = render(
      <Frame>
        <RangeControl label="Period" value="30d" options={options} demo />
      </Frame>,
    );
    expect(labels(container)).toEqual(['7 days', '30 days', '90 days', 'Custom']);
    expect(container.textContent).not.toMatch(/12 months|Year to date|180 days/);
  });

  it('moves to another period in a transition, without scrolling', () => {
    const { container } = render(
      <Frame>
        <RangeControl label="Period" value="30d" options={options} />
      </Frame>,
    );
    click([...container.querySelectorAll('a')].find((link) => text(link) === '90 days')!);
    expect(router.replace).toHaveBeenCalledWith('/rules?range=90d', { scroll: false });
  });

  it('shows the date fields, loaded then, for a custom period', async () => {
    const { container } = render(
      <Frame>
        <RangeControl label="Period" value="custom" options={options} custom={{ from: '2026-09-01', to: '2026-09-30', min: '2026-06-04' }} />
      </Frame>,
    );
    const inputs = await waitFor(() => [...container.querySelectorAll('input')]);
    expect(inputs.length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector('.app-RangeControl__custom')).not.toBeNull();
  });

  it('selects nothing for a period it does not offer', () => {
    const { container } = render(
      <Frame>
        <RangeControl label="Period" value="12m" options={options} demo />
      </Frame>,
    );
    expect(labels(container)).not.toContain('12 months');
  });
});

describe('KpiStrip', () => {
  it('shows the whole scope’s figures as given, and a capped count as "999+"', () => {
    const { container } = render(
      <KpiStrip
        label="Tickets at a glance"
        items={[
          { id: 'open', label: 'Open', value: 1342, capped: true, context: 'All teams' },
          { id: 'breached', label: 'Breached', value: 112 },
          { id: 'csat', label: 'Satisfaction', value: null },
          { id: 'people', label: 'People', value: 200, approx: 'atLeast' },
        ]}
        columns={4}
      />,
    );
    const section = container.querySelector('section')!;
    expect(section.getAttribute('aria-label')).toBe('Tickets at a glance');
    const values = [...container.querySelectorAll('.itsm-StatCard')].map((card) => text(card));
    expect(values[0]).toContain('999+');
    expect(values[0]).not.toContain('1,342');
    expect(values[1]).toContain('112');
    expect(values[2]).toContain('—');
    expect(values[3]).toContain('200+');
  });

  it('maps capped to the honest state whatever the value, and says so when it counted only a loaded list', () => {
    expect(kpiCardProps({ id: 'a', label: 'Open', value: 4000, capped: true })).toMatchObject({ value: COUNT_CAP, approx: 'atLeast' });
    expect(kpiCardProps({ id: 'a', label: 'Open', value: 12 })).not.toHaveProperty('approx');
    expect(kpiCardProps({ id: 'a', label: 'Open', value: null, capped: true })).toMatchObject({ value: null });
    expect(kpiCardProps({ id: 'a', label: 'Open', value: 12, context: 'P1 and P2' }, { sample: 200 }).context).toBe('P1 and P2 · of the first 200');
    const { container } = render(<KpiStrip label="Assets" sample={200} items={[{ id: 'n', label: 'In repair', value: 3 }]} />);
    expect(text(container)).toContain('of the first 200');
  });

  it('draws nothing for no tiles', () => {
    expect(render(<KpiStrip label="Empty" items={[]} />).container.innerHTML).toBe('');
  });
});

describe('RegisterCard', () => {
  it('keeps the headline to 110 characters, without a full stop', () => {
    const long = `${'3 breaching · 10 unassigned · '.repeat(6)}and more.`;
    const line = registerHeadline(long)!;
    expect(line.length).toBeLessThanOrEqual(HEADLINE_MAX);
    expect(line.endsWith('…')).toBe(true);
    expect(registerHeadline('3 breaching · 10 unassigned.')).toBe('3 breaching · 10 unassigned');
    expect(registerHeadline('   ')).toBeUndefined();
    expect(registerHeadline(null)).toBeUndefined();
  });

  it('titles the table with its headline and marks it for export', () => {
    const { container } = render(
      <Frame>
        <RegisterCard title="Rules" headline={'x'.repeat(200)}>
          <table>
            <tbody>
              <tr>
                <td>Escalate P1</td>
              </tr>
            </tbody>
          </table>
        </RegisterCard>
      </Frame>,
    );
    expect(text(container.querySelector('h2'))).toBe('Rules');
    const headline = [...container.querySelectorAll('p')].map(text).find((line) => line.startsWith('x'))!;
    expect(headline.length).toBeLessThanOrEqual(HEADLINE_MAX);
    expect(container.querySelector('[data-export-table] table')).not.toBeNull();
  });

  it('omits an empty headline', () => {
    const { container } = render(
      <Frame>
        <RegisterCard title="Rules" headline="">
          <p>rows</p>
        </RegisterCard>
      </Frame>,
    );
    expect(container.querySelector('.itsm-Card__headline')).toBeNull();
  });
});

describe('RecordHero', () => {
  it('puts the record’s name in the page’s one <h1>, in the recordTitle style', () => {
    const { container } = render(
      <Frame>
        <RecordHero
          icon="workflow"
          title="Escalate unassigned P1s"
          status={{ label: 'Draft', tone: 'neutral' }}
          meta="Version 4 · changed by Jordan Lee 2 h ago"
          actions={<button type="button">Publish</button>}
        />
      </Frame>,
    );
    const headings = container.querySelectorAll('h1');
    expect(headings).toHaveLength(1);
    expect(text(headings[0])).toBe('Escalate unassigned P1s');
    expect(headings[0]!.className).toBe('app-RecordHero__title');
    expect(container.querySelector('section')!.getAttribute('aria-labelledby')).toBe(headings[0]!.id);
    expect(text(container)).toContain('Version 4 · changed by Jordan Lee 2 h ago');

    const css = readFileSync(join(PAGE_DIR, 'page.css'), 'utf8');
    const rule = /\.app-RecordHero__title \{([^}]*)\}/.exec(css)![1]!;
    for (const part of ['family', 'size', 'line', 'weight', 'tracking']) expect(rule).toContain(`var(--itsm-text-recordTitle-${part})`);
  });
});

describe('CSV out of the tables on screen', () => {
  function table(html: string): HTMLTableElement {
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.append(host);
    return host.querySelector('table')!;
  }

  /** Catches the download: the Blob handed to the browser, read back as text. */
  function captureDownloads(): { files: () => Promise<{ name: string; csv: string }[]> } {
    const blobs: Blob[] = [];
    const names: string[] = [];
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn((blob: Blob) => (blobs.push(blob), 'blob:x')), revokeObjectURL: vi.fn() }));
    const original = HTMLAnchorElement.prototype.click;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      if (this.download) names.push(this.download);
      else original.call(this);
    });
    return {
      // Decoded with the byte-order mark kept: `Blob.text()` would drop it, and it is part of what is checked.
      files: async () =>
        Promise.all(blobs.map(async (blob, index) => ({ name: names[index]!, csv: new TextDecoder('utf-8', { ignoreBOM: true }).decode(await blob.arrayBuffer()) }))),
    };
  }

  it('quotes every cell and defuses a formula', () => {
    expect(csvCell('Plain')).toBe('"Plain"');
    expect(csvCell('Say "hi"')).toBe('"Say ""hi"""');
    expect(csvCell('=SUM(A1)')).toBe(`"'=SUM(A1)"`);
    expect(csvCell(null)).toBe('""');
    expect(toCsv([['a', 'b']])).toBe('﻿"a","b"\r\n');
    expect(csvFileName('SLA by team · 30 days')).toBe('sla-by-team-30-days.csv');
  });

  it('reads what a person reads: no hidden digits, no buttons, no skipped rows', () => {
    const rows = tableRows(
      table(`<table><thead><tr><th>Rule</th><th>Runs</th></tr></thead><tbody>
        <tr><td>Escalate <span aria-hidden="true">⚡</span></td><td><span aria-hidden="true">12</span><span>12</span></td></tr>
        <tr data-csv="skip"><td colspan="2"><button>Load more</button></td></tr></tbody></table>`),
    );
    expect(rows).toEqual([
      ['Rule', 'Runs'],
      ['Escalate', '12'],
    ]);
  });

  it('ExportMenu offers CSV, print and the report, and its CSV is the register’s table', async () => {
    const downloads = captureDownloads();
    const { container } = render(
      <Frame>
        <ExportMenu csv={{ selector: '[data-export-table]', filename: 'rules', caption: 'Exports the 2 rows shown' }} print report="/insights/reports?new=1" />
        <div data-export-table="">
          <table>
            <thead>
              <tr>
                <th>Rule</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Escalate P1</td>
                <td>Published</td>
              </tr>
              <tr>
                <td>=cmd</td>
                <td>Draft</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Frame>,
    );
    const button = container.querySelector('button')!;
    expect(text(button)).toBe('Export');
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    click(button);
    const items = await waitFor(() => [...document.querySelectorAll('[role="menuitem"]')]);
    expect(items.map((item) => text(item.querySelector('.itsm-Menu__label') ?? item))).toEqual(
      expect.arrayContaining([expect.stringContaining('Download CSV'), expect.stringContaining('Print or save as PDF'), expect.stringContaining('Schedule as a report')]),
    );
    click(items.find((item) => text(item).includes('Download CSV'))!);
    await settle();
    expect(await downloads.files()).toEqual([{ name: 'rules.csv', csv: '﻿"Rule","State"\r\n"Escalate P1","Published"\r\n"\'=cmd","Draft"\r\n' }]);
  });

  it('ExportMenu’s items follow what it is given, and it draws nothing with none', () => {
    const noop = { onCsv: () => undefined, onPrint: () => undefined };
    expect(exportItems({ print: true }, noop).map((item) => ('id' in item ? item.id : ''))).toEqual(['print']);
    expect(exportItems({ csv: { selector: 'x', filename: 'x', caption: 'c' }, report: '/r' }, noop).map((item) => ('id' in item ? item.id : ''))).toEqual(['csv', 'report']);
    expect(render(<ExportMenu />).container.innerHTML).toBe('');
  });

  it('CardCsv writes the chart’s table twin', async () => {
    const downloads = captureDownloads();
    const { container } = render(
      <Frame>
        <figure id="sla-by-team">
          <svg aria-hidden="true" />
          <details>
            <summary>View as table</summary>
            <table>
              <thead>
                <tr>
                  <th>Team</th>
                  <th>Met</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th>Service Desk</th>
                  <td>92%</td>
                </tr>
              </tbody>
            </table>
          </details>
        </figure>
        <CardCsv figureId="sla-by-team" filename="SLA by team" />
      </Frame>,
    );
    const button = container.querySelector('button[aria-label="Download data (CSV)"], button')!;
    click(button);
    await settle();
    expect(await downloads.files()).toEqual([{ name: 'sla-by-team.csv', csv: '﻿"Team","Met"\r\n"Service Desk","92%"\r\n' }]);
  });
});

describe('ScopeSelect', () => {
  it('is a statement, not a choice, when there is one scope', () => {
    const { container } = render(
      <Frame>
        <ScopeSelect value="mine" options={[{ value: 'mine', label: 'My teams' }]} />
      </Frame>,
    );
    expect(container.querySelector('select')).toBeNull();
    expect(text(container.querySelector('.app-Scope'))).toBe('Scope: My teams');
  });

  it('moves the page to the chosen scope, keeping its other parameters', () => {
    search = 'range=30d&cursor=abc';
    const { container } = render(
      <Frame>
        <ScopeSelect value="all" defaultValue="all" options={[{ value: 'all', label: 'Whole desk' }, { value: 'team-1', label: 'Service Desk' }]} />
      </Frame>,
    );
    const select = container.querySelector('select')!;
    expect(select.getAttribute('aria-label')).toBe('Scope');
    act(() => {
      select.value = 'team-1';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(router.replace).toHaveBeenCalledWith('/rules?range=30d&scope=team-1', { scroll: false });
    expect(scopeHref('/', 'scope=x&range=7d', 'scope', 'all', 'all')).toBe('/?range=7d');
  });
});

describe('Freshness, SampleNote and SectionJump', () => {
  it('says how fresh the page is, with a refresh', () => {
    const { container } = render(
      <Frame>
        <Freshness at={AT} />
      </Frame>,
    );
    expect(container.querySelector('.app-Freshness__dot')!.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('time')!.getAttribute('dateTime')).toBe(AT);
    click(container.querySelector('button[aria-label="Refresh"], button')!);
    expect(router.refresh).toHaveBeenCalled();
    expect(updatedText(AT, Date.parse(AT) + 30_000, 'en-GB', 'Europe/London')).toBe('Updated just now');
    expect(updatedText('nope', null, 'en-GB', 'UTC')).toBe('Updated');
  });

  it('labels sample figures in the demo (D13)', () => {
    expect(sampleNoteText('decisions')).toBe('These figures come from sample decisions in this demo. No AI model is called.');
    const { container } = render(
      <Frame>
        <SampleNote subject="decisions" />
      </Frame>,
    );
    expect(text(container)).toContain('Sample data');
    expect(text(container)).toContain(sampleNoteText('decisions'));
  });

  it('jumps between a dashboard’s sections, and is not drawn for one section', () => {
    const { container } = render(
      <SectionJump
        items={[
          { id: 'pulse', label: 'Pulse' },
          { id: 'sla', label: 'SLA' },
        ]}
      />,
    );
    expect(container.querySelector('nav')!.getAttribute('aria-label')).toBe('On this page');
    expect([...container.querySelectorAll('a')].map((link) => link.getAttribute('href'))).toEqual(['#pulse', '#sla']);
    expect(render(<SectionJump items={[{ id: 'a', label: 'A' }]} />).container.innerHTML).toBe('');
  });
});

describe('the kit’s client cost', () => {
  const dir = PAGE_DIR;
  const files = readdirSync(dir).filter((name) => /\.tsx?$/.test(name));

  it('imports no chart module from a client file (A7 §10 rule 5)', () => {
    const offenders = files.filter((name) => {
      const source = readFileSync(join(dir, name), 'utf8');
      return /^['"]use client['"]/.test(source.trimStart()) && /from '@itsm\/ui\/charts'|import\('@itsm\/ui\/charts'\)/.test(source);
    });
    expect(offenders).toEqual([]);
    // The KPI strip is the kit's one chart import, and it is a server component.
    expect(readFileSync(join(dir, 'KpiStrip.tsx'), 'utf8')).toContain("from '@itsm/ui/charts'");
  });

  it('loads the overlays only on intent, never statically from a client file', () => {
    const offenders = files.filter((name) => /^import [^;]*from '@itsm\/ui\/overlays';/m.test(readFileSync(join(dir, name), 'utf8').replace(/^import type [^;]*;/gm, '')));
    expect(offenders).toEqual([]);
  });
});

describe.each(['apple', 'apple-dark'])('axe, in %s', (theme) => {
  it('a dashboard: toolbar, KPI row and a chart card’s CSV', async () => {
    const { container } = render(
      <Frame>
        <div data-itsm-theme={theme}>
          <SectionJump
            items={[
              { id: 'pulse', label: 'Pulse' },
              { id: 'sla', label: 'SLA' },
            ]}
          />
          <DashboardToolbar demo />
          <SampleNote subject="decisions" />
          <KpiStrip
            label="Desk pulse"
            items={[
              { id: 'backlog', label: 'Backlog', value: 1500, capped: true, context: 'Open now' },
              { id: 'raised', label: 'Raised', value: 448, trend: [12, 14, 16, 15], delta: { value: 0.09, format: { style: 'percent' }, period: 'vs previous 30 days', goodDirection: 'none' } },
              { id: 'resolved', label: 'Resolved', value: 415 },
              { id: 'sla', label: 'SLA met', value: 0.85, format: { style: 'percent' } },
              { id: 'reply', label: 'First reply', value: 42, format: { duration: 'minutes' } },
              { id: 'csat', label: 'Satisfaction', value: null },
            ]}
          />
          <CardCsv figureId="volume" filename="volume" />
        </div>
      </Frame>,
    );
    expect(await violations(container)).toEqual([]);
  });

  it('a register and a record', async () => {
    const { container } = render(
      <Frame>
        <div data-itsm-theme={theme}>
          <RecordHero icon="workflow" title="Escalate unassigned P1s" status={{ label: 'Published', tone: 'success' }} meta="Version 4" actions={<button type="button">Publish</button>} />
          <PageToolbar
            scope={<ScopeSelect value="mine" options={[{ value: 'mine', label: 'My teams' }]} />}
            actions={<ExportMenu csv={{ selector: '[data-export-table]', filename: 'rules', caption: 'Exports the rows shown' }} />}
            primary={<button type="button">New rule</button>}
          />
          <RegisterCard title="Rules" headline="3 failing · 1 draft">
            <table>
              <thead>
                <tr>
                  <th scope="col">Rule</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Escalate P1</td>
                </tr>
              </tbody>
            </table>
          </RegisterCard>
        </div>
      </Frame>,
    );
    expect(await violations(container)).toEqual([]);
  });
});
