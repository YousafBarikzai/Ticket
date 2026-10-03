// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestProvider, testRouter } from '../../provider/__tests__/support/provider.js';
import { cleanupDocument, press, render } from '../../web/__tests__/support/render.js';
import { BarChart } from '../BarChart.js';
import { BulletList } from '../Bullet.js';
import { ChartReader, type ReaderPoint } from '../ChartReader.js';
import { DonutChart } from '../DonutChart.js';
import { LineChart } from '../LineChart.js';
import { READER_CORE_MARK, readingSentence } from '../reader-core.js';

afterEach(() => cleanupDocument());

/**
 * The reading layer (A8 §5, v2 X-69), as an island and a lazy core: one tab
 * stop, a group that says it is a chart and how to read it, the core fetched
 * on the first sign of intent with the keys pressed meanwhile replayed, then
 * arrow keys along the positions, a polite readout of every series there, a
 * pointer that finds the nearest position rather than asking for a 2 px
 * target, and Enter to follow a position's link. Its size and laziness are
 * pinned in `charts.test.tsx`, which runs where the bundler can.
 */

const points: ReaderPoint[] = ['1 Sep', '2 Sep', '3 Sep'].map((title, index) => ({
  key: title,
  title,
  at: [index / 2, 0],
  rows: [
    { id: 'raised', label: 'Raised', value: String(10 + index), slot: 1, y: 0.5 },
    { id: 'resolved', label: 'Resolved', value: String(5 + index), slot: 2, y: 0.7 },
  ],
  ...(index === 1 ? { href: '/tickets?day=2' } : {}),
}));

/** Lets the core land: the dynamic import settles, and React commits what it sets and replays. */
async function settle(): Promise<void> {
  await act(async () => {
    await vi.dynamicImportSettled();
    await Promise.resolve();
  });
}

function mount(element: ReactElement) {
  const { container } = render(element);
  const group = container.querySelector('.itsm-ChartReader') as HTMLElement;
  const live = group.querySelector('[aria-live="polite"]') as HTMLElement;
  return { container, group, live };
}

function island(mode: 'crosshair' | 'marks' = 'crosshair', extra: Partial<Parameters<typeof ChartReader>[0]> = {}, onOuterKeyDown?: (key: string) => void) {
  return mount(
    // A React handler around the chart, as a sheet or a collection would have.
    <div id="outer" onKeyDown={(event) => onOuterKeyDown?.(event.key)}>
      <ChartReader label="Volume" points={points} mode={mode} {...extra}>
        <svg aria-hidden="true">
          {points.map((point, index) => (
            <rect key={point.key} data-point={index} />
          ))}
        </svg>
      </ChartReader>
    </div>,
  );
}

/** The island with its core loaded, as it is once someone has focused or hovered it. */
async function reader(...args: Parameters<typeof island>) {
  const mounted = island(...args);
  act(() => mounted.group.focus());
  await settle();
  return mounted;
}

function pointer(target: Element, type: 'pointermove' | 'pointerdown' | 'pointerout', clientX = 0, clientY = 0): void {
  act(() => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, relatedTarget: type === 'pointerout' ? document.body : null }));
  });
}

describe('the island', () => {
  it('renders the group, its hint and the live region on the server, with no core and no reading', () => {
    const markup = renderToStaticMarkup(
      <ChartReader label="Volume" points={points} mode="crosshair">
        <svg aria-hidden="true" />
      </ChartReader>,
    );
    expect(markup).toMatch(/^<div class="itsm-ChartReader" role="group" aria-roledescription="chart" aria-label="Volume" aria-describedby="[^"]+" tabindex="0" data-reader="idle">/);
    expect(markup).toContain('hidden="">Use ← → to read values</span>');
    expect(markup).toContain('<span class="itsm-visually-hidden" aria-live="polite" aria-atomic="true"></span>');
    expect(markup).not.toContain('itsm-ChartReader__tip');
  });

  it('is one focusable group named by the chart, described by how to read it', () => {
    const { group } = island();
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-roledescription')).toBe('chart');
    expect(group.getAttribute('aria-label')).toBe('Volume');
    expect(group.tabIndex).toBe(0);
    expect(document.getElementById(group.getAttribute('aria-describedby')!)?.textContent).toBe('Use ← → to read values');
  });

  it('fetches the core on the first key and replays the keys pressed while it was on its way', async () => {
    const { group, live } = island();
    expect(group.getAttribute('data-reader')).toBe('idle');
    press(group, 'ArrowRight');
    press(group, 'ArrowRight');
    expect(group.getAttribute('data-reader')).toBe('loading');
    expect(live.textContent).toBe('');
    await settle();
    expect(group.getAttribute('data-reader')).toBe('ready');
    // Two steps from nowhere: the second position, read at once without a third key.
    expect(live.textContent).toBe('2 Sep: Raised 11, Resolved 6');
    expect(group.getAttribute('data-reader-core')).toBe(READER_CORE_MARK);
  });

  it('keeps at most eight keys, and only the reading ones', async () => {
    const { group, live } = island();
    for (let index = 0; index < 12; index++) press(group, 'ArrowRight');
    press(group, 'ArrowLeft');
    press(group, 'a');
    await settle();
    // Eight rights reach the end (3 Sep); the ninth key, ←, was not kept.
    expect(live.textContent).toBe('3 Sep: Raised 12, Resolved 7');
  });

  it('starts on focus and on the pointer arriving, and leaves ↑ ↓ to the page on a chart read across', async () => {
    const { group, live } = island();
    const down = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    act(() => {
      group.dispatchEvent(down);
    });
    expect(down.defaultPrevented).toBe(false);
    pointer(group, 'pointermove', 10, 10);
    expect(group.getAttribute('data-reader')).toBe('loading');
    await settle();
    expect(group.getAttribute('data-reader')).toBe('ready');
    expect(live.textContent).toBe('');
  });

  it('starts silent: the live region is empty until someone reads', async () => {
    const { live } = await reader();
    expect(live.textContent).toBe('');
    expect(live.getAttribute('aria-atomic')).toBe('true');
  });

  it('writes a reading as one sentence: the position, then each series and its value', () => {
    expect(readingSentence(points[1]!)).toBe('2 Sep: Raised 11, Resolved 6');
    expect(readingSentence({ ...points[0]!, rows: [{ id: 'x', label: '', value: '42' }] })).toBe('1 Sep: 42');
  });
});

describe('the keyboard crosshair', () => {
  it('moves with ← and →, reads each stop aloud, and stops at the ends', async () => {
    const { group, live } = await reader();
    press(group, 'ArrowRight');
    expect(live.textContent).toBe('1 Sep: Raised 10, Resolved 5');
    press(group, 'ArrowRight');
    expect(live.textContent).toBe('2 Sep: Raised 11, Resolved 6');
    press(group, 'ArrowRight');
    press(group, 'ArrowRight');
    expect(live.textContent).toBe('3 Sep: Raised 12, Resolved 7');
    press(group, 'ArrowLeft');
    expect(live.textContent).toBe('2 Sep: Raised 11, Resolved 6');
  });

  it('starts from the end when the first key is ←, and jumps with Home and End', async () => {
    const { group, live } = await reader();
    press(group, 'ArrowLeft');
    expect(live.textContent).toMatch(/^3 Sep/);
    press(group, 'Home');
    expect(live.textContent).toMatch(/^1 Sep/);
    press(group, 'End');
    expect(live.textContent).toMatch(/^3 Sep/);
  });

  it('draws the crosshair, a dot per series and the tooltip at the position', async () => {
    const { group } = await reader();
    press(group, 'ArrowRight');
    press(group, 'ArrowRight');
    const crosshair = group.querySelector('.itsm-ChartReader__crosshair') as HTMLElement;
    expect(crosshair.style.left).toBe('50%');
    expect(group.querySelectorAll('.itsm-ChartReader__dot')).toHaveLength(2);
    const tip = group.querySelector('.itsm-ChartReader__tip')!;
    expect(tip.querySelector('.itsm-ChartReader__tipTitle')?.textContent).toBe('2 Sep');
    // Value first and strong, the series name after it.
    expect([...tip.querySelectorAll('.itsm-ChartReader__tipRow')].map((row) => row.textContent)).toEqual(['11Raised', '6Resolved']);
    expect(group.querySelector('.itsm-ChartReader__overlay')?.getAttribute('aria-hidden')).toBe('true');
    expect(group.hasAttribute('data-reading')).toBe(true);
  });

  it('keys a tooltip row by tone and style as the mark is drawn', async () => {
    const toned: ReaderPoint[] = [{ key: 'a', title: 'Mon', at: [0, 0], rows: [{ id: 'p1', label: 'P1', value: '2', slot: 3, tone: 'danger' }, { id: 'plan', label: 'Plan', value: '4', slot: 'other', style: 'comparison' }] }];
    const { group } = await reader('marks', { points: toned });
    press(group, 'ArrowRight');
    const keys = [...group.querySelectorAll('.itsm-ChartReader__key')];
    expect(keys[0]!.getAttribute('data-tone')).toBe('danger');
    expect(keys[0]!.hasAttribute('data-slot')).toBe(false);
    expect(keys[1]!.getAttribute('data-style')).toBe('comparison');
  });

  it('turns the tooltip to the other side past the middle, so it stays in the chart', async () => {
    const { group } = await reader();
    press(group, 'End');
    expect(group.querySelector('.itsm-ChartReader__tip')?.getAttribute('data-side')).toBe('start');
    press(group, 'Home');
    expect(group.querySelector('.itsm-ChartReader__tip')?.getAttribute('data-side')).toBe('end');
  });

  it('clears on Escape without letting it reach the sheet around it — and lets it through when there was nothing to clear', async () => {
    const outer = vi.fn();
    const { group } = await reader('crosshair', {}, (key) => {
      if (key === 'Escape') outer();
    });
    press(group, 'ArrowRight');
    press(group, 'Escape');
    expect(group.querySelector('.itsm-ChartReader__tip')).toBeNull();
    expect(outer).not.toHaveBeenCalled();
    press(group, 'Escape');
    expect(outer).toHaveBeenCalledTimes(1);
  });

  it('leaves the arrow keys alone with a modifier, and ↑ ↓ alone on a chart read across', async () => {
    const { group, live } = await reader();
    press(group, 'ArrowRight', { metaKey: true });
    press(group, 'ArrowDown');
    expect(live.textContent).toBe('');
  });

  it('reads down the rows with ↑ and ↓ as well when the chart runs down', async () => {
    const { group, live } = await reader('marks', { axis: 'y' });
    expect(document.getElementById(group.getAttribute('aria-describedby')!)?.textContent).toBe('Use ↑ ↓ to read values');
    press(group, 'ArrowDown');
    press(group, 'ArrowDown');
    expect(live.textContent).toMatch(/^2 Sep/);
    press(group, 'ArrowUp');
    expect(live.textContent).toMatch(/^1 Sep/);
  });

  it('marks the mark being read, for the lift, and only that one', async () => {
    const { group } = await reader('marks');
    press(group, 'ArrowRight');
    press(group, 'ArrowRight');
    expect([...group.querySelectorAll('[data-point]')].map((mark) => mark.hasAttribute('data-active'))).toEqual([false, true, false]);
    expect(group.querySelector('.itsm-ChartReader__crosshair')).toBeNull();
  });

  it('forgets the reading when focus leaves', async () => {
    const { group } = await reader();
    press(group, 'ArrowRight');
    act(() => {
      group.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body }));
    });
    expect(group.querySelector('.itsm-ChartReader__tip')).toBeNull();
    expect(group.hasAttribute('data-reading')).toBe(false);
  });

  it('follows a position’s link with Enter, through the application’s router', async () => {
    const router = testRouter();
    const { group } = mount(
      <TestProvider router={router}>
        <ChartReader label="Volume" points={points} mode="crosshair">
          <svg aria-hidden="true" />
        </ChartReader>
      </TestProvider>,
    );
    press(group, 'Home');
    await settle();
    press(group, 'Enter');
    expect(router.push).not.toHaveBeenCalled();
    press(group, 'ArrowRight');
    press(group, 'Enter');
    expect(router.push).toHaveBeenCalledWith('/tickets?day=2');
  });
});

describe('the pointer', () => {
  function sized(group: HTMLElement): void {
    group.getBoundingClientRect = () => ({ left: 100, top: 50, width: 400, height: 200, right: 500, bottom: 250, x: 100, y: 50, toJSON: () => ({}) });
  }

  it('reads the position nearest the pointer, without announcing it', async () => {
    const { group, live } = await reader();
    sized(group);
    pointer(group, 'pointermove', 100 + 400 * 0.6, 120);
    expect(group.querySelector('.itsm-ChartReader__tipTitle')?.textContent).toBe('2 Sep');
    pointer(group, 'pointermove', 100 + 400 * 0.9, 120);
    expect(group.querySelector('.itsm-ChartReader__tipTitle')?.textContent).toBe('3 Sep');
    expect(live.textContent).toBe('');
  });

  it('reads a mark under the pointer, and nothing between marks when it only reads marks', async () => {
    const { group } = await reader('marks', { nearest: false });
    sized(group);
    pointer(group.querySelectorAll('[data-point]')[2]!, 'pointermove');
    expect(group.querySelector('.itsm-ChartReader__tipTitle')?.textContent).toBe('3 Sep');
    pointer(group, 'pointermove', 110, 60);
    expect(group.querySelector('.itsm-ChartReader__tip')).toBeNull();
  });

  it('reads on a tap, and clears when the pointer leaves', async () => {
    const { group } = await reader();
    sized(group);
    pointer(group, 'pointerdown', 101, 60);
    expect(group.querySelector('.itsm-ChartReader__tipTitle')?.textContent).toBe('1 Sep');
    pointer(group, 'pointerout');
    expect(group.querySelector('.itsm-ChartReader__tip')).toBeNull();
  });
});

describe('in the charts', () => {
  async function ready(container: HTMLElement): Promise<HTMLElement> {
    const group = container.querySelector('[aria-roledescription="chart"]') as HTMLElement;
    act(() => group.focus());
    await settle();
    return group;
  }

  it('reads a line chart’s dates and every series from the keyboard, forecasts named as such', async () => {
    const { container } = render(
      <LineChart
        title="Volume"
        interactive
        xType="time"
        series={[
          { id: 'r', label: 'Raised', points: [{ x: '2026-09-01', y: 12 }, { x: '2026-09-02', y: 1234 }, { x: '2026-09-03', y: 9 }] },
          { id: 's', label: 'Resolved', points: [{ x: '2026-09-01', y: 9 }, { x: '2026-09-02', y: null }, { x: '2026-09-03', y: 9 }] },
          { id: 'f', label: 'Next', style: 'forecast', points: [{ x: '2026-09-04', y: 11 }] },
        ]}
        hrefs={{ '2026-09-02': '/tickets?created=2026-09-02' }}
      />,
    );
    const group = await ready(container);
    press(group, 'Home');
    press(group, 'ArrowRight');
    expect(group.querySelector('[aria-live]')?.textContent).toMatch(/^Wed, 2 Sept? 2026: Raised 1,234, Resolved No data, Next No data$/);
    // A missing value has no dot to draw.
    expect(group.querySelectorAll('.itsm-ChartReader__dot')).toHaveLength(1);
    press(group, 'End');
    expect(group.querySelector('[aria-live]')?.textContent).toMatch(/Next 11 \(forecast\)$/);
  });

  it('reads a stacked bar part by part, with its total', async () => {
    const { container } = render(
      <BarChart
        title="Raised"
        orientation="vertical"
        interactive
        seriesDefs={[
          { id: 'i', label: 'Incidents', slot: 1 },
          { id: 'r', label: 'Requests', slot: 2 },
        ]}
        data={[{ id: 'mon', label: 'Mon', value: 0, series: { i: 3, r: 4 } }]}
      />,
    );
    const group = await ready(container);
    press(group, 'ArrowRight');
    expect(group.querySelector('[aria-live]')?.textContent).toBe('Mon: Incidents 3, Requests 4, Total 7');
    expect(group.querySelector('.itsm-BarChart__column[data-active]')).not.toBeNull();
  });

  it('reads a donut part with its share', async () => {
    const { container } = render(
      <DonutChart title="Channels" interactive segments={[{ id: 'e', label: 'Email', value: 3 }, { id: 'p', label: 'Portal', value: 1 }]} />,
    );
    const group = await ready(container);
    press(group, 'ArrowRight');
    expect(group.querySelector('[aria-live]')?.textContent).toBe('Email: 3 (75%)');
    expect(group.querySelector('.itsm-DonutChart__part[data-active]')).not.toBeNull();
  });

  it('reads a bullet list down its rows', async () => {
    const { container } = render(
      <BulletList
        title="By team"
        interactive
        rows={[
          { id: 'n', label: 'Network', value: 0.81, target: 0.9, format: { style: 'percent' } },
          { id: 'd', label: 'Desk', value: 0.92, target: 0.9, format: { style: 'percent' } },
        ]}
      />,
    );
    const group = await ready(container);
    press(group, 'ArrowDown');
    expect(group.querySelector('[aria-live]')?.textContent).toBe('Network: 81%, target 90%, 9 points below');
    press(group, 'ArrowDown');
    expect(group.querySelector('[aria-live]')?.textContent).toBe('Desk: 92%, target 90%, 2 points above');
    expect(group.querySelectorAll('.itsm-Bullet[data-active]')).toHaveLength(1);
  });
});
