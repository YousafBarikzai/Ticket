// @vitest-environment jsdom
import { useState, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestProvider } from '../../provider/__tests__/support/provider.js';
import { expectNoViolations } from '../../web/__tests__/support/audit.js';
import { activeElement, cleanupDocument, click, focus, press, render } from '../../web/__tests__/support/render.js';
import { FilterPills, planPillOverflow, type FilterPillOption, type FilterPillsProps } from '../FilterPills.js';
import { filterPillsStyles } from '../FilterPills.styles.js';

/*
 * FilterPills (v3 §2.14, A1 §7.6): three modes with their keyboard
 * promises, counts through the shared `Count` (capped and spoken), tone
 * icons, the summary that describes the group, a row that wraps and never
 * scrolls, and the phone cap — two lines, the rest behind "More".
 */

// The provider mounts its Toaster lazily once the page is idle; these tests are not about it.
vi.mock('../../overlays/Toaster.js', () => ({ Toaster: () => null }));

afterEach(() => {
  cleanupDocument();
  vi.restoreAllMocks();
  delete (window as { matchMedia?: unknown }).matchMedia;
});

/** What a screen reader hears: the text, less anything hidden from assistive technology. */
function spoken(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (node instanceof Element && node.getAttribute('aria-hidden') === 'true') return '';
  return [...node.childNodes].map(spoken).join('');
}

const STATUS: readonly FilterPillOption[] = [
  { value: 'all', label: 'All', count: 16, href: '/inbox' },
  { value: 'new', label: 'New', count: 4, href: '/inbox?status=new' },
  { value: 'progress', label: 'In progress', count: 7, href: '/inbox?status=progress' },
  { value: 'breached', label: 'Breached', count: 1, tone: 'danger', href: '/inbox?sla=breached' },
  { value: 'unassigned', label: 'Unassigned', count: 120, href: '/inbox?assignee=none' },
  { value: 'waiting', label: 'Waiting', count: null, disabled: true },
];

const pills = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.itsm-FilterPills__pill:not(.itsm-FilterPills__more)')];
const radios = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[role="radio"]')];

function Single({ onValueChange, initial = 'all' }: { readonly onValueChange?: (value: string) => void; readonly initial?: string }): ReactNode {
  const [value, setValue] = useState(initial);
  return (
    <FilterPills
      label="Filter by status"
      mode="single"
      options={STATUS}
      value={value}
      onValueChange={(next) => {
        onValueChange?.(next as string);
        setValue(next as string);
      }}
    />
  );
}

function Toggle({ onValueChange }: { readonly onValueChange?: (value: readonly string[]) => void }): ReactNode {
  const [value, setValue] = useState<readonly string[]>(['mine']);
  return (
    <FilterPills
      label="Narrow the queue"
      mode="toggle"
      value={value}
      options={[
        { value: 'mine', label: 'Mine', count: 9 },
        { value: 'unassigned', label: 'Unassigned', count: 6 },
        { value: 'breached', label: 'Breached', count: 1, tone: 'danger', icon: 'circle-alert' },
        { value: 'p1p2', label: 'P1/P2', count: 2, disabled: true },
      ]}
      onValueChange={(next) => {
        onValueChange?.(next as readonly string[]);
        setValue(next as readonly string[]);
      }}
    />
  );
}

describe('FilterPills', () => {
  describe('mode="nav"', () => {
    it('is a named nav of links, the current one marked, a disabled one reachable but inert', () => {
      render(
        <TestProvider>
          <FilterPills label="Filter by status" mode="nav" options={STATUS} value="new" />
        </TestProvider>,
      );
      const nav = document.querySelector('nav')!;
      expect(nav.getAttribute('aria-label')).toBe('Filter by status');
      const links = [...nav.querySelectorAll<HTMLAnchorElement>('a')];
      expect(links.map((link) => link.getAttribute('href'))).toEqual(['/inbox', '/inbox?status=new', '/inbox?status=progress', '/inbox?sla=breached', '/inbox?assignee=none']);
      expect(links.map((link) => link.getAttribute('aria-current'))).toEqual([null, 'page', null, null, null]);
      expect(links[1]!.hasAttribute('data-on')).toBe(true);
      const disabled = nav.querySelector('[role="link"][aria-disabled="true"]');
      expect(disabled?.textContent).toBe('Waiting');
      expect(nav.querySelectorAll('ul > li')).toHaveLength(6);
      // No "More" on a wide screen: the row simply wraps.
      expect(document.querySelector('.itsm-FilterPills__more')).toBeNull();
    });

    it('speaks each count with its label, capped at 99+ for the eye and "more than 99" for the ear', () => {
      render(<FilterPills label="Filter by status" mode="nav" options={STATUS} value="all" />);
      const [all, , , breached, unassigned] = pills();
      expect(spoken(all!)).toBe('All, 16');
      expect(spoken(breached!)).toBe('Breached, 1');
      expect(unassigned!.querySelector('.itsm-Count [aria-hidden="true"]')?.textContent).toBe('99+');
      expect(spoken(unassigned!)).toBe('Unassigned, more than 99');
      // The current pill's count is accent; the others neutral; a null count is not drawn.
      expect(all!.querySelector('.itsm-Count')?.getAttribute('data-tone')).toBe('accent');
      expect(breached!.querySelector('.itsm-Count')?.getAttribute('data-tone')).toBe('neutral');
      expect(pills()[5]!.querySelector('.itsm-Count')).toBeNull();
    });

    it('draws a capped API count as "12+" and says "12 or more"', () => {
      render(<FilterPills label="Scope" mode="nav" value="a" options={[{ value: 'a', label: 'Open', count: 12, countCapped: true, href: '/a' }]} />);
      expect(pills()[0]!.querySelector('.itsm-Count [aria-hidden="true"]')?.textContent).toBe('12+');
      expect(spoken(pills()[0]!)).toBe('Open, 12 or more');
    });
  });

  describe('mode="toggle"', () => {
    it('is a named group of pressed buttons that combine', () => {
      const onValueChange = vi.fn();
      render(<Toggle onValueChange={onValueChange} />);
      const group = document.querySelector('[role="group"]')!;
      expect(group.getAttribute('aria-label')).toBe('Narrow the queue');
      expect(pills().map((pill) => pill.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false']);
      click(pills()[1]!);
      expect(onValueChange).toHaveBeenLastCalledWith(['mine', 'unassigned']);
      click(pills()[0]!);
      expect(onValueChange).toHaveBeenLastCalledWith(['unassigned']);
      expect(pills().map((pill) => pill.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false', 'false']);
    });

    it('keeps a disabled pill focusable and never changes it', () => {
      const onValueChange = vi.fn();
      render(<Toggle onValueChange={onValueChange} />);
      const disabled = pills()[3]!;
      expect(disabled.getAttribute('aria-disabled')).toBe('true');
      expect(disabled.hasAttribute('disabled')).toBe(false);
      click(disabled);
      expect(onValueChange).not.toHaveBeenCalled();
    });

    it('draws the tone’s icon before the label', () => {
      render(<Toggle />);
      const breached = pills()[2]!;
      expect(breached.getAttribute('data-tone')).toBe('danger');
      expect(breached.firstElementChild?.getAttribute('data-icon')).toBe('circle-alert');
      expect(breached.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
    });
  });

  describe('mode="single"', () => {
    it('is a named radiogroup with one tab stop on the chosen pill', () => {
      render(<Single initial="progress" />);
      expect(document.querySelector('[role="radiogroup"]')?.getAttribute('aria-label')).toBe('Filter by status');
      expect(radios().map((radio) => radio.tabIndex)).toEqual([-1, -1, 0, -1, -1, -1]);
      expect(radios()[2]!.getAttribute('aria-checked')).toBe('true');
    });

    it('moves focus with the arrows without choosing, and chooses with Space, Enter or a click', () => {
      const onValueChange = vi.fn();
      render(<Single onValueChange={onValueChange} />);
      focus(radios()[0]!);
      press(radios()[0]!, 'ArrowRight');
      expect(activeElement()).toBe(radios()[1]);
      expect(onValueChange).not.toHaveBeenCalled();
      press(radios()[1]!, ' ');
      expect(onValueChange).toHaveBeenLastCalledWith('new');
      press(radios()[1]!, 'ArrowRight');
      press(radios()[2]!, 'Enter');
      expect(onValueChange).toHaveBeenLastCalledWith('progress');
      click(radios()[3]!);
      expect(onValueChange).toHaveBeenLastCalledWith('breached');
      expect(onValueChange).toHaveBeenCalledTimes(3);
    });

    it('skips a disabled pill with the arrows and never chooses it', () => {
      const onValueChange = vi.fn();
      render(<Single onValueChange={onValueChange} initial="unassigned" />);
      focus(radios()[4]!);
      press(radios()[4]!, 'ArrowRight');
      // "Waiting" is disabled: the arrow wraps round to "All".
      expect(activeElement()).toBe(radios()[0]);
      click(radios()[5]!);
      press(radios()[5]!, 'Enter');
      expect(onValueChange).not.toHaveBeenCalled();
    });

    it('says nothing when the chosen pill is pressed again', () => {
      const onValueChange = vi.fn();
      render(<Single onValueChange={onValueChange} />);
      click(radios()[0]!);
      expect(onValueChange).not.toHaveBeenCalled();
    });
  });

  it('shows the summary after the pills and describes the group with it', () => {
    render(<FilterPills label="Filter by type" mode="nav" options={STATUS.slice(0, 2)} value="all" summary="Showing 16 of 294" />);
    const summary = document.querySelector('.itsm-FilterPills__summary')!;
    expect(summary.textContent).toBe('Showing 16 of 294');
    expect(document.querySelector('nav')?.getAttribute('aria-describedby')).toBe(summary.id);
  });

  it('renders on the server, with no "More" until the client knows the width', () => {
    const markup = renderToStaticMarkup(<FilterPills label="Filter by status" mode="single" options={STATUS} value="all" />);
    expect(markup).toContain('role="radiogroup"');
    expect(markup).not.toContain('itsm-FilterPills__more');
  });

  it('reserves each label’s bold width, so turning a pill on never nudges the row', () => {
    render(<FilterPills label="Scope" mode="nav" options={STATUS} value="all" />);
    expect(pills()[2]!.querySelector('.itsm-FilterPills__label')?.getAttribute('data-text')).toBe('In progress');
  });
});

describe('the FilterPills stylesheet', () => {
  const rule = (selector: string): string => {
    const start = filterPillsStyles.indexOf(`${selector} {`);
    return start < 0 ? '' : filterPillsStyles.slice(start, filterPillsStyles.indexOf('}', start));
  };

  it('wraps and never scrolls sideways', () => {
    expect(rule('.itsm-FilterPills__list')).toContain('flex-wrap: wrap');
    expect(filterPillsStyles).not.toMatch(/overflow-x:\s*(auto|scroll)/);
  });

  it('draws 28 px pills with a border.soft edge, and the on pill in the brand tint with an accent edge at 28 %', () => {
    expect(rule('.itsm-FilterPills')).toContain('--_h: var(--itsm-control-height-sm)');
    expect(rule('.itsm-FilterPills__pill')).toContain('border: var(--itsm-border-hair) solid var(--itsm-colour-border-soft)');
    expect(rule('.itsm-FilterPills__pill')).toContain('border-radius: var(--itsm-radius-pill)');
    const on = rule('.itsm-FilterPills__pill[data-on]');
    expect(on).toContain('background-color: var(--itsm-colour-brand-subtle)');
    expect(on).toContain('color-mix(in srgb, var(--itsm-colour-accent) 28%, transparent)');
    expect(on).toContain('color: var(--itsm-colour-brand-subtleText)');
    expect(rule('.itsm-FilterPills__pill[data-on] .itsm-Count')).toContain('--_itsm-count-bg: var(--itsm-colour-surface-raised)');
  });

  it('parks an overflowing pill out of the flow and out of sight, still measurable', () => {
    const parked = rule('.itsm-FilterPills__item[data-overflow]');
    expect(parked).toContain('position: absolute');
    expect(parked).toContain('visibility: hidden');
    expect(parked).not.toContain('display: none');
  });

  it('marks the on pill in Highlight under forced colours and with the full accent when more contrast is asked for', () => {
    expect(filterPillsStyles).toMatch(/@media \(forced-colors: active\) \{[\s\S]*\.itsm-FilterPills__pill\[data-on\] \{[^}]*background-color: Highlight/);
    expect(filterPillsStyles).toContain(':root[data-itsm-theme="high-contrast"] .itsm-FilterPills__pill[data-on] { border-color: var(--itsm-colour-accent); }');
  });
});

describe('planPillOverflow', () => {
  const plan = (input: Partial<Parameters<typeof planPillOverflow>[0]> & { readonly widths: readonly number[] }): number[] =>
    planPillOverflow({ keep: input.widths.map(() => false), more: 60, available: 300, gap: 6, ...input });

  it('hides nothing when the row fits on two lines', () => {
    expect(plan({ widths: [90, 90, 90, 90, 90, 90] })).toEqual([]);
  });

  it('hides pills from the end until the rest and "More" fit on two lines', () => {
    // Three 90 px pills a line at 300 px; eight pills make three lines.
    expect(plan({ widths: [90, 90, 90, 90, 90, 90, 90, 90] })).toEqual([5, 6, 7]);
  });

  it('never hides a pill that must stay in view, hiding an earlier one instead', () => {
    const keep = [false, false, false, false, false, false, false, true];
    expect(plan({ widths: [90, 90, 90, 90, 90, 90, 90, 90], keep })).toEqual([4, 5, 6]);
  });

  it('counts the gap between pills', () => {
    // 3 × 96 + 2 × 6 = 300: three a line, exactly; one more pixel of gap makes it two a line.
    expect(plan({ widths: [96, 96, 96, 96, 96, 96], gap: 6 })).toEqual([]);
    expect(plan({ widths: [96, 96, 96, 96, 96, 96, 96], gap: 7, more: 96 })).toEqual([3, 4, 5, 6]);
  });

  it('hides nothing it cannot measure', () => {
    expect(plan({ widths: [90, 90, 90, 90, 90, 90, 90, 90], available: 0 })).toEqual([]);
    expect(plan({ widths: [] })).toEqual([]);
  });

  it('stops when only kept pills are left, rather than looping', () => {
    expect(plan({ widths: [200, 200, 200, 200], keep: [true, true, true, false], available: 210 })).toEqual([3]);
  });
});

describe('FilterPills on a phone', () => {
  /** A phone: `(min-width: 48rem)` does not match, and every pill and the "More" button are 90 px in a 300 px row. */
  function phoneLayout(): void {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }),
    });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('itsm-FilterPills') ? 300 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const sized = this.hasAttribute('data-pill-item') || this.hasAttribute('data-pill-more');
      return new DOMRect(0, 0, sized ? 90 : 0, 28);
    });
  }

  const MANY: readonly FilterPillOption[] = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'].map((label) => ({
    value: label.toLowerCase(),
    label,
    href: `/x?f=${label.toLowerCase()}`,
  }));

  const parkedLabels = (): string[] =>
    [...document.querySelectorAll<HTMLElement>('[data-pill-item][data-overflow]')].map((item) => item.querySelector('.itsm-FilterPills__label')?.getAttribute('data-text') ?? '');

  function more(): HTMLButtonElement {
    return document.querySelector<HTMLButtonElement>('.itsm-FilterPills__more')!;
  }

  it('keeps two lines and puts the rest behind "More", which shows them in place', () => {
    phoneLayout();
    render(<FilterPills label="Filter" mode="nav" options={MANY} value="one" />);
    expect(parkedLabels()).toEqual(['Six', 'Seven', 'Eight']);
    expect(more().getAttribute('aria-expanded')).toBe('false');
    expect(more().closest('[data-overflow]')).toBeNull();
    expect(spoken(more())).toBe('More filters, 3');
    expect(more().getAttribute('aria-controls')).toBe(document.querySelector('nav ul')!.id);
    click(more());
    expect(more().getAttribute('aria-expanded')).toBe('true');
    expect(parkedLabels()).toEqual([]);
    expect(spoken(more())).toBe('More filters');
    click(more());
    expect(parkedLabels()).toEqual(['Six', 'Seven', 'Eight']);
  });

  it('never parks the filter in force', () => {
    phoneLayout();
    render(<FilterPills label="Filter" mode="nav" options={MANY} value="eight" />);
    expect(parkedLabels()).toEqual(['Five', 'Six', 'Seven']);
  });

  it('keeps parked pills out of reach of the arrows in a radio group', () => {
    phoneLayout();
    render(<FilterPills label="Filter" mode="single" options={MANY} value="four" onValueChange={() => undefined} />);
    expect(parkedLabels()).toEqual(['Six', 'Seven', 'Eight']);
    const group = radios();
    focus(group[4]!);
    press(group[4]!, 'ArrowRight');
    // "Six" to "Eight" are behind "More": the arrow wraps to "One".
    expect(activeElement()).toBe(group[0]);
  });

  it('parks "More" itself, out of the tab order, when everything fits', () => {
    phoneLayout();
    render(<FilterPills label="Filter" mode="toggle" options={MANY.slice(0, 4)} value={[]} onValueChange={() => undefined} />);
    expect(parkedLabels()).toEqual([]);
    expect(more().hasAttribute('data-overflow')).toBe(true);
    expect(more().tabIndex).toBe(-1);
  });
});

describe('FilterPills audit', () => {
  const props: Omit<FilterPillsProps, 'mode' | 'value'> = { label: 'Filter by status', options: STATUS, summary: 'Showing 16 of 294' };

  it('passes axe in every mode, with counts, a tone, a disabled pill and a summary', async () => {
    render(
      <TestProvider>
        <FilterPills {...props} mode="nav" value="new" />
        <FilterPills {...props} label="Narrow the queue" mode="toggle" value={['breached']} onValueChange={() => undefined} />
        <FilterPills {...props} label="Show" mode="single" size="sm" value="all" onValueChange={() => undefined} />
      </TestProvider>,
    );
    await expectNoViolations(document.body);
  });

  it('passes axe on a phone with "More" showing and expanded', async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }),
    });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('itsm-FilterPills') ? 200 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return new DOMRect(0, 0, this.hasAttribute('data-pill-item') || this.hasAttribute('data-pill-more') ? 90 : 0, 28);
    });
    render(
      <TestProvider>
        <FilterPills {...props} mode="single" value="all" onValueChange={() => undefined} />
      </TestProvider>,
    );
    expect(document.querySelector('.itsm-FilterPills__more')?.closest('[data-overflow]')).toBeNull();
    await expectNoViolations(document.body);
    click(document.querySelector('.itsm-FilterPills__more')!);
    await expectNoViolations(document.body);
  });
});
