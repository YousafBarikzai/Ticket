// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { announcerText, destroyAnnouncer } from '../../a11y/announcer.js';
import { activeElement, cleanupDocument, click, pointerDown, press, render, settle, typeInto } from '../../web/__tests__/support/render.js';
import { FilterBar, type FilterBarProps } from '../FilterBar.js';
import type { FilterSpec, FilterValue } from '../types.js';
import { navigation, resetLocation, statusFilter, UrlProvider, type Navigation } from './support/table.js';

vi.mock('../../web/IconButtonTooltip.js', () => ({ IconButtonTooltip: () => null }));
vi.mock('../../overlays/Toaster.js', () => ({ Toaster: () => null }));

/**
 * The filter row: every active filter is a chip that says its value and
 * clears on its own; the rest wait behind "+ Filter" and open the moment they
 * are added; "Clear all" puts everything back; and with `urlKey` the row
 * keeps its state in the URL itself.
 */

const priority: FilterSpec = {
  id: 'priority',
  label: 'Priority',
  type: 'select',
  options: ['P1', 'P2', 'P3', 'P4'].map((value) => ({ value, label: value })),
};
const retired: FilterSpec = { id: 'retired', label: 'Show retired', type: 'boolean', pinned: true };
const owner: FilterSpec = {
  id: 'owner',
  label: 'Owner',
  type: 'person',
  loadOptions: async (query) =>
    [
      { value: 'u-1', label: 'Ada Lovelace' },
      { value: 'u-2', label: 'Grace Hopper' },
    ].filter((person) => person.label.toLowerCase().includes(query.toLowerCase())),
};
const text: FilterSpec = { id: 'subject', label: 'Subject', type: 'text' };

let nav: Navigation;

beforeEach(() => {
  resetLocation('/tickets');
  nav = navigation();
});

afterEach(() => {
  cleanupDocument();
  destroyAnnouncer();
  vi.restoreAllMocks();
});

function Harness({ filters, onValues, search }: { readonly filters: readonly FilterSpec[]; readonly onValues?: (values: Record<string, FilterValue>) => void; readonly search?: boolean }) {
  const [values, setValues] = useState<Record<string, FilterValue>>({});
  const [q, setQ] = useState('');
  return (
    <FilterBar
      filters={filters}
      values={values}
      onChange={(next) => {
        setValues(next);
        onValues?.(next);
      }}
      {...(search ? { search: { value: q, placeholder: 'Search tickets', onValueChange: setQ } } : {})}
      resultCount={{ shown: Object.values(values).some((value) => value !== null && value !== undefined) ? 3 : 12, hasMore: false, noun: { one: 'ticket', other: 'tickets' } }}
    />
  );
}

function mount(filters: readonly FilterSpec[], options: { readonly search?: boolean } = {}) {
  const onValues = vi.fn();
  const rendered = render(
    <UrlProvider nav={nav}>
      <Harness filters={filters} onValues={onValues} {...(options.search ? { search: true } : {})} />
    </UrlProvider>,
  );
  const chip = (label: string): HTMLButtonElement | undefined =>
    [...rendered.container.querySelectorAll<HTMLButtonElement>('.itsm-FilterChip__trigger')].find((trigger) => trigger.textContent?.startsWith(label));
  const button = (label: string): HTMLButtonElement | undefined =>
    [...rendered.container.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => candidate.textContent === label);
  return { ...rendered, onValues, chip, button };
}

function option(label: string): HTMLElement {
  return [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((candidate) => candidate.textContent === label)!;
}

describe('chips', () => {
  it('shows pinned filters as chips and keeps the rest behind "+ Filter"', () => {
    const { chip, button, container } = mount([statusFilter, priority, retired]);
    expect(chip('Status')?.textContent).toBe('Status');
    expect(chip('Priority')).toBeUndefined();
    expect(button('Filter')).toBeDefined();
    const toggle = container.querySelector('.itsm-FilterBar__toggle')!;
    expect(toggle.textContent).toBe('Show retired');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('adds a filter from "+ Filter" and opens its choices straight away', async () => {
    const { button, chip } = mount([statusFilter, priority]);
    pointerDown(button('Filter')!);
    await settle();
    click([...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === 'Priority')!);
    await settle(20);
    expect(chip('Priority')).toBeDefined();
    const list = document.querySelector('[role="listbox"]');
    expect(list?.getAttribute('aria-label')).toBe('Priority');
    expect(list?.contains(activeElement())).toBe(true);
  });

  it('puts an added filter back behind "+ Filter" when it closes with nothing chosen', async () => {
    const { button, chip } = mount([statusFilter, priority]);
    pointerDown(button('Filter')!);
    await settle();
    click([...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === 'Priority')!);
    await settle(20);
    press(activeElement()!, 'Escape');
    await settle(20);
    expect(chip('Priority')).toBeUndefined();
    expect(activeElement()).toBe(button('Filter'));
  });

  it('picks one value of a single choice and closes; the chip names it', async () => {
    const { chip, onValues } = mount([{ ...priority, pinned: true }]);
    click(chip('Priority')!);
    await settle();
    // Arrowing through the choices does not choose: only Enter, Space or a click does.
    press(activeElement()!, 'ArrowDown');
    expect(onValues).not.toHaveBeenCalled();
    press(activeElement()!, 'Enter');
    await settle();
    expect(onValues).toHaveBeenLastCalledWith({ priority: 'P2' });
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(chip('Priority')?.textContent).toBe('Priority: P2');
  });

  it('picks several values in the options’ order, and closes with Done', async () => {
    const { chip, onValues, button } = mount([statusFilter]);
    click(chip('Status')!);
    await settle();
    click(option('Archived'));
    click(option('Draft'));
    expect(onValues).toHaveBeenLastCalledWith({ status: ['draft', 'archived'] });
    expect(option('Draft').getAttribute('aria-selected')).toBe('true');
    click([...document.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => candidate.textContent === 'Done')!);
    await settle();
    expect(chip('Status')?.textContent).toBe('Status: Draft, Archived');
    expect(button('Clear all')).toBeDefined();
  });

  it('clears one filter with its ×, keeping focus on the chip', async () => {
    const { chip, container, onValues } = mount([statusFilter]);
    click(chip('Status')!);
    await settle();
    click(option('Live'));
    press(activeElement()!, 'Escape');
    await settle();
    const clear = container.querySelector<HTMLButtonElement>('.itsm-FilterChip__clear')!;
    expect(clear.getAttribute('aria-label')).toBe('Clear Status filter');
    clear.focus();
    click(clear);
    await settle(10);
    expect(onValues).toHaveBeenLastCalledWith({ status: null });
    expect(activeElement()).toBe(chip('Status'));
  });

  it('toggles a yes/no filter in place', () => {
    const { container, onValues } = mount([retired]);
    const toggle = container.querySelector<HTMLButtonElement>('.itsm-FilterBar__toggle')!;
    click(toggle);
    expect(onValues).toHaveBeenLastCalledWith({ retired: true });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    click(toggle);
    expect(onValues).toHaveBeenLastCalledWith({ retired: null });
  });

  it('applies free text with Enter', async () => {
    const { chip, onValues } = mount([{ ...text, pinned: true }]);
    click(chip('Subject')!);
    await settle();
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Subject"]')!;
    typeInto(input, '  vpn ');
    click([...document.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => candidate.textContent === 'Apply')!);
    await settle();
    expect(onValues).toHaveBeenLastCalledWith({ subject: 'vpn' });
    expect(chip('Subject')?.textContent).toBe('Subject: “vpn”');
  });

  it('searches people as they are typed, and names the one chosen on the chip', async () => {
    const { chip } = mount([{ ...owner, pinned: true }]);
    click(chip('Owner')!);
    await settle(250);
    typeInto(document.querySelector<HTMLInputElement>('input[aria-label="Search people"]')!, 'grace');
    await settle(250);
    expect([...document.querySelectorAll('[role="option"]')].map((element) => element.textContent)).toEqual(['Grace Hopper']);
    click(option('Grace Hopper'));
    await settle();
    expect(chip('Owner')?.textContent).toBe('Owner: Grace Hopper');
  });

  it('searches a long list of choices, and ↓ from the search goes into the list', async () => {
    const many: FilterSpec = { id: 'team', label: 'Team', type: 'select', pinned: true, options: Array.from({ length: 12 }, (_, index) => ({ value: `t${index}`, label: `Team ${index}` })) };
    const { chip } = mount([many]);
    click(chip('Team')!);
    await settle();
    const search = document.querySelector<HTMLInputElement>('input[aria-label="Search team options"]')!;
    typeInto(search, 'team 1');
    expect([...document.querySelectorAll('[role="option"]')].map((element) => element.textContent)).toEqual(['Team 1', 'Team 10', 'Team 11']);
    search.focus();
    press(search, 'ArrowDown');
    expect(activeElement()?.textContent).toBe('Team 1');
  });
});

describe('clearing everything', () => {
  it('clears every filter and the search, and keeps focus in the bar', async () => {
    const { chip, button, onValues, container } = mount([statusFilter, priority], { search: true });
    click(chip('Status')!);
    await settle();
    click(option('Live'));
    press(activeElement()!, 'Escape');
    await settle();
    typeInto(container.querySelector<HTMLInputElement>('input[type="search"]')!, 'vpn');
    await settle(250);
    button('Clear all')!.focus();
    click(button('Clear all')!);
    await settle(10);
    expect(onValues).toHaveBeenLastCalledWith({ status: null, priority: null });
    expect(container.querySelector<HTMLInputElement>('input[type="search"]')?.value).toBe('');
    expect(button('Clear all')).toBeUndefined();
    expect(container.contains(activeElement())).toBe(true);
  });
});

describe('the count', () => {
  it('shows the result count at the end, and says it when a filter the person set changes it', async () => {
    const { container, chip } = mount([statusFilter]);
    expect(container.querySelector('.itsm-FilterBar__count')?.textContent).toBe('12 tickets');
    click(chip('Status')!);
    await settle();
    click(option('Live'));
    await settle(500);
    expect(container.querySelector('.itsm-FilterBar__count')?.textContent).toBe('3 tickets');
    expect(announcerText()).toBe('3 tickets');
  });
});

describe('in the URL', () => {
  function urlBar(props: Partial<FilterBarProps> = {}) {
    return render(
      <UrlProvider nav={nav}>
        <FilterBar urlKey="tickets" filters={[statusFilter, retired]} values={{}} search={{ value: '', placeholder: 'Search tickets' }} {...(props as object)} />
      </UrlProvider>,
    );
  }

  it('reads its state from the URL, chips included', () => {
    resetLocation('/tickets?tickets.status=live,draft&tickets.retired=true&tickets.q=vpn');
    const { container } = urlBar();
    expect(container.querySelector('.itsm-FilterChip__trigger')?.textContent).toBe('Status: Draft, Live');
    expect(container.querySelector('.itsm-FilterBar__toggle')?.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector<HTMLInputElement>('input[type="search"]')?.value).toBe('vpn');
  });

  it('writes a change through the router, for the server page to read', () => {
    const { container } = urlBar();
    click(container.querySelector('.itsm-FilterBar__toggle')!);
    expect(nav.router.replace).toHaveBeenCalledWith('/tickets?tickets.retired=true', { scroll: false });
  });

  it('writes a filter marked client-side without a round trip', () => {
    const { container } = urlBar({ filters: [statusFilter, { ...retired, mode: 'client' }] });
    click(container.querySelector('.itsm-FilterBar__toggle')!);
    expect(nav.router.replace).not.toHaveBeenCalled();
    expect(window.location.search).toBe('?tickets.retired=true');
  });
});
