// @vitest-environment jsdom
import { act, useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KeyField, type KeyFieldProps } from '../components/KeyField.js';
import type { KeyState } from '../keys.js';
import { cleanupDocument, click, render, type } from './support/render.js';

/**
 * The permanent key, shown while the name is typed (B §2.7): derived from the
 * name until somebody edits it, checked against the API's rule, reserved
 * words and the keys already taken — and read-only once the object exists.
 */

afterEach(cleanupDocument);

function Harness(props: Omit<KeyFieldProps, 'value' | 'onChange'> & { readonly initial?: string; readonly spy?: (key: string) => void }): ReactNode {
  const [value, setValue] = useState(props.initial ?? '');
  return (
    <form>
      <KeyField
        {...props}
        value={value}
        onChange={(key) => {
          props.spy?.(key);
          setValue(key);
        }}
      />
    </form>
  );
}

function stateText(container: HTMLElement): string {
  return container.querySelector('.app-KeyField__state')?.textContent ?? '';
}

describe('KeyField', () => {
  it('makes the key from the name and says it will be permanent', () => {
    const spy = vi.fn();
    const { container } = render(<Harness source="Order a laptop" rule="slug" spy={spy} />);
    expect(spy).toHaveBeenLastCalledWith('order-a-laptop');
    expect(container.querySelector('code')?.textContent).toBe('order-a-laptop');
    expect(stateText(container)).toContain('will be permanent');
    // Submitted with the form.
    expect(container.querySelector<HTMLInputElement>('input[type="hidden"][name="key"]')?.value).toBe('order-a-laptop');
  });

  it('folds accents and follows a camelCase rule for fields', () => {
    const { container } = render(<Harness source="Café access" rule="field" />);
    expect(container.querySelector('code')?.textContent).toBe('cafeAccess');
  });

  it('says a key is taken or reserved, and reports the state', () => {
    const states: KeyState[] = [];
    const taken = render(<Harness source="VPN access" rule="slug" taken={['vpn-access']} noun="rule" onStateChange={(state) => states.push(state)} />);
    expect(stateText(taken.container)).toContain('already used by another rule');
    expect(taken.container.querySelector('.app-KeyField')?.getAttribute('data-state')).toBe('taken');
    expect(states.at(-1)).toBe('taken');

    const reserved = render(<Harness source="New" rule="slug" />);
    expect(stateText(reserved.container)).toContain('“new” is reserved');
  });

  it('asks for different wording when the name cannot make a key', () => {
    const { container } = render(<Harness source="1st line" rule="slug" />);
    expect(stateText(container)).toContain('can’t be made from this name');
    const empty = render(<Harness source="" rule="slug" />);
    expect(stateText(empty.container)).toContain('appears when you type a name');
  });

  it('lets the key be written by hand, then stops following the name', () => {
    const spy = vi.fn();
    const { container, root } = render(<Harness source="Order a laptop" rule="slug" spy={spy} />);
    click([...container.querySelectorAll('button')].find((button) => button.textContent === 'Edit key')!);
    const input = container.querySelector<HTMLInputElement>('.app-KeyField__editor input')!;
    expect(document.activeElement).toBe(input);
    type(input, 'laptops');
    expect(spy).toHaveBeenLastCalledWith('laptops');
    act(() => {
      root.render(<Harness source="Order a laptop, please" rule="slug" spy={spy} initial="laptops" />);
    });
    expect(container.querySelector('code')?.textContent).toBe('laptops');

    type(input, 'Bad Key');
    expect(container.textContent).toContain('isn’t a valid key');
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('goes back to the name’s key on request', () => {
    const { container } = render(<Harness source="Order a laptop" rule="slug" />);
    click([...container.querySelectorAll('button')].find((button) => button.textContent === 'Edit key')!);
    type(container.querySelector<HTMLInputElement>('.app-KeyField__editor input')!, 'something-else');
    click([...container.querySelectorAll('button')].find((button) => button.textContent === 'Use the key from the name')!);
    expect(container.querySelector('code')?.textContent).toBe('order-a-laptop');
    expect(container.querySelector('.app-KeyField__editor')).toBeNull();
  });

  it('is read-only once the object exists', () => {
    const spy = vi.fn();
    const { container } = render(<Harness source="A different name now" rule="slug" locked initial="order-a-laptop" spy={spy} />);
    expect(spy).not.toHaveBeenCalled();
    expect(container.querySelector('code')?.textContent).toBe('order-a-laptop');
    expect(stateText(container)).toContain('can’t change');
    expect([...container.querySelectorAll('button')].some((button) => button.textContent === 'Edit key')).toBe(false);
  });
});
