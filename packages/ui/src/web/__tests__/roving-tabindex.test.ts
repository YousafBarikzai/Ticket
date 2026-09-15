// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { activeElement, cleanupDocument, click, focus, press, render } from './support/render.js';
import { RadioGroupHarness, TabsHarness } from './support/fixtures.js';

afterEach(() => cleanupDocument());

const radios = (): readonly HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[role="radio"]')];
const tabs = (): readonly HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[role="tab"]')];
const tabIndexes = (elements: readonly HTMLElement[]): readonly number[] => elements.map((element) => element.tabIndex);

describe('RadioGroup roving tabindex', () => {
  it('exposes one tab stop, on the selected option', () => {
    render(createElement(RadioGroupHarness, {}));
    const group = document.querySelector('[role="radiogroup"]');
    expect(group?.getAttribute('aria-orientation')).toBe('vertical');
    // P3 is selected in the fixture, so it is the group's single tab stop.
    expect(tabIndexes(radios())).toEqual([-1, -1, 0, -1]);
  });

  it('moves and selects with the arrow keys, skipping disabled options', () => {
    const onSelect = vi.fn();
    render(createElement(RadioGroupHarness, { onSelect }));
    const items = radios();
    const third = items[2];
    if (!third) throw new Error('missing option');

    focus(third);
    press(third, 'ArrowDown');
    expect(onSelect).toHaveBeenLastCalledWith('p4');
    expect(activeElement()).toBe(items[3]);
    expect(items[3]?.getAttribute('aria-checked')).toBe('true');

    // Wrapping past the end lands on P1; P2 is disabled and is never a stop.
    press(items[3] ?? document, 'ArrowDown');
    expect(onSelect).toHaveBeenLastCalledWith('p1');
    press(items[0] ?? document, 'ArrowDown');
    expect(onSelect).toHaveBeenLastCalledWith('p3');
  });

  it('moves backwards with ArrowUp and to the ends with Home and End', () => {
    const onSelect = vi.fn();
    render(createElement(RadioGroupHarness, { onSelect }));
    const items = radios();
    const third = items[2];
    if (!third) throw new Error('missing option');

    focus(third);
    press(third, 'ArrowUp');
    // P2 is disabled, so ArrowUp from P3 reaches P1.
    expect(onSelect).toHaveBeenLastCalledWith('p1');

    press(items[0] ?? document, 'End');
    expect(activeElement()).toBe(items[3]);

    press(items[3] ?? document, 'Home');
    expect(activeElement()).toBe(items[0]);
  });

  it('keeps exactly one tab stop after the selection moves', () => {
    render(createElement(RadioGroupHarness, {}));
    const items = radios();
    const third = items[2];
    if (!third) throw new Error('missing option');

    focus(third);
    press(third, 'ArrowDown');
    expect(tabIndexes(radios()).filter((value) => value === 0)).toHaveLength(1);
    expect(tabIndexes(radios())).toEqual([-1, -1, -1, 0]);
  });

  it('selects with Space and Enter as well as by clicking', () => {
    const onSelect = vi.fn();
    render(createElement(RadioGroupHarness, { onSelect }));
    const first = radios()[0];
    if (!first) throw new Error('missing option');

    focus(first);
    press(first, ' ');
    expect(onSelect).toHaveBeenLastCalledWith('p1');

    const last = radios()[3];
    if (!last) throw new Error('missing option');
    click(last);
    expect(onSelect).toHaveBeenLastCalledWith('p4');
  });

  it('never selects a disabled option', () => {
    const onSelect = vi.fn();
    render(createElement(RadioGroupHarness, { onSelect }));
    const disabled = radios()[1];
    if (!disabled) throw new Error('missing option');

    expect(disabled.getAttribute('aria-disabled')).toBe('true');
    click(disabled);
    press(disabled, ' ');
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('Tabs roving tabindex', () => {
  it('starts with the selected tab as the only tab stop and shows its panel', () => {
    render(createElement(TabsHarness, {}));
    expect(tabIndexes(tabs())).toEqual([0, -1, -1]);
    expect(tabs()[0]?.getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('[role="tabpanel"]')?.textContent).toBe('Details panel');
  });

  it('wires each tab to its panel in both directions', () => {
    render(createElement(TabsHarness, {}));
    const tab = tabs()[0];
    const panel = document.querySelector<HTMLElement>('[role="tabpanel"]');
    expect(tab?.getAttribute('aria-controls')).toBe(panel?.id);
    expect(panel?.getAttribute('aria-labelledby')).toBe(tab?.id);
    // The panel is reachable by Tab from the tab list.
    expect(panel?.tabIndex).toBe(0);
  });

  it('moves along the row with the arrow keys and activates as it goes', () => {
    render(createElement(TabsHarness, {}));
    const first = tabs()[0];
    if (!first) throw new Error('missing tab');

    focus(first);
    press(first, 'ArrowRight');
    expect(activeElement()).toBe(tabs()[1]);
    expect(tabs()[1]?.getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('[role="tabpanel"]')?.textContent).toBe('Tasks panel');
    expect(tabIndexes(tabs())).toEqual([-1, 0, -1]);

    press(tabs()[1] ?? document, 'ArrowLeft');
    expect(document.querySelector('[role="tabpanel"]')?.textContent).toBe('Details panel');
  });

  it('wraps at both ends of the tab list', () => {
    render(createElement(TabsHarness, {}));
    const first = tabs()[0];
    if (!first) throw new Error('missing tab');

    focus(first);
    press(first, 'ArrowLeft');
    expect(activeElement()).toBe(tabs()[2]);
    expect(document.querySelector('[role="tabpanel"]')?.textContent).toBe('Related panel');

    press(tabs()[2] ?? document, 'ArrowRight');
    expect(activeElement()).toBe(tabs()[0]);
  });

  it('ignores the vertical arrows in a horizontal tab list', () => {
    render(createElement(TabsHarness, {}));
    const first = tabs()[0];
    if (!first) throw new Error('missing tab');

    focus(first);
    press(first, 'ArrowDown');
    expect(activeElement()).toBe(first);
    expect(document.querySelector('[role="tabpanel"]')?.textContent).toBe('Details panel');
  });

  it('waits for Enter or Space when activation is manual', () => {
    render(createElement(TabsHarness, { activation: 'manual' }));
    const first = tabs()[0];
    if (!first) throw new Error('missing tab');

    focus(first);
    press(first, 'ArrowRight');
    // Focus has moved, but the expensive panel has not been swapped yet.
    expect(activeElement()).toBe(tabs()[1]);
    expect(document.querySelector('[role="tabpanel"]')?.textContent).toBe('Details panel');

    press(tabs()[1] ?? document, 'Enter');
    expect(document.querySelector('[role="tabpanel"]')?.textContent).toBe('Tasks panel');
  });
});
