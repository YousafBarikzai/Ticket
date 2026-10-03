// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { structuralVariables } from '@itsm/ui/tokens';
import type { DeploymentWarningRow as Row } from '../components/platform/DeploymentWarnings.js';

vi.mock('server-only', () => ({}));

const requirePlatformOperator = vi.fn();
vi.mock('../server/session.js', () => ({ requirePlatformOperator }));

const { DeploymentWarnings, deploymentWarningsView } = await import('../components/platform/DeploymentWarnings.js');
const { default: PlatformLayout } = await import('../app/(console)/(platform)/layout.js');
const { cleanupDocument, render } = await import('./support/render.js');

/**
 * The operator's deployment warnings (D24, Y-M7; SPEC v3 §6.5): banners at
 * the top of every platform page while the deployment signs links with the
 * public development secret (or a short one), or the nightly demo build keeps
 * failing — and nothing at all otherwise, including when the list cannot be
 * read.
 */

/*
 * axe-core is the design system's devDependency; this app has none of its own
 * (adding one is a dependency line for an integrator, SPEC §15.0 rule 9). It
 * is resolved through `@itsm/ui`, so this audit runs the same axe the design
 * system's own tests run.
 */
interface AxeRule {
  readonly id: string;
  readonly nodes: readonly { readonly html: string }[];
}
/** The slice of axe-core's API used here; its types are not resolvable from this app either. */
interface Axe {
  run(context: Element, options: Record<string, unknown>): Promise<{ violations: AxeRule[]; passes: AxeRule[] }>;
}
const axe = createRequire(createRequire(import.meta.url).resolve('@itsm/ui'))('axe-core') as Axe;

/** Rules a detached fragment cannot answer, and rules that need a layout engine jsdom lacks. */
const OFF = ['region', 'page-has-heading-one', 'html-has-lang', 'landmark-one-main', 'bypass', 'document-title', 'html-lang-valid', 'color-contrast', 'color-contrast-enhanced', 'target-size'];
const AXE = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
  rules: Object.fromEntries(OFF.map((rule) => [rule, { enabled: false }])),
};

async function audit(container: Element): Promise<{ violations: string[]; passed: string[] }> {
  const results = await axe.run(container, AXE);
  return {
    violations: results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.html).join(' | ')}`),
    passed: results.passes.map((rule) => rule.id),
  };
}

const AT = '2026-10-02T09:00:00.000Z';
const secret = (service: string, code = 'dev_token_secret_default'): Row => ({ service, codes: [code], at: AT });
const failing = (failure: Row['failure'] | null = { step: 'checks', check: 'V3 attainment bands', failures: 3 }): Row => ({
  service: 'itsm-worker-data',
  codes: ['demo_build_failing'],
  at: '2026-10-01T00:05:00.000Z',
  ...(failure ? { failure } : {}),
});

/** The server component resolved as Next would, then mounted. */
async function show(load: () => Promise<readonly Row[]>): Promise<HTMLElement> {
  const element = await DeploymentWarnings({ load });
  return render(<div data-testid="host">{element}</div>).container;
}

const text = (element: Element | null | undefined): string => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const banners = (root: Element): Element[] => [...root.querySelectorAll('.itsm-Banner')];
const title = (banner: Element): string => text(banner.querySelector('.itsm-Banner__title'));

afterEach(() => {
  cleanupDocument();
  vi.clearAllMocks();
});

describe('DeploymentWarnings', () => {
  it('renders nothing when the list is empty', async () => {
    expect(await DeploymentWarnings({ load: async () => [] })).toBeNull();
    const container = await show(async () => []);
    expect(container.querySelector('[data-deployment-warnings]')).toBeNull();
    expect(text(container)).toBe('');
  });

  it('renders nothing when the call fails: it must not claim a problem it cannot see', async () => {
    expect(await DeploymentWarnings({ load: async () => Promise.reject(new Error('503 Service Unavailable')) })).toBeNull();
  });

  it('renders nothing for codes this release does not know', async () => {
    expect(await DeploymentWarnings({ load: async () => [secret('itsm-api', 'from_a_later_release')] })).toBeNull();
  });

  it('names every service still on the default secret in one danger banner', async () => {
    const container = await show(async () => [secret('itsm-worker-comms'), secret('itsm-api')]);
    const [banner, ...rest] = banners(container);
    expect(rest).toEqual([]);
    expect(banner?.getAttribute('data-tone')).toBe('danger');
    expect(banner?.getAttribute('role')).toBe('status');
    expect(title(banner!)).toBe('This deployment signs links with the public development secret');
    const lines = [...banner!.querySelectorAll('.itsm-Banner__body > p')].map(text);
    expect(lines).toEqual([
      'Anyone who has read this repository can forge survey and status-page links, and file upload and download links, on this deployment. Set DEV_TOKEN_SECRET to one long random value on api, worker-events, worker-engine, worker-comms and worker-data, then apply the changes.',
      'Still using it: itsm-api, itsm-worker-comms',
      'This notice clears within a minute of the last service restarting.',
    ]);
  });

  it('shows a failing demo build in its own danger banner, with where it stopped', async () => {
    const container = await show(async () => [failing()]);
    const [banner] = banners(container);
    expect(banners(container)).toHaveLength(1);
    expect(banner?.getAttribute('data-tone')).toBe('danger');
    expect(title(banner!)).toBe('The nightly demo build is failing');
    expect(text(banner!.querySelector('.itsm-Banner__body'))).toBe(
      'The demo keeps yesterday’s data. Last failure: checks · V3 attainment bands. See docs/runbooks/demo-operations.md.',
    );
  });

  it('words a demo failure that did not say where, or said only the step', async () => {
    const bare = await show(async () => [failing(null)]);
    expect(text(bare.querySelector('.itsm-Banner__body'))).toBe('The demo keeps yesterday’s data. See docs/runbooks/demo-operations.md.');
    cleanupDocument();
    const stepOnly = await show(async () => [failing({ step: 'tickets', check: null, failures: null })]);
    expect(text(stepOnly.querySelector('.itsm-Banner__body'))).toBe(
      'The demo keeps yesterday’s data. Last failure: tickets. See docs/runbooks/demo-operations.md.',
    );
  });

  it('calls a short secret a warning, not danger, and orders the banners by urgency', async () => {
    const container = await show(async () => [secret('itsm-api'), failing(), secret('itsm-worker-data', 'dev_token_secret_short')]);
    expect(banners(container).map((banner) => [banner.getAttribute('data-tone'), title(banner)])).toEqual([
      ['danger', 'This deployment signs links with the public development secret'],
      ['danger', 'The nightly demo build is failing'],
      ['warning', 'This deployment signs links with a short secret'],
    ]);
    expect(text(banners(container)[2])).toContain('Still using one: itsm-worker-data');
  });

  it('sits in the page column, spaced by a token the design system defines', async () => {
    const container = await show(async () => [secret('itsm-api')]);
    const stack = container.querySelector('[data-deployment-warnings]') as HTMLElement;
    expect(stack.classList.contains('app-Page')).toBe(true);
    const spacing = /^var\((--itsm-[a-z0-9-]+)\)$/.exec(stack.style.marginBlockEnd);
    expect(spacing?.[1]).toBeDefined();
    expect(Object.keys(structuralVariables())).toContain(spacing?.[1]);
  });

  it('is axe clean with every banner showing', async () => {
    const container = await show(async () => [secret('itsm-api'), secret('itsm-worker-comms'), failing(), secret('itsm-worker-engine', 'dev_token_secret_short')]);
    expect(banners(container)).toHaveLength(3);
    const { violations, passed } = await audit(container);
    expect(violations).toEqual([]);
    // Proof the engine looked: the status roles and the inline text were checked, not skipped.
    expect(passed).toEqual(expect.arrayContaining(['aria-allowed-role', 'aria-roles']));
  });
});

describe('deploymentWarningsView', () => {
  it('lists each service once, sorted, and only for the codes it reports', () => {
    expect(
      deploymentWarningsView([secret('itsm-worker-events'), secret('itsm-api'), secret('itsm-api'), secret('itsm-worker-data', 'dev_token_secret_short')]),
    ).toEqual({ defaultSecret: ['itsm-api', 'itsm-worker-events'], shortSecret: ['itsm-worker-data'], demoBuild: null });
  });

  it('is null when there is nothing to say', () => {
    expect(deploymentWarningsView([])).toBeNull();
  });
});

describe('the platform layout', () => {
  function children(tree: ReactNode): ReactElement[] {
    expect(isValidElement(tree)).toBe(true);
    const nested = (tree as ReactElement<{ children: ReactNode }>).props.children;
    return (Array.isArray(nested) ? nested : [nested]) as ReactElement[];
  }

  it('asks for the warnings only after the operator gate, with the operator’s own client', async () => {
    const deploymentWarnings = vi.fn(async () => [secret('itsm-api')]);
    requirePlatformOperator.mockResolvedValue({ api: { platform: { deploymentWarnings } } });

    const tree = await PlatformLayout({ children: <p>The page</p> });
    const [warnings, page] = children(tree);
    expect(warnings?.type).toBe(DeploymentWarnings);
    expect(text(render(page!).container)).toBe('The page');

    expect(deploymentWarnings).not.toHaveBeenCalled();
    await (warnings!.props as { load: () => Promise<unknown> }).load();
    expect(deploymentWarnings).toHaveBeenCalledTimes(1);
  });

  it('renders nothing, and asks for nothing, for somebody who is not an operator', async () => {
    const deploymentWarnings = vi.fn(async () => [secret('itsm-api')]);
    // `notFound()` throws; the layout must not get as far as the warnings.
    requirePlatformOperator.mockRejectedValue(Object.assign(new Error('NEXT_HTTP_ERROR_FALLBACK;404'), { digest: 'NEXT_HTTP_ERROR_FALLBACK;404' }));
    await expect(PlatformLayout({ children: <p>The page</p> })).rejects.toThrow('404');
    expect(deploymentWarnings).not.toHaveBeenCalled();
  });
});
