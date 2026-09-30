// @vitest-environment jsdom
import { act, useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FormField } from '../../web/FormField.js';
import { activeElement, cleanupDocument, click, focus, press, render, typeInto } from '../../web/__tests__/support/render.js';
import { CheckboxGroup } from '../CheckboxGroup.js';
import { NumberField } from '../NumberField.js';
import { SearchField, type SearchFieldProps } from '../SearchField.js';
import { TimeField } from '../TimeField.js';

/*
 * SearchField (debounce, Enter, Escape, clear, a value from outside, the
 * shortcut), NumberField (steppers, clamping, the spinbutton keys),
 * TimeField (HH:mm) and CheckboxGroup (fieldset, legend, order).
 */

afterEach(() => {
  cleanupDocument();
  vi.useRealTimers();
});

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('SearchField', () => {
  function Harness(props: Partial<SearchFieldProps> & { readonly spy?: (value: string) => void; readonly initial?: string }): ReactNode {
    const { spy, initial = '', ...rest } = props;
    const [value, setValue] = useState(initial);
    return (
      <>
        <SearchField
          label="Search rules"
          {...rest}
          value={value}
          onValueChange={(next) => {
            spy?.(next);
            setValue(next);
          }}
        />
        <button type="button" onClick={() => setValue('vip')}>
          Show VIP
        </button>
      </>
    );
  }

  const input = (): HTMLInputElement => document.querySelector('input[type="search"]')!;

  it('is a search landmark with a labelled search input', () => {
    render(<Harness labelHidden placeholder="Name or key" />);
    const landmark = document.querySelector('[role="search"]');
    expect(landmark).not.toBeNull();
    expect(landmark?.contains(input())).toBe(true);
    // Named by its label, so two searches on a page are told apart.
    expect(document.getElementById(landmark?.getAttribute('aria-labelledby') ?? '')?.textContent).toBe('Search rules');
    expect(document.querySelector('label')?.htmlFor).toBe(input().id);
    expect(document.querySelector('label')?.className).toContain('itsm-visually-hidden');
    expect(input().getAttribute('enterkeyhint')).toBe('search');
  });

  it('reports typing once it pauses (200 ms by default), not on every key', () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    typeInto(input(), 'v');
    typeInto(input(), 'vp');
    typeInto(input(), 'vpn');
    advance(150);
    expect(spy).not.toHaveBeenCalled();
    advance(60);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('vpn');
  });

  it('takes its own debounce', () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    render(<Harness spy={spy} debounceMs={300} />);
    typeInto(input(), 'printer');
    advance(250);
    expect(spy).not.toHaveBeenCalled();
    advance(60);
    expect(spy).toHaveBeenCalledWith('printer');
  });

  it('reports at once and submits on Enter', () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const onSubmit = vi.fn();
    render(<Harness spy={spy} onSubmit={onSubmit} />);
    typeInto(input(), 'laptop');
    press(input(), 'Enter');
    expect(spy).toHaveBeenCalledWith('laptop');
    expect(onSubmit).toHaveBeenCalledWith('laptop');
    advance(500);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('clears with Escape, keeping the key from the sheet around it only while there is text', () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const outer = vi.fn();
    render(
      <div onKeyDown={(event) => outer(event.key)}>
        <Harness spy={spy} />
      </div>,
    );
    typeInto(input(), 'vpn');
    advance(250);
    expect(spy).toHaveBeenLastCalledWith('vpn');
    press(input(), 'Escape');
    expect(input().value).toBe('');
    expect(spy).toHaveBeenLastCalledWith('');
    expect(outer).not.toHaveBeenCalled();
    press(input(), 'Escape');
    expect(outer).toHaveBeenCalledWith('Escape');
  });

  it('shows "Clear search" once there is text, which empties the field and keeps focus', () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    expect(document.querySelector('.itsm-SearchField__clear')).toBeNull();
    typeInto(input(), 'vpn');
    advance(250);
    const clear = document.querySelector<HTMLButtonElement>('.itsm-SearchField__clear')!;
    expect(clear.getAttribute('aria-label')).toBe('Clear search');
    click(clear);
    expect(input().value).toBe('');
    expect(spy).toHaveBeenLastCalledWith('');
    expect(activeElement()).toBe(input());
  });

  it('cancels a pending report when cleared before it was sent', () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    typeInto(input(), 'vpn');
    press(input(), 'Escape');
    advance(500);
    // The parent never saw "vpn", so there is nothing to take back either.
    expect(spy).not.toHaveBeenCalled();
    expect(input().value).toBe('');
  });

  it('takes a value set from outside over what was being typed', () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    typeInto(input(), 'pri');
    click(document.querySelector('button:not(.itsm-SearchField__clear)')!);
    expect(input().value).toBe('vip');
    advance(500);
    // The half-typed text is not reported after the outside change.
    expect(spy).not.toHaveBeenCalledWith('pri');
  });

  it('shows its shortcut while empty and binds it to focus the field', () => {
    render(<Harness shortcut="/" />);
    expect(document.querySelector('.itsm-SearchField__kbd')).not.toBeNull();
    expect(input().getAttribute('aria-keyshortcuts')).toBe('/');
    press(document.body, '/');
    expect(activeElement()).toBe(input());
    typeInto(input(), 'x');
    expect(document.querySelector('.itsm-SearchField__kbd')).toBeNull();
  });

  it('shows a spinner and marks itself busy while results load', () => {
    render(<Harness loading />);
    expect(document.querySelector('.itsm-SearchField__spinner')?.getAttribute('aria-hidden')).toBe('true');
    expect(document.querySelector('[role="search"]')?.getAttribute('aria-busy')).toBe('true');
  });
});

describe('NumberField', () => {
  function Harness({ initial = 5, spy, ...rest }: { readonly initial?: number | null; readonly spy?: (value: number | null) => void; readonly min?: number; readonly max?: number; readonly step?: number; readonly unit?: string }): ReactNode {
    const [value, setValue] = useState<number | null>(initial);
    return (
      <FormField label="Order" hint="Lowest runs first.">
        <NumberField
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
  const stepper = (name: string): HTMLButtonElement =>
    [...document.querySelectorAll<HTMLButtonElement>('.itsm-NumberField__step')].find((button) => button.getAttribute('aria-label')?.startsWith(name))!;

  it('is a native number field wired to its FormField, with named steppers outside the tab order', () => {
    render(<Harness />);
    expect(input().type).toBe('number');
    expect(document.querySelector('label')?.htmlFor).toBe(input().id);
    expect(stepper('Decrease').tabIndex).toBe(-1);
    expect(stepper('Increase').getAttribute('aria-controls')).toBe(input().id);
  });

  it('steps by `step` and stops at the bounds', () => {
    const spy = vi.fn();
    render(<Harness initial={8} max={10} min={0} step={2} spy={spy} />);
    click(stepper('Increase'));
    expect(spy).toHaveBeenLastCalledWith(10);
    expect(stepper('Increase').disabled).toBe(true);
    click(stepper('Decrease'));
    expect(spy).toHaveBeenLastCalledWith(8);
  });

  it('steps decimals without float noise', () => {
    const spy = vi.fn();
    render(<Harness initial={0.1} step={0.2} spy={spy} />);
    click(stepper('Increase'));
    expect(spy).toHaveBeenLastCalledWith(0.3);
  });

  it('starts an empty field at the lower bound', () => {
    const spy = vi.fn();
    render(<Harness initial={null} min={1} spy={spy} />);
    click(stepper('Increase'));
    expect(spy).toHaveBeenLastCalledWith(1);
  });

  it('reports typing unclamped, then pulls it into range on leaving', () => {
    const spy = vi.fn();
    render(<Harness initial={5} max={10} spy={spy} />);
    focus(input());
    typeInto(input(), '42');
    expect(spy).toHaveBeenLastCalledWith(42);
    act(() => input().blur());
    expect(spy).toHaveBeenLastCalledWith(10);
    expect(input().value).toBe('10');
  });

  it('reports an emptied field as null', () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    typeInto(input(), '');
    expect(spy).toHaveBeenLastCalledWith(null);
  });

  it('steps ten with Page Up and Page Down, and goes to the bounds with Home and End', () => {
    const spy = vi.fn();
    render(<Harness initial={50} min={0} max={100} spy={spy} />);
    press(input(), 'PageUp');
    expect(spy).toHaveBeenLastCalledWith(60);
    press(input(), 'PageDown');
    expect(spy).toHaveBeenLastCalledWith(50);
    press(input(), 'End');
    expect(spy).toHaveBeenLastCalledWith(100);
    press(input(), 'Home');
    expect(spy).toHaveBeenLastCalledWith(0);
  });

  it('shows its unit and is described by it', () => {
    render(<Harness unit="minutes" />);
    const described = (input().getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent);
    expect(described).toContain('minutes');
    expect(described).toContain('Lowest runs first.');
  });

  it('names itself and its steppers from `label` outside a FormField', () => {
    render(<NumberField label="Rows" value={3} onChange={() => undefined} />);
    expect(input().getAttribute('aria-label')).toBe('Rows');
    expect(stepper('Increase').getAttribute('aria-label')).toBe('Increase Rows');
  });
});

describe('TimeField', () => {
  it('is a native time input that reports HH:mm, and null when emptied', () => {
    const onChange = vi.fn();
    render(<TimeField label="Opens" value="09:00" step={15} onChange={onChange} />);
    const input = document.querySelector('input')!;
    expect(input.type).toBe('time');
    expect(input.step).toBe('900');
    expect(input.getAttribute('aria-label')).toBe('Opens');
    typeInto(input, '17:30:00');
    expect(onChange).toHaveBeenLastCalledWith('17:30');
    typeInto(input, '');
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('takes its FormField’s wiring', () => {
    render(
      <FormField label="Closes" error="Close after it opens.">
        <TimeField value={null} onChange={() => undefined} />
      </FormField>,
    );
    const input = document.querySelector('input')!;
    expect(document.querySelector('label')?.htmlFor).toBe(input.id);
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });
});

describe('CheckboxGroup', () => {
  function Harness({ spy }: { readonly spy?: (value: string[]) => void }): ReactNode {
    const [value, setValue] = useState<string[]>(['sms']);
    return (
      <CheckboxGroup
        label="Channels"
        hint="Where we tell you."
        error="Choose at least one."
        required
        value={value}
        onChange={(next) => {
          spy?.(next);
          setValue(next);
        }}
        options={[
          { value: 'mail', label: 'Email' },
          { value: 'sms', label: 'Text message', description: 'Standard rates apply.' },
          { value: 'teams', label: 'Teams', disabled: true },
        ]}
      />
    );
  }

  it('is a fieldset whose legend is the question, described by its hint and error', () => {
    render(<Harness />);
    const fieldset = document.querySelector('fieldset')!;
    expect(fieldset.querySelector('legend')?.textContent).toBe('Channels*');
    const described = (fieldset.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent);
    expect(described).toEqual(['Where we tell you.', 'Choose at least one.']);
    expect(fieldset.querySelector('.itsm-Field__error svg[data-icon="circle-alert"]')).not.toBeNull();
    expect([...fieldset.querySelectorAll('input[type="checkbox"]')].map((box) => (box as HTMLInputElement).checked)).toEqual([false, true, false]);
  });

  it('reports the selection in the options’ order, whatever order it was ticked in', () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    const boxes = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    click(boxes[0]!);
    expect(spy).toHaveBeenLastCalledWith(['mail', 'sms']);
    click(boxes[1]!);
    expect(spy).toHaveBeenLastCalledWith(['mail']);
    expect(boxes[2]?.disabled).toBe(true);
  });
});
