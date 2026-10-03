// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { createElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { keyFor } from '../keys.js';

/**
 * The two pieces of arithmetic and string work this console does before
 * showing somebody a number or storing a name they cannot change later —
 * and, at the end, how the system pages present themselves: the refusal a
 * gated page shows and the three route stand-ins (A7 §2.6, §8, §12), each
 * rendered and run through axe.
 */

describe('deriving a field key from its label', () => {
  it('camelCases the words', () => {
    expect(keyFor('Cost centre')).toBe('costCentre');
    expect(keyFor('Purchase order number')).toBe('purchaseOrderNumber');
  });

  it('drops punctuation rather than encoding it', () => {
    expect(keyFor("Manager's approval")).toBe('managersApproval');
    expect(keyFor('Cost centre (finance)')).toBe('costCentreFinance');
  });

  it('is empty for a label with nothing in it, so the form can refuse', () => {
    expect(keyFor('   ')).toBe('');
    expect(keyFor('!!!')).toBe('');
  });

  it('gives nothing when it cannot produce a key the API would accept', () => {
    // The API's rule is `^[a-z][a-zA-Z0-9]{0,63}$`. "1st line" camelCases to
    // `1stLine`, which starts with a digit and would be refused on save — so
    // the editor asks for a different label rather than offering a key that
    // looks fine and fails. `firstLine` would be an invention and `stLine`
    // nonsense.
    expect(keyFor('1st line')).toBe('');
    expect(keyFor('2024 budget')).toBe('');
  });

  it('still accepts a digit that is not first', () => {
    expect(keyFor('Line 2 support')).toBe('line2Support');
  });

  it('never exceeds the 64 characters the column allows', () => {
    expect(keyFor('a '.repeat(80)).length).toBeLessThanOrEqual(64);
  });
});

describe('an accented label', () => {
  it('folds accents rather than dropping the letter (F29)', () => {
    expect(keyFor('Café access')).toBe('cafeAccess');
    expect(keyFor('Numéro de série')).toBe('numeroDeSerie');
    expect(keyFor('Straße')).toBe('strasse');
  });

  it('keeps the plain ASCII cases exactly as they were', () => {
    expect(keyFor('Cost centre')).toBe('costCentre');
    expect(keyFor("Manager's approval")).toBe('managersApproval');
  });
});

/* =========================================================================
 * The system pages (A7 §8, T6) and the route stand-ins (A7 §12)
 * ====================================================================== */

const { ItsmProvider } = await import('@itsm/ui');
const { Forbidden } = await import('../components/Forbidden.js');
const { SlaPerformancePage } = await import('../components/sla-performance/SlaPerformancePage.js');
const { ChannelsView } = await import('../components/integrations/ChannelsView.js');
const { StatusPageConsole } = await import('../components/status-page/StatusPageConsole.js');
const { cleanupDocument, render } = await import('./support/render.js');

/** axe-core through `@itsm/ui`, as `deployment-warnings.test.tsx` explains (this app declares no copy of its own). */
interface AxeRule {
  readonly id: string;
  readonly nodes: readonly { readonly html: string }[];
}
const axe = createRequire(createRequire(import.meta.url).resolve('@itsm/ui'))('axe-core') as {
  run(context: Element, options: Record<string, unknown>): Promise<{ violations: AxeRule[] }>;
};
const AXE_OFF = ['region', 'page-has-heading-one', 'html-has-lang', 'landmark-one-main', 'bypass', 'document-title', 'html-lang-valid', 'color-contrast', 'color-contrast-enhanced', 'target-size'];
async function axeViolations(container: Element): Promise<string[]> {
  const results = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
    rules: Object.fromEntries(AXE_OFF.map((rule) => [rule, { enabled: false }])),
  });
  return results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.html).join(' | ')}`);
}

function inApp(element: ReactElement, theme: 'light' | 'dark' = 'light'): ReactElement {
  document.documentElement.dataset.theme = theme;
  return createElement(ItsmProvider, null, element);
}

afterEach(() => {
  cleanupDocument();
  delete document.documentElement.dataset.theme;
});

describe('the refusal a gated page shows', () => {
  it('keeps the page’s title, names the tab and the permission in words, and offers the way home', () => {
    const { container } = render(inApp(createElement(Forbidden, { route: '/sla/calendars' })));
    expect(container.textContent).toContain('Service levels › Calendars');
    expect(container.textContent).toContain('Go to the Command centre');
  });

  it('names a landing tab by its item alone', () => {
    const { container } = render(inApp(createElement(Forbidden, { route: '/sla' })));
    expect(container.textContent).not.toContain('Service levels › Policies');
  });

  it('is axe clean, light and dark', async () => {
    for (const theme of ['light', 'dark'] as const) {
      const { container } = render(inApp(createElement(Forbidden, { route: '/status-page' }), theme));
      expect(await axeViolations(container)).toEqual([]);
      cleanupDocument();
    }
  });
});

describe('the three route stand-ins', () => {
  const standIns = [
    { name: 'SLA performance', component: SlaPerformancePage },
    { name: 'Channels', component: ChannelsView },
    { name: 'Status page', component: StatusPageConsole },
  ];

  it('say what the page is for and offer a way on, without promising a date', () => {
    for (const standIn of standIns) {
      const { container } = render(inApp(createElement(standIn.component)));
      expect(container.querySelector('h2')?.textContent, standIn.name).toBe(standIn.name);
      expect(container.querySelector('a[href]'), standIn.name).not.toBeNull();
      expect(container.textContent, standIn.name).not.toMatch(/coming soon|soon/i);
      cleanupDocument();
    }
  });

  it('are axe clean, light and dark', async () => {
    for (const standIn of standIns) {
      for (const theme of ['light', 'dark'] as const) {
        const { container } = render(inApp(createElement(standIn.component), theme));
        expect(await axeViolations(container), `${standIn.name} (${theme})`).toEqual([]);
        cleanupDocument();
      }
    }
  });
});
