// @vitest-environment jsdom
import { act, useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatePicker } from '../../web/DatePicker.js';
import { activeElement, cleanupDocument, click, focus, press, render, settle, typeInto } from '../../web/__tests__/support/render.js';
import { datePattern, formatIsoDate, formatLocaleDate, parseIsoDate, parseLocaleDate } from '../calendar-dates.js';
import { DateRangePicker, type DateRange } from '../DateRangePicker.js';

vi.mock('../../web/IconButtonTooltip.js', () => ({ IconButtonTooltip: () => null }));

afterEach(() => cleanupDocument());

const reference = new Date(Date.UTC(2026, 8, 30));
const iso = (text: string, locale = 'en-GB'): string | null => {
  const date = parseLocaleDate(text, locale, reference);
  return date ? formatIsoDate(date) : null;
};

describe('reading typed dates', () => {
  it('reads the locale’s own order, and ISO everywhere', () => {
    expect(iso('14/03/2026')).toBe('2026-03-14');
    expect(iso('3/14/2026', 'en-US')).toBe('2026-03-14');
    expect(iso('2026-03-14', 'en-US')).toBe('2026-03-14');
    expect(iso('2026/03/14')).toBe('2026-03-14');
    expect(iso('14.3.26')).toBe('2026-03-14');
  });

  it('reads month names either way round, and a missing year as this year', () => {
    expect(iso('14 Mar 2026')).toBe('2026-03-14');
    expect(iso('Mar 14, 2026', 'en-US')).toBe('2026-03-14');
    expect(iso('14 September')).toBe('2026-09-14');
    expect(iso('Sept 3 2027')).toBe('2027-09-03');
    expect(iso('14/3')).toBe('2026-03-14');
  });

  it('refuses anything that is not one real day, rather than guessing', () => {
    expect(iso('31/04/2026')).toBeNull();
    expect(iso('29/02/2027')).toBeNull();
    expect(iso('14/13/2026')).toBeNull();
    expect(iso('next tuesday')).toBeNull();
    expect(iso('14')).toBeNull();
    expect(iso('14/03/202')).toBeNull();
    expect(iso('')).toBeNull();
  });

  it('shows dates in the locale’s medium style and describes the shape to type', () => {
    expect(formatLocaleDate(parseIsoDate('2026-03-14')!, 'en-GB')).toBe('14 Mar 2026');
    expect(formatLocaleDate(parseIsoDate('2026-03-14')!, 'en-US')).toBe('Mar 14, 2026');
    expect(datePattern('en-GB')).toBe('dd/mm/yyyy');
    expect(datePattern('en-US')).toBe('mm/dd/yyyy');
  });
});

function Picker({ onChange, initial = null, presets }: { readonly onChange?: (value: string | null) => void; readonly initial?: string | null; readonly presets?: { label: string; value: string }[] }): ReactNode {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <DatePicker
      aria-label="Needed by"
      locale="en-GB"
      value={value}
      presets={presets}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

/** Focus leaving a field, the way a browser reports it, inside `act`. */
function blur(element: HTMLElement): void {
  act(() => element.blur());
}

const field = (): HTMLInputElement => document.querySelector<HTMLInputElement>('.itsm-DatePicker__input')!;
const toggle = (): HTMLButtonElement => document.querySelector<HTMLButtonElement>('.itsm-DatePicker__toggle')!;
const calendar = (): HTMLElement | null => document.querySelector<HTMLElement>('.itsm-DatePicker__popover');

describe('DatePicker', () => {
  it('takes a complete typed date as it is typed, and shows it back in the locale’s style', () => {
    const onChange = vi.fn();
    render(<Picker onChange={onChange} />);
    expect(field().placeholder).toBe('dd/mm/yyyy');
    focus(field());
    typeInto(field(), '14/03');
    expect(onChange).not.toHaveBeenCalled();
    typeInto(field(), '14/03/2026');
    expect(onChange).toHaveBeenLastCalledWith('2026-03-14');
    blur(field());
    expect(field().value).toBe('14 Mar 2026');
  });

  it('keeps unreadable text, marks it invalid and reports no date', () => {
    const onChange = vi.fn();
    render(<Picker initial="2026-03-14" onChange={onChange} />);
    expect(field().value).toBe('14 Mar 2026');
    focus(field());
    typeInto(field(), '31/04/2026');
    blur(field());
    expect(field().value).toBe('31/04/2026');
    expect(field().getAttribute('aria-invalid')).toBe('true');
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('opens its calendar from the button, on the chosen day, and moves by the keyboard grid', async () => {
    const onChange = vi.fn();
    render(<Picker initial="2026-03-14" onChange={onChange} />);
    expect(toggle().getAttribute('aria-label')).toBe('Choose date');
    focus(toggle());
    click(toggle());
    await settle();
    expect(calendar()?.getAttribute('role')).toBe('dialog');
    expect(activeElement()?.getAttribute('data-date')).toBe('2026-03-14');
    expect(activeElement()?.getAttribute('aria-selected')).toBe('true');

    press(activeElement()!, 'ArrowRight');
    expect(activeElement()?.getAttribute('data-date')).toBe('2026-03-15');
    press(activeElement()!, 'PageDown');
    expect(activeElement()?.getAttribute('data-date')).toBe('2026-04-15');
    expect(document.querySelector('.itsm-Calendar__caption')?.textContent).toBe('April 2026');
    press(activeElement()!, 'Enter');
    expect(onChange).toHaveBeenLastCalledWith('2026-04-15');
    expect(calendar()).toBeNull();
    expect(activeElement()).toBe(toggle());
    expect(field().value).toBe('15 Apr 2026');
  });

  it('opens with Alt+ArrowDown from the field, and Escape closes it back to the button', async () => {
    render(<Picker />);
    focus(field());
    press(field(), 'ArrowDown', { altKey: true });
    await settle();
    expect(calendar()).not.toBeNull();
    press(activeElement()!, 'Escape');
    await settle();
    expect(calendar()).toBeNull();
    expect(activeElement()).toBe(toggle());
  });

  it('offers presets beside the calendar', async () => {
    const onChange = vi.fn();
    render(<Picker onChange={onChange} presets={[{ label: 'End of quarter', value: '2026-12-31' }]} />);
    click(toggle());
    await settle();
    const preset = [...document.querySelectorAll<HTMLButtonElement>('.itsm-DatePicker__preset')].find((button) => button.textContent === 'End of quarter')!;
    click(preset);
    expect(onChange).toHaveBeenLastCalledWith('2026-12-31');
  });
});

describe('DateRangePicker', () => {
  function Range({ onChange, initial = null }: { readonly onChange?: (value: DateRange | null) => void; readonly initial?: DateRange | null }): ReactNode {
    const [value, setValue] = useState<DateRange | null>(initial);
    return (
      <DateRangePicker
        label="Created"
        locale="en-GB"
        value={value}
        presets={[{ label: 'First week of March', value: { from: '2026-03-01', to: '2026-03-07' } }]}
        onChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
      />
    );
  }

  it('is a named group of two fields, published in order once both are real days', () => {
    const onChange = vi.fn();
    render(<Range onChange={onChange} />);
    const group = document.querySelector('[role="group"]')!;
    expect(group.getAttribute('aria-label')).toBe('Created');
    const [from, to] = [...group.querySelectorAll<HTMLInputElement>('input')];
    expect(from!.getAttribute('aria-label')).toBe('From');
    expect(to!.getAttribute('aria-label')).toBe('To');

    focus(from!);
    typeInto(from!, '20/03/2026');
    expect(onChange).not.toHaveBeenCalled();
    typeInto(to!, '02/03/2026');
    expect(onChange).toHaveBeenLastCalledWith({ from: '2026-03-02', to: '2026-03-20' });
  });

  it('picks a range with two presses on one calendar, in either order', async () => {
    const onChange = vi.fn();
    render(<Range onChange={onChange} initial={{ from: '2026-03-10', to: '2026-03-12' }} />);
    click(document.querySelector<HTMLButtonElement>('.itsm-DatePicker__toggle')!);
    await settle();
    const middle = document.querySelector('[data-date="2026-03-11"]')!;
    expect(middle.getAttribute('data-mark')).toBe('middle');
    expect(document.querySelector('.itsm-Calendar__hint')?.textContent).toBe('Choose the first day');

    click(document.querySelector('[data-date="2026-03-20"]')!);
    expect(document.querySelector('.itsm-Calendar__hint')?.textContent).toBe('Now choose the last day');
    click(document.querySelector('[data-date="2026-03-16"]')!);
    expect(onChange).toHaveBeenLastCalledWith({ from: '2026-03-16', to: '2026-03-20' });
    expect(document.querySelector('.itsm-DatePicker__popover')).toBeNull();
  });

  it('applies a preset at once', async () => {
    const onChange = vi.fn();
    render(<Range onChange={onChange} />);
    click(document.querySelector<HTMLButtonElement>('.itsm-DatePicker__toggle')!);
    await settle();
    click([...document.querySelectorAll<HTMLButtonElement>('.itsm-DatePicker__preset')].find((button) => button.textContent === 'First week of March')!);
    expect(onChange).toHaveBeenLastCalledWith({ from: '2026-03-01', to: '2026-03-07' });
  });
});
