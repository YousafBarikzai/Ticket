// @vitest-environment jsdom
import { act, useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FormField } from '../../web/FormField.js';
import { cleanupDocument, focus, render, typeInto } from '../../web/__tests__/support/render.js';
import { DurationField, type DurationFieldProps } from '../DurationField.js';

/*
 * DurationField (SPEC §4.2): reads "4h", "1d 2h", "90"; shows the normalised
 * reading; refuses zero, negatives, disallowed units and nonsense in words —
 * and never turns a typo into an hour, which is the `Number(x) || 60` bug it
 * replaces.
 */

afterEach(() => {
  cleanupDocument();
  vi.useRealTimers();
});

function Harness(props: Partial<DurationFieldProps> & { readonly initial?: number | null; readonly spy?: (value: number | null) => void }): ReactNode {
  const { initial = null, spy, ...rest } = props;
  const [value, setValue] = useState<number | null>(initial);
  return (
    <FormField label="Resolve within">
      <DurationField
        {...rest}
        value={value}
        onChange={(next) => {
          spy?.(next);
          setValue(next);
        }}
      />
    </FormField>
  );
}

const input = (): HTMLInputElement => document.querySelector('input')!;
const chip = (): string | null => document.querySelector('.itsm-DurationField__chip')?.textContent ?? null;
const error = (): string | null => document.querySelector('.itsm-DurationField__error')?.textContent ?? null;

function blur(): void {
  act(() => {
    input().blur();
  });
}

describe('DurationField', () => {
  it('shows a value in its normal form', () => {
    render(<Harness initial={255} />);
    expect(input().value).toBe('4 h 15 min');
    expect(chip()).toBeNull();
  });

  it.each([
    ['4h', 240],
    ['1d 2h', 1560],
    ['90', 90],
    ['90m', 90],
    ['1.5h', 90],
    ['1:30', 90],
    ['2 days, 3 hours and 5 minutes', 3065],
  ])('reads "%s" as %i minutes', (typed, minutes) => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    typeInto(input(), typed);
    expect(spy).toHaveBeenLastCalledWith(minutes);
  });

  it('shows what it read while the text is not yet in that form, and writes it back on leaving', () => {
    render(<Harness />);
    focus(input());
    typeInto(input(), '90');
    expect(chip()).toBe('1 h 30 min');
    blur();
    expect(input().value).toBe('1 h 30 min');
    expect(chip()).toBeNull();
  });

  it('says the reading aloud once typing pauses', () => {
    vi.useFakeTimers();
    render(<Harness />);
    focus(input());
    typeInto(input(), '1d 2h');
    const status = document.querySelector('.itsm-DurationField [role="status"]')!;
    expect(status.textContent).toBe('');
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(status.textContent).toBe('Reads as 1 day 2 hours');
  });

  it.each([
    ['0', 'Enter a duration longer than zero.'],
    ['-2h', 'Enter a duration longer than zero.'],
    ['soon', 'Enter a duration like 4h, 1d 2h or 90.'],
    ['2d3', 'Enter a duration like 4h, 1d 2h or 90.'],
    ['400d', 'Enter 365 d or less.'],
  ])('refuses "%s" in words, after the field is left, and reports no value', (typed, message) => {
    const spy = vi.fn();
    render(<Harness initial={60} spy={spy} />);
    focus(input());
    typeInto(input(), typed);
    // Nothing is said while the person is still typing.
    expect(error()).toBeNull();
    expect(spy).toHaveBeenLastCalledWith(null);
    blur();
    expect(error()).toBe(message);
    expect(input().getAttribute('aria-invalid')).toBe('true');
    const describedBy = input().getAttribute('aria-describedby') ?? '';
    expect(describedBy.split(' ').map((id) => document.getElementById(id)?.textContent)).toContain(message);
  });

  it('never falls back to an hour for a typo', () => {
    const spy = vi.fn();
    render(<Harness initial={30} spy={spy} />);
    typeInto(input(), 'l5');
    expect(spy).toHaveBeenLastCalledWith(null);
    expect(spy).not.toHaveBeenCalledWith(60);
  });

  it('clears the error as soon as the text is fixed', () => {
    render(<Harness />);
    focus(input());
    typeInto(input(), 'soon');
    blur();
    expect(error()).not.toBeNull();
    focus(input());
    typeInto(input(), '2h');
    expect(error()).toBeNull();
    expect(input().getAttribute('aria-invalid')).toBeNull();
  });

  it('keeps to the units it is given, and reads a bare number in the smallest', () => {
    const spy = vi.fn();
    render(<Harness units={['h', 'm']} spy={spy} />);
    focus(input());
    typeInto(input(), '2d');
    blur();
    expect(error()).toBe('Use hours and minutes only, like 4h, 2h 30m or 90.');
    focus(input());
    typeInto(input(), '36h');
    expect(spy).toHaveBeenLastCalledWith(2160);
    blur();
    // Written back in the allowed units: 36 hours, not a day and a half.
    expect(input().value).toBe('36 h');
  });

  it('reads a bare number as hours when minutes are not allowed', () => {
    const spy = vi.fn();
    render(<Harness units={['d', 'h']} spy={spy} />);
    typeInto(input(), '6');
    expect(spy).toHaveBeenLastCalledWith(360);
  });

  it('honours its own minimum and maximum', () => {
    render(<Harness min={15} max={480} />);
    focus(input());
    typeInto(input(), '10');
    blur();
    expect(error()).toBe('Enter at least 15 min.');
    focus(input());
    typeInto(input(), '9h');
    blur();
    expect(error()).toBe('Enter 8 h or less.');
  });

  it('says that it counts business hours, in view and in its description', () => {
    render(<Harness businessTime initial={240} />);
    const note = document.querySelector('.itsm-DurationField__business')!;
    expect(note.textContent).toBe('Business hours');
    expect(input().getAttribute('aria-describedby')?.split(' ')).toContain(note.id);
  });

  it('takes a new value from outside unless its text already says it', () => {
    function Outside(): ReactNode {
      const [value, setValue] = useState<number | null>(60);
      return (
        <>
          <button type="button" onClick={() => setValue(120)}>
            Two hours
          </button>
          <DurationField aria-label="Target" value={value} onChange={setValue} />
        </>
      );
    }
    render(<Outside />);
    typeInto(input(), '60m');
    expect(input().value).toBe('60m');
    act(() => {
      document.querySelector('button')!.click();
    });
    expect(input().value).toBe('2 h');
  });
});
