// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanupDocument, press, render } from '../../web/__tests__/support/render.js';
import { BarChart } from '../BarChart.js';
import { ChartReader, readingSentence, type ReaderPoint } from '../ChartReader.js';
import { DonutChart } from '../DonutChart.js';
import { LineChart } from '../LineChart.js';

afterEach(() => cleanupDocument());

/**
 * The reading layer (SPEC §4.8, X-69): one tab stop, a group that says it is
 * a chart and how to read it, arrow keys along the positions, a polite live
 * readout of every series there, and a pointer that finds the nearest
 * position rather than asking for a 2 px target.
 */

const points: ReaderPoint[] = ['1 Sep', '2 Sep', '3 Sep'].map((title, index) => ({
  key: title,
  title,
  at: [index / 2, 0],
  rows: [
    { id: 'raised', label: 'Raised', value: String(10 + index), slot: 1, y: 0.5 },
    { id: 'resolved', label: 'Resolved', value: String(5 + index), slot: 2, y: 0.7 },
  ],
}));

function reader(mode: 'crosshair' | 'marks' = 'crosshair', extra: Partial<Parameters<typeof ChartReader>[0]> = {}, onOuterKeyDown?: (key: string) => void) {
  const { container } = render(
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
  const group = container.querySelector('.itsm-ChartReader') as HTMLElement;
  const live = group.querySelector('[aria-live="polite"]') as HTMLElement;
  return { container, group, live };
}

function pointer(target: Element, type: 'pointermove' | 'pointerdown' | 'pointerout', clientX = 0, clientY = 0): void {
  act(() => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, relatedTarget: type === 'pointerout' ? document.body : null }));
  });
}

describe('what a screen reader meets', () => {
  it('is one focusable group named by the chart, described by how to read it', () => {
    const { group } = reader();
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-roledescription')).toBe('chart');
    expect(group.getAttribute('aria-label')).toBe('Volume');
    expect(group.tabIndex).toBe(0);
    expect(document.getElementById(group.getAttribute('aria-describedby')!)?.textContent).toBe('Use ← → to read values');
  });

  it('starts silent: the live region is empty until someone reads', () => {
    const { live } = reader();
    expect(live.textContent).toBe('');
    expect(live.getAttribute('aria-atomic')).toBe('true');
  });

  it('writes a reading as one sentence: the position, then each series and its value', () => {
    expect(readingSentence(points[1]!)).toBe('2 Sep: Raised 11, Resolved 6');
    expect(readingSentence({ ...points[0]!, rows: [{ id: 'x', label: '', value: '42' }] })).toBe('1 Sep: 42');
  });
});

describe('the keyboard crosshair', () => {
  it('moves with ← and →, reads each stop aloud, and stops at the ends', () => {
    const { group, live } = reader();
    group.focus();
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

  it('starts from the end when the first key is ←, and jumps with Home and End', () => {
    const { group, live } = reader();
    press(group, 'ArrowLeft');
    expect(live.textContent).toMatch(/^3 Sep/);
    press(group, 'Home');
    expect(live.textContent).toMatch(/^1 Sep/);
    press(group, 'End');
    expect(live.textContent).toMatch(/^3 Sep/);
  });

  it('draws the crosshair, a dot per series and the tooltip at the position', () => {
    const { group } = reader();
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

  it('turns the tooltip to the other side past the middle, so it stays in the chart', () => {
    const { group } = reader();
    press(group, 'End');
    expect(group.querySelector('.itsm-ChartReader__tip')?.getAttribute('data-side')).toBe('start');
    press(group, 'Home');
    expect(group.querySelector('.itsm-ChartReader__tip')?.getAttribute('data-side')).toBe('end');
  });

  it('clears on Escape without letting it reach the sheet around it — and lets it through when there was nothing to clear', () => {
    const outer = vi.fn();
    const { group } = reader('crosshair', {}, (key) => {
      if (key === 'Escape') outer();
    });
    press(group, 'ArrowRight');
    press(group, 'Escape');
    expect(group.querySelector('.itsm-ChartReader__tip')).toBeNull();
    expect(outer).not.toHaveBeenCalled();
    press(group, 'Escape');
    expect(outer).toHaveBeenCalledTimes(1);
  });

  it('leaves the arrow keys alone with a modifier, and ↑ ↓ alone on a chart read across', () => {
    const { group, live } = reader();
    press(group, 'ArrowRight', { metaKey: true });
    press(group, 'ArrowDown');
    expect(live.textContent).toBe('');
  });

  it('reads down the rows with ↑ and ↓ as well when the chart runs down', () => {
    const { group, live } = reader('marks', { axis: 'y' });
    expect(document.getElementById(group.getAttribute('aria-describedby')!)?.textContent).toBe('Use ↑ ↓ to read values');
    press(group, 'ArrowDown');
    press(group, 'ArrowDown');
    expect(live.textContent).toMatch(/^2 Sep/);
    press(group, 'ArrowUp');
    expect(live.textContent).toMatch(/^1 Sep/);
  });

  it('marks the mark being read, for the lift, and only that one', () => {
    const { group } = reader('marks');
    press(group, 'ArrowRight');
    press(group, 'ArrowRight');
    expect([...group.querySelectorAll('[data-point]')].map((mark) => mark.hasAttribute('data-active'))).toEqual([false, true, false]);
    expect(group.querySelector('.itsm-ChartReader__crosshair')).toBeNull();
  });

  it('forgets the reading when focus leaves', () => {
    const { group } = reader();
    press(group, 'ArrowRight');
    act(() => {
      group.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body }));
    });
    expect(group.querySelector('.itsm-ChartReader__tip')).toBeNull();
  });
});

describe('the pointer', () => {
  function sized(group: HTMLElement): void {
    group.getBoundingClientRect = () => ({ left: 100, top: 50, width: 400, height: 200, right: 500, bottom: 250, x: 100, y: 50, toJSON: () => ({}) });
  }

  it('reads the position nearest the pointer, without announcing it', () => {
    const { group, live } = reader();
    sized(group);
    pointer(group, 'pointermove', 100 + 400 * 0.6, 120);
    expect(group.querySelector('.itsm-ChartReader__tipTitle')?.textContent).toBe('2 Sep');
    pointer(group, 'pointermove', 100 + 400 * 0.9, 120);
    expect(group.querySelector('.itsm-ChartReader__tipTitle')?.textContent).toBe('3 Sep');
    expect(live.textContent).toBe('');
  });

  it('reads a mark under the pointer, and nothing between marks when it only reads marks', () => {
    const { group } = reader('marks', { nearest: false });
    sized(group);
    pointer(group.querySelectorAll('[data-point]')[2]!, 'pointermove');
    expect(group.querySelector('.itsm-ChartReader__tipTitle')?.textContent).toBe('3 Sep');
    pointer(group, 'pointermove', 110, 60);
    expect(group.querySelector('.itsm-ChartReader__tip')).toBeNull();
  });

  it('reads on a tap, and clears when the pointer leaves', () => {
    const { group } = reader();
    sized(group);
    pointer(group, 'pointerdown', 101, 60);
    expect(group.querySelector('.itsm-ChartReader__tipTitle')?.textContent).toBe('1 Sep');
    pointer(group, 'pointerout');
    expect(group.querySelector('.itsm-ChartReader__tip')).toBeNull();
  });
});

describe('in the charts', () => {
  it('reads a line chart’s dates and every series from the keyboard', () => {
    const { container } = render(
      <LineChart
        title="Volume"
        interactive
        xType="time"
        series={[
          { id: 'r', label: 'Raised', points: [{ x: '2026-09-01', y: 12 }, { x: '2026-09-02', y: 1234 }] },
          { id: 's', label: 'Resolved', points: [{ x: '2026-09-01', y: 9 }, { x: '2026-09-02', y: null }] },
        ]}
      />,
    );
    const group = container.querySelector('[aria-roledescription="chart"]') as HTMLElement;
    press(group, 'End');
    expect(group.querySelector('[aria-live]')?.textContent).toMatch(/^Wed, 2 Sept? 2026: Raised 1,234, Resolved No data$/);
    // A missing value has no dot to draw.
    expect(group.querySelectorAll('.itsm-ChartReader__dot')).toHaveLength(1);
  });

  it('reads a stacked bar part by part, with its total', () => {
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
    const group = container.querySelector('[aria-roledescription="chart"]') as HTMLElement;
    press(group, 'ArrowRight');
    expect(group.querySelector('[aria-live]')?.textContent).toBe('Mon: Incidents 3, Requests 4, Total 7');
    expect(group.querySelector('.itsm-BarChart__column[data-active]')).not.toBeNull();
  });

  it('reads a donut part with its share', () => {
    const { container } = render(
      <DonutChart title="Channels" interactive segments={[{ id: 'e', label: 'Email', value: 3 }, { id: 'p', label: 'Portal', value: 1 }]} />,
    );
    const group = container.querySelector('[aria-roledescription="chart"]') as HTMLElement;
    press(group, 'ArrowRight');
    expect(group.querySelector('[aria-live]')?.textContent).toBe('Email: 3 (75%)');
    expect(group.querySelector('.itsm-DonutChart__part[data-active]')).not.toBeNull();
  });
});
