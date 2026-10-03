// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, forwardRef, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEMO_CAP_CATEGORIES,
  demoDisabledSentence,
  demoLimitSentence,
  isDemoFeature,
  type DemoFeature,
} from '@itsm/contracts/demo';

const router = { refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), forward: vi.fn() };
vi.mock('next/navigation', () => ({
  usePathname: () => '/integrations/credentials',
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(),
}));

const { ItsmProvider } = await import('@itsm/ui');
const { ViewOnly, DEMO_PILL } = await import('../components/ViewOnly.js');
const { DemoLock, DemoButton } = await import('../components/page/DemoLock.js');
const { PageProblem, demoProblemSentence } = await import('../components/page/PageProblem.js');
const { cleanupDocument, click, render } = await import('./support/render.js');

/**
 * The shared demo's locks in Administration (A7 §2.8, §11.1; SPEC §7.3): a
 * write the demo turns off is shown, disabled, with A3's sentence for its
 * feature — never hidden, never a vague "not allowed" — and a capped write
 * answers with A3's limit sentence. The sentences come from the copy register
 * (`@itsm/contracts/demo`), so these tests compare against it, not against a
 * copy of the words.
 */

/** Every feature Administration offers a control for (A7 §2.8's table). */
const ADMINISTRATION_FEATURES = [
  'integrations',
  'channels',
  'roles',
  'organisation',
  'modules',
  'feature-switches',
  'ai-settings',
  'audit-export',
  'status-page',
  'personas',
  'shared-dashboards',
] as const satisfies readonly DemoFeature[];

/* axe-core, resolved through `@itsm/ui` (as `deployment-warnings.test.tsx`). */
interface Axe {
  run(context: Element, options: Record<string, unknown>): Promise<{ violations: { id: string; nodes: { html: string }[] }[] }>;
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

const text = (element: Element | null | undefined): string => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

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
      usePathname={() => '/integrations/credentials'}
      useSearchParams={() => new URLSearchParams()}
      locale="en-GB"
      timeZone="Europe/London"
    >
      {children}
    </ItsmProvider>
  );
}

/** What a disabled button explains: the text its `aria-describedby` points at. */
function reasonOf(button: Element): string {
  const ids = (button.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
  return ids.map((id) => text(document.getElementById(id))).join(' ');
}

async function waitFor<T>(found: () => T | null | undefined, timeoutMs = 5_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = found();
    if (value !== null && value !== undefined && value !== '') return value;
    if (Date.now() > until) throw new Error('waitFor: timed out');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

afterEach(() => {
  cleanupDocument();
});

describe('the features Administration locks', () => {
  it('are all features the copy register knows', () => {
    expect(ADMINISTRATION_FEATURES.filter((feature) => !isDemoFeature(feature))).toEqual([]);
  });
});

describe.each(ADMINISTRATION_FEATURES)('%s', (feature) => {
  it('DemoLock shows the control, disabled with a lock, and gives A3’s sentence as its reason', () => {
    const { container } = render(
      <Frame>
        <DemoLock feature={feature} label="Add credential" icon="plus" />
      </Frame>,
    );
    const button = container.querySelector('button')!;
    expect(text(button)).toBe('Add credential');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    // Focusable, so the reason can be reached; not `disabled`.
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(button.hasAttribute('data-locked')).toBe(true);
    expect(button.getAttribute('data-demo-feature')).toBe(feature);
    expect(reasonOf(button)).toBe(demoDisabledSentence(feature));
  });

  it('ViewOnly demo reads "Turned off in the demo", and its popover gives A3’s sentence', async () => {
    const { container } = render(
      <Frame>
        <ViewOnly label="this rule" demo={feature} />
      </Frame>,
    );
    const pill = container.querySelector('button')!;
    expect(text(pill)).toBe(DEMO_PILL);
    expect(pill.textContent).not.toContain('View only');
    click(pill);
    const sentence = await waitFor(() => [...document.querySelectorAll('.itsm-PageHeader__viewOnlyText')].map(text).find(Boolean));
    expect(sentence).toBe(demoDisabledSentence(feature));
  });
});

describe('ViewOnly outside the demo', () => {
  it('is unchanged: "View only", and the permission it needs', async () => {
    const { container } = render(
      <Frame>
        <ViewOnly label="this rule" permission="rule.manage" />
      </Frame>,
    );
    const pill = container.querySelector('button')!;
    expect(text(pill)).toBe('View only');
    click(pill);
    const sentence = await waitFor(() => [...document.querySelectorAll('.itsm-PageHeader__viewOnlyText')].map(text).find(Boolean));
    expect(sentence).toMatch(/^You can see this rule but not change it\. Ask an administrator for /);
  });
});

describe('DemoButton', () => {
  it('is A7’s name for the same control', () => {
    expect(DemoButton).toBe(DemoLock);
  });
});

describe('a demo problem', () => {
  const limit = { status: 429, code: 'demo_limit' } as const;
  const disabled = { status: 403, code: 'demo_disabled' } as const;

  it.each(DEMO_CAP_CATEGORIES)('a demo_limit for %s renders demoLimitSentence', (category) => {
    const { container } = render(
      <Frame>
        <PageProblem problem={{ ...limit }} category={category} path="/rules" demo />
      </Frame>,
    );
    expect(text(container)).toContain(demoLimitSentence(category));
    // Waiting will not lift a cap: no retry is offered.
    expect([...container.querySelectorAll('button, a')].map(text)).not.toContain('Try again');
  });

  it('uses the API’s sentence when it is the contract’s, and never other words', () => {
    const sentence = demoLimitSentence('rule.change');
    expect(demoProblemSentence({ ...limit, detail: sentence })).toBe(sentence);
    expect(demoProblemSentence({ ...limit, detail: 'Too many rules, try later.' })).toBe(demoLimitSentence(null));
    expect(demoProblemSentence({ ...limit }, { category: 'writes', limit: 40 })).toBe(demoLimitSentence('writes', { limit: 40 }));
  });

  it('a demo_disabled renders the feature’s sentence', () => {
    expect(demoProblemSentence({ ...disabled }, { feature: 'audit-export' })).toBe(demoDisabledSentence('audit-export'));
    expect(demoProblemSentence({ ...disabled, detail: demoDisabledSentence('roles') })).toBe(demoDisabledSentence('roles'));
    expect(demoProblemSentence({ ...disabled })).toBe(demoDisabledSentence(null));
    const { container } = render(
      <Frame>
        <PageProblem problem={{ ...disabled }} feature="integrations" path="/integrations" />
      </Frame>,
    );
    expect(text(container)).toContain(demoDisabledSentence('integrations'));
  });

  it('is not a demo problem when it is anything else', () => {
    expect(demoProblemSentence({ status: 403, code: 'forbidden' })).toBeNull();
    expect(demoProblemSentence({ status: 429 })).toBeNull();
  });
});

describe('the way back after a session ends', () => {
  it('reopens the demo, back to this page, in a demo session (D22)', () => {
    const { container } = render(
      <Frame>
        <PageProblem problem={{ status: 401, code: 'demo_session_ended' }} path="/integrations/credentials" demo />
      </Frame>,
    );
    const link = [...container.querySelectorAll('a')].find((anchor) => text(anchor) === 'Continue the demo')!;
    expect(link.getAttribute('href')).toBe('/api/session/login?redirectTo=%2Fintegrations%2Fcredentials&demo=1');
  });

  it('signs a real account in again, back to this page', () => {
    const { container } = render(
      <Frame>
        <PageProblem problem={{ status: 401 }} path="/rules" />
      </Frame>,
    );
    const hrefs = [...container.querySelectorAll('a')].map((anchor) => anchor.getAttribute('href'));
    expect(hrefs).toContain('/api/session/login?redirectTo=%2Frules');
    expect(hrefs.some((href) => href?.includes('demo=1'))).toBe(false);
  });
});

describe.each(['apple', 'apple-dark'])('axe, in %s', (theme) => {
  it('the locks and a demo limit', async () => {
    const { container } = render(
      <Frame>
        <div data-itsm-theme={theme}>
          <DemoLock feature="integrations" label="Add credential" icon="plus" variant="primary" />
          <ViewOnly label="this rule" demo="roles" />
          <PageProblem problem={{ status: 429, code: 'demo_limit' }} category="rule.change" path="/rules" demo size="sm" />
        </div>
      </Frame>,
    );
    expect(await violations(container)).toEqual([]);
  });
});
