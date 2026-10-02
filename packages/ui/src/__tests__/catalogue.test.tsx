import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import * as root from '../index.js';
import { iconRegistry } from '../icons/registry.js';
import * as charts from '../charts/index.js';
import * as data from '../data/index.js';
import * as overlays from '../overlays/index.js';
import * as shell from '../shell/index.js';
import type { ActionSpec, EmptySpec, LinkComponent, Problem } from '../types.js';

/**
 * The design system's catalogue as a contract (SPEC §3.1, §4).
 *
 * The component packages are written in parallel against typed stubs, so the
 * one thing that must not drift while they are is the surface itself: which
 * subpath exports what, and what each component needs to render. These tests
 * pin both. They say nothing about behaviour — each component's own package
 * tests that — only that the names are where the other packages were told
 * they would be, and that every component renders on the server with the
 * props its signature requires. Next renders every client component on the
 * server too, so a component that cannot is broken in all three apps.
 */

const source = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(join(source, '../package.json'), 'utf8')) as {
  exports: Record<string, string>;
};

/** Runtime exports each subpath must carry: the §3.1 table, plus the helpers §4 names. */
const surface: Record<string, readonly string[]> = {
  '.': [
    // Provider and hooks.
    'ItsmProvider', 'useItsm', 'useUrlState', 'useHotkey', 'useCollectionKeyboard', 'Region', 'useRegions',
    'announce', 'useLiveAnnouncer', 'useRegisterCommands', 'useRecordRecent', 'useRecents', 'usePins', 'notify',
    // Icons, actions, inputs.
    'Icon', 'BrandMark', 'Button', 'IconButton', 'Kbd', 'Input', 'Textarea', 'Select', 'Checkbox', 'CheckboxGroup',
    'RadioGroup', 'Switch', 'SegmentedControl', 'SearchField', 'NumberField', 'DurationField', 'TimeField', 'Tabs',
    // Form kit.
    'Form', 'FormField', 'FormSection', 'FormErrorSummary', 'InlineEdit',
    // Feedback.
    'Banner', 'InlineAlert', 'GlobalBanner', 'EmptyState', 'ProblemState', 'StatusScreen', 'Skeleton', 'SkeletonText',
    'SkeletonAvatar', 'SkeletonStat', 'SkeletonCard', 'SkeletonTable', 'SkeletonList', 'SkeletonConversation',
    'SkeletonPage', 'Spinner', 'ProgressBar', 'Meter', 'ConnectionStatus',
    // Display.
    'Surface', 'Card', 'Tile', 'TileGrid', 'Badge', 'StatusPill', 'Avatar', 'AvatarStack', 'DescriptionList',
    'Disclosure', 'Prose', 'RichText', 'Stepper', 'FileChip', 'Table', 'StaticTable', 'ActivityFeed', 'Timeline',
    'RelativeTime', 'VisuallyHidden', 'cx',
    'Count', 'InfoTipTrigger', 'ticketStateLook', 'approvalStateLook', 'priorityLook', 'ticketTypeLook',
    'TICKET_STATE_LOOK', 'STATUS_CATEGORY_LOOK', 'SLA_STATE_LOOK', 'APPROVAL_STATE_LOOK', 'PRIORITY_LOOK', 'TYPE_LOOK', 'COMPONENT_STATE_LOOK', 'PROBLEM_STATE_LOOK', 'MAJOR_INCIDENT_LOOK',
    // Deprecated root re-exports, kept until no application imports them (rule 3).
    'Metric', 'MetricGrid', 'InteractiveTable', 'CommandPalette', 'FormRenderer', 'structuralVariables',
    'themeVariables', 'uiStylesheet', 'SlaClock', 'AiSuggestionCard',
  ],
  './styles': ['uiStylesheet', 'uiStylesheetVersion', 'componentStylesheet'],
  './theme': ['themeInitScript', 'ThemeProvider', 'useTheme'],
  './icons': ['Icon', 'BrandMark', 'iconRegistry'],
  './format': [
    'formatDateTime', 'formatRelative', 'formatDuration', 'parseDuration', 'formatNumber', 'formatCompact',
    'formatPercent', 'formatCount', 'formatBadgeCount', 'formatList', 'formatBytes', 'RelativeTime',
  ],
  './overlays': [
    'Tooltip', 'Menu', 'ContextMenu', 'Popover', 'Dialog', 'ConfirmDialog', 'ConflictDialog', 'Sheet', 'Toaster',
    'Combobox', 'PersonPicker', 'DatePicker', 'DateRangePicker', 'SplitButton',
    'InfoTip',
  ],
  './data': ['DataTable', 'FilterBar', 'FilterChip', 'BulkActionBar', 'LoadMore', 'OlderNewer', 'ViewMenu', 'InteractiveTable'],
  './charts': [
    'StatCard', 'StatGrid', 'Sparkline', 'LineChart', 'AreaChart', 'BarChart', 'DonutChart', 'ProgressRing',
    'ChartFigure', 'Metric', 'MetricGrid',
    'chartToneVar', 'chartToneOutline',
  ],
  './shell': [
    'AppShell', 'TopBar', 'TabBar', 'BottomDock', 'SplitView', 'SearchTrigger', 'UserMenu', 'NotificationCenter',
    'PageHeader', 'Breadcrumbs', 'TabNav', 'HierNav', 'RouteProgress', 'RouteFocus', 'SkipLinks', 'CommandPalette',
    'ShortcutsDialog',
  ],
  './forms': ['FormRenderer'],
  './workbench': ['AiSuggestionCard', 'SlaClock', 'describeRemaining'],
};

describe('the package surface', () => {
  it.each(Object.entries(surface))('%s exports what the catalogue says it does', async (subpath, names) => {
    const target = manifest.exports[subpath];
    expect(target, `package.json has no "${subpath}" export`).toBeDefined();
    const module = (await import(/* @vite-ignore */ resolve(source, '..', target!))) as Record<string, unknown>;
    const missing = names.filter((name) => module[name] === undefined);
    expect(missing).toEqual([]);
  });

  it('keeps StaticTable as another name for Table, not a second component', () => {
    expect(root.StaticTable).toBe(root.Table);
  });
});

/*
 * Every stub rendered on the server, inside the provider, with only the props
 * its signature requires. The props objects are typed by the components, so
 * this file also stops compiling when a required prop is renamed.
 */

const TestLink: LinkComponent = ({ prefetch, replace, scroll, ...anchor }) => {
  void [prefetch, replace, scroll];
  return <a {...anchor} />;
};
const router = { push() {}, replace() {}, back() {} };
const usePathname = () => '/tickets';
const useSearchParams = () => new URLSearchParams('q=vip');

function serverRender(element: ReactElement): string {
  return renderToStaticMarkup(
    <root.ItsmProvider
      app="admin"
      Link={TestLink}
      router={router}
      usePathname={usePathname}
      useSearchParams={useSearchParams}
      locale="en-GB"
      timeZone="Europe/London"
    >
      {element}
    </root.ItsmProvider>,
  );
}

const noop = () => {};
const resolved = async () => {};
const plural = { one: 'ticket', other: 'tickets' };
const action: ActionSpec = { id: 'publish', label: 'Publish rule', variant: 'tinted' };
const empty: EmptySpec = { title: 'No rules yet', action };
const problem: Problem = { status: 503, title: "Can't reach the service", retryable: true };
const items = [{ id: 'open', label: 'Open', onSelect: noop }, { type: 'separator' as const }];

function Hooks(): ReactElement {
  const [state] = root.useUrlState({ parse: (p) => ({ q: p.get('q') ?? '' }), serialise: (v) => ({ q: v.q || undefined }) });
  root.useHotkey({ keys: 'mod+k', handler: noop, description: 'Search', group: 'General' });
  root.useCollectionKeyboard({ count: 0, getRow: () => null, onActivate: noop });
  root.useRegions();
  root.useLiveAnnouncer('inbox');
  root.useRegisterCommands([{ id: 'new', label: 'New ticket', run: noop }], []);
  root.useRecordRecent({ id: 't-1', label: 'INC-000001', href: '/tickets/1', kind: 'ticket' });
  root.useRecents();
  root.usePins();
  return <output>{state.q}</output>;
}

const stubs: readonly (readonly [string, ReactElement])[] = [
  ['hooks', <Hooks />],
  ['Icon', <root.Icon name="inbox" />],
  ['BrandMark', <root.BrandMark app="portal" />],
  ['Kbd', <root.Kbd keys="mod+k" />],
  ['RelativeTime', <root.RelativeTime date="2026-09-29T10:00:00Z" />],
  ['Region', <root.Region id="list" label="Tickets">x</root.Region>],
  ['SegmentedControl', <root.SegmentedControl label="Scope" options={[{ value: 'open', label: 'Open' }]} value="open" mode="value" />],
  ['SearchField', <root.SearchField value="" onValueChange={noop} label="Search rules" />],
  ['NumberField', <root.NumberField value={null} onChange={noop} />],
  ['DurationField', <root.DurationField value={240} onChange={noop} />],
  ['TimeField', <root.TimeField value="09:00" onChange={noop} />],
  ['CheckboxGroup', <root.CheckboxGroup label="Channels" options={[{ value: 'mail', label: 'Email' }]} value={[]} onChange={noop} />],
  ['Form', <root.Form onSubmit={resolved}>x</root.Form>],
  ['FormSection', <root.FormSection title="Details">x</root.FormSection>],
  ['FormErrorSummary', <root.FormErrorSummary errors={[{ fieldId: 'title', message: 'Enter a title' }]} />],
  ['InlineEdit', <root.InlineEdit label="Priority" value="P2" onSave={resolved} />],
  ['Banner', <root.Banner tone="info">x</root.Banner>],
  ['InlineAlert', <root.InlineAlert tone="warning">x</root.InlineAlert>],
  ['GlobalBanner', <root.GlobalBanner tone="danger" title="Major incident" />],
  ['ProblemState', <root.ProblemState problem={problem} />],
  ['StatusScreen', <root.StatusScreen title="You're signed out" />],
  ['SkeletonAvatar', <root.SkeletonAvatar />],
  ['SkeletonStat', <root.SkeletonStat />],
  ['SkeletonCard', <root.SkeletonCard />],
  ['SkeletonTable', <root.SkeletonTable />],
  ['SkeletonList', <root.SkeletonList />],
  ['SkeletonConversation', <root.SkeletonConversation />],
  ['SkeletonPage', <root.SkeletonPage variant="list" />],
  ['Spinner', <root.Spinner />],
  ['ProgressBar', <root.ProgressBar label="Uploading" />],
  ['Meter', <root.Meter value={3} max={10} label="AI budget" />],
  ['ConnectionStatus', <root.ConnectionStatus state="offline" pending={2} attention={[]} onRetry={noop} onDiscard={noop} />],
  ['Surface', <root.Surface>x</root.Surface>],
  ['StatusPill', <root.StatusPill label="Open" tone="accent" />],
  ['AvatarStack', <root.AvatarStack people={[{ name: 'Ada Lovelace' }]} />],
  ['DescriptionList', <root.DescriptionList items={[{ id: 'p', label: 'Priority', value: 'P2' }]} />],
  ['Disclosure', <root.Disclosure summary="More">x</root.Disclosure>],
  ['Prose', <root.Prose>x</root.Prose>],
  ['Stepper', <root.Stepper label="Progress" steps={[{ id: 'a', label: 'Raised', status: 'complete' }]} />],
  ['FileChip', <root.FileChip name="screenshot.png" />],
  ['ActivityFeed', <root.ActivityFeed label="Activity" items={[{ id: 'a', at: '2026-09-29T10:00:00Z', verb: 'opened' }]} />],
  ['Count', <root.Count value={3} />],
  ['InfoTipTrigger', <root.InfoTipTrigger label="About Backlog" body="Open tickets in your teams." />],
  ['TICKET_STATE_LOOK', <root.StatusPill {...root.TICKET_STATE_LOOK.pending_requester} />],
  ['STATUS_CATEGORY_LOOK', <root.StatusPill {...root.STATUS_CATEGORY_LOOK.paused} />],
  ['SLA_STATE_LOOK', <root.StatusPill {...root.SLA_STATE_LOOK.due_soon} />],
  ['APPROVAL_STATE_LOOK', <root.StatusPill {...root.APPROVAL_STATE_LOOK.pending} />],
  ['PRIORITY_LOOK', <root.Badge tone={root.PRIORITY_LOOK.P2.tone}>{root.PRIORITY_LOOK.P2.words}</root.Badge>],
  ['TYPE_LOOK', <root.StatusPill {...root.TYPE_LOOK.incident} />],
  ['COMPONENT_STATE_LOOK', <root.StatusPill {...root.COMPONENT_STATE_LOOK.major_outage} />],
  ['PROBLEM_STATE_LOOK', <root.StatusPill {...root.PROBLEM_STATE_LOOK.known_error} />],
  ['MAJOR_INCIDENT_LOOK', <root.StatusPill {...root.MAJOR_INCIDENT_LOOK} />],
  ['Menu', <overlays.Menu trigger={<button type="button">More</button>} items={items} />],
  ['ContextMenu', <overlays.ContextMenu items={items}><div>row</div></overlays.ContextMenu>],
  ['Popover', <overlays.Popover trigger={<button type="button">Why?</button>}>x</overlays.Popover>],
  ['InfoTip', <overlays.InfoTip label="About Backlog" body="Open tickets in your teams." />],
  ['Sheet', <overlays.Sheet open={false} onOpenChange={noop} title="Rule">x</overlays.Sheet>],
  ['ConfirmDialog', <overlays.ConfirmDialog open={false} onOpenChange={noop} spec={{ title: 'Delete rule?', confirmLabel: 'Delete rule' }} onConfirm={resolved} />],
  ['ConflictDialog', <overlays.ConflictDialog open={false} onOpenChange={noop} entityLabel="INC-000123" changes={[]} onApplyMine={resolved} onKeepTheirs={noop} />],
  ['Toaster', <overlays.Toaster />],
  ['PersonPicker', <overlays.PersonPicker value={null} onChange={noop} loadPeople={async () => []} />],
  ['DateRangePicker', <overlays.DateRangePicker value={null} onChange={noop} />],
  ['SplitButton', <overlays.SplitButton primary={action} items={items} />],
  ['DataTable', <data.DataTable caption="Rules" columns={[{ id: 'name', header: 'Name', field: 'name' }]} rows={[{ key: 'a', name: 'VIP' }]} rowKey="key" />],
  ['FilterBar', <data.FilterBar filters={[]} values={{}} urlKey="rules" />],
  ['FilterChip', <data.FilterChip label="Status" active={false}>x</data.FilterChip>],
  ['BulkActionBar', <data.BulkActionBar count={3} noun={plural} actions={[action]} onAction={noop} onClear={noop} />],
  ['LoadMore', <data.LoadMore hasMore onLoadMore={noop} shown={100} noun={plural} />],
  ['OlderNewer', <data.OlderNewer />],
  ['ViewMenu', <data.ViewMenu />],
  ['StatCard', <charts.StatCard label="Open tickets" value={null} />],
  ['StatGrid', <charts.StatGrid>x</charts.StatGrid>],
  ['Sparkline', <charts.Sparkline values={[1, 2]} label="Rising, 1 → 2" />],
  ['LineChart', <charts.LineChart title="Created" series={[]} xType="time" />],
  ['AreaChart', <charts.AreaChart title="Created" series={[]} xType="time" />],
  ['BarChart', <charts.BarChart title="By team" data={[]} />],
  ['DonutChart', <charts.DonutChart title="By channel" segments={[]} />],
  ['ProgressRing', <charts.ProgressRing value={0.5} label="Half" />],
  ['ChartFigure', <charts.ChartFigure title="Created" summary="Flat" table={{ columns: [], rows: [] }}>x</charts.ChartFigure>],
  ['TopBar', <shell.TopBar />],
  ['TabBar', <shell.TabBar items={[{ id: 'home', label: 'Home', href: '/' }]} />],
  ['BottomDock', <shell.BottomDock />],
  ['SplitView', <shell.SplitView panes={[{ id: 'list', label: 'Tickets', min: 320, children: 'x' }]} />],
  ['SearchTrigger', <shell.SearchTrigger placeholder="Search" onOpen={noop} />],
  ['UserMenu', <shell.UserMenu name="Ada Lovelace" signOut={{ action: '/api/session/logout' }} />],
  ['NotificationCenter', <shell.NotificationCenter unread={0} load={async () => ({ items: [], unread: 0 })} markRead={resolved} hrefFor={() => '/'} />],
  ['PageHeader', <shell.PageHeader title="Rules" />],
  ['Breadcrumbs', <shell.Breadcrumbs items={[{ label: 'Rules', href: '/rules' }, { label: 'VIP' }]} />],
  ['TabNav', <shell.TabNav label="Sections" items={[{ id: 'a', label: 'All', href: '/rules' }]} />],
  ['HierNav', <shell.HierNav label="Classes" items={[{ id: 'a', label: 'Servers', href: '/cmdb' }]} />],
  ['RouteProgress', <shell.RouteProgress />],
  ['RouteFocus', <shell.RouteFocus />],
  ['SkipLinks', <shell.SkipLinks links={[{ label: 'Skip to content', targetId: 'main' }]} />],
  ['ShortcutsDialog', <shell.ShortcutsDialog open={false} onOpenChange={noop} />],
];

describe('every catalogue component', () => {
  it.each(stubs)('%s renders on the server with only its required props', (_name, element) => {
    expect(() => serverRender(element)).not.toThrow();
  });

  it('has a case above for every new component in the surface, so none can skip this check', () => {
    // Components that predate the redesign have their own tests, and the provider wraps every case.
    const existing = new Set([
      'AiSuggestionCard', 'AppShell', 'Avatar', 'Badge', 'Button', 'Card', 'Checkbox', 'Combobox', 'CommandPalette',
      'DatePicker', 'Dialog', 'EmptyState', 'FormField', 'FormRenderer', 'IconButton', 'Input', 'InteractiveTable',
      'ItsmProvider', 'Metric', 'MetricGrid', 'RadioGroup', 'RichText', 'Select', 'Skeleton', 'SkeletonText',
      'SlaClock', 'StaticTable', 'Switch', 'Table', 'Tabs', 'Textarea', 'ThemeProvider', 'Tile', 'TileGrid',
      'Timeline', 'Tooltip', 'VisuallyHidden',
    ]);
    const components = new Set(Object.values(surface).flat().filter((name) => /^[A-Z]/.test(name) && !existing.has(name)));
    const cases = stubs.map(([name]) => name);
    expect([...components].filter((name) => !cases.includes(name))).toEqual([]);
    expect(new Set(cases).size).toBe(cases.length);
  });

  it('keeps useItsm a loud failure outside the provider', () => {
    function Reader(): ReactElement {
      root.useItsm();
      return <span />;
    }
    expect(() => renderToStaticMarkup(<Reader />)).toThrow(/ItsmProvider/);
  });

  it('carries the empty-state vocabulary a server component hands to a client one', () => {
    // Serialisable: survives the JSON round trip React makes at the boundary.
    expect(JSON.parse(JSON.stringify(empty))).toEqual(empty);
  });
});

describe('the icon registry', () => {
  const icons = join(dirname(createRequire(import.meta.url).resolve('lucide/package.json')), 'dist/esm/icons');

  it('names only icons that exist in lucide, by the file they are deep-imported from', () => {
    const missing = Object.values(iconRegistry).filter((file) => !existsSync(join(icons, `${file}.mjs`)));
    expect(missing).toEqual([]);
  });

  it('uses kebab-case names, so a name reads the same in props, CSS and data', () => {
    expect(Object.keys(iconRegistry).filter((name) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))).toEqual([]);
  });
});

/*
 * Root barrel rule 1 (SPEC §3.1): nothing the root entry reaches statically
 * imports Radix, TanStack or sonner. Static imports only — a root component
 * may `import()` an overlay on intent — and type-only imports are erased. The
 * three deprecated re-exports are the rule's stated exception: tree-shaking
 * drops them from routes that do not use them, and the bundle check proves it.
 */
describe('the root entry', () => {
  const heavy = /^(?:@radix-ui\/|@tanstack\/|sonner$)/;
  const exempt = new Set(['web/CommandPalette.tsx', 'web/InteractiveTable.tsx', 'forms/FormRenderer.tsx']);

  function resolveModule(from: string, specifier: string): string | null {
    const base = resolve(dirname(from), specifier.replace(/\.js$/, ''));
    for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) if (existsSync(candidate)) return candidate;
    return null;
  }

  function staticImports(file: string): string[] {
    const text = readFileSync(file, 'utf8');
    const found: string[] = [];
    for (const match of text.matchAll(/^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm)) {
      found.push(match[1]!);
    }
    return found;
  }

  it('reaches no Radix, TanStack or sonner module', () => {
    const seen = new Set<string>();
    const offenders: string[] = [];
    const queue = [join(source, 'index.ts')];
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const relativePath = file.slice(source.length);
      if (exempt.has(relativePath)) continue;
      for (const specifier of staticImports(file)) {
        if (heavy.test(specifier)) offenders.push(`${relativePath} → ${specifier}`);
        else if (specifier.startsWith('.')) {
          const next = resolveModule(file, specifier);
          if (next) queue.push(next);
        }
      }
    }
    expect(seen.size).toBeGreaterThan(50);
    expect(offenders).toEqual([]);
  });
});
