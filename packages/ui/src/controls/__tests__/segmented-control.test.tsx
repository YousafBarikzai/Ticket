// @vitest-environment jsdom
import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestProvider } from '../../provider/__tests__/support/provider.js';
import { activeElement, cleanupDocument, click, focus, press, render } from '../../web/__tests__/support/render.js';
import { SegmentedControl, type SegmentedControlProps, type SegmentedOption } from '../SegmentedControl.js';

/*
 * The three modes are three promises (X-61, SPEC §3.8): `value` selects as
 * focus moves; `commit` moves focus with the arrows and selects only on Space
 * or Enter; `nav` is a <nav> of links, each a tab stop, the current one
 * marked with aria-current.
 */

// The provider mounts its Toaster lazily once the page is idle; these tests are not about it.
vi.mock('../../overlays/Toaster.js', () => ({ Toaster: () => null }));

afterEach(() => cleanupDocument());

const OPTIONS: readonly SegmentedOption[] = [
  { value: 'reply', label: 'Reply' },
  { value: 'note', label: 'Internal note', icon: 'note' },
  { value: 'draft', label: 'Draft', disabled: true },
  { value: 'forward', label: 'Forward', count: 120 },
];

function Harness({ mode, onValueChange }: { readonly mode: SegmentedControlProps['mode']; readonly onValueChange?: (value: string) => void }): ReactNode {
  const [value, setValue] = useState('reply');
  return (
    <SegmentedControl
      label="Composer mode"
      mode={mode}
      options={OPTIONS}
      value={value}
      onValueChange={(next) => {
        onValueChange?.(next);
        setValue(next);
      }}
    />
  );
}

const radios = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[role="radio"]')];
const checkedLabel = (): string | undefined => radios().find((radio) => radio.getAttribute('aria-checked') === 'true')?.textContent ?? undefined;

describe('SegmentedControl', () => {
  describe('mode="value"', () => {
    it('is a named radiogroup with one tab stop on the selected segment', () => {
      render(<Harness mode="value" />);
      const group = document.querySelector('[role="radiogroup"]');
      expect(group?.getAttribute('aria-label')).toBe('Composer mode');
      expect(radios().map((radio) => radio.tabIndex)).toEqual([0, -1, -1, -1]);
      expect(radios()[0]?.getAttribute('aria-checked')).toBe('true');
    });

    it('selects as the arrows move focus, skipping disabled segments', () => {
      const onValueChange = vi.fn();
      render(<Harness mode="value" onValueChange={onValueChange} />);
      focus(radios()[0]!);
      press(radios()[0]!, 'ArrowRight');
      expect(onValueChange).toHaveBeenLastCalledWith('note');
      expect(activeElement()).toBe(radios()[1]);
      press(radios()[1]!, 'ArrowRight');
      // "Draft" is disabled: the arrow lands on "Forward".
      expect(onValueChange).toHaveBeenLastCalledWith('forward');
      expect(activeElement()).toBe(radios()[3]);
      expect(checkedLabel()).toContain('Forward');
    });

    it('selects on click, and says nothing when the selected one is pressed again', () => {
      const onValueChange = vi.fn();
      render(<Harness mode="value" onValueChange={onValueChange} />);
      click(radios()[0]!);
      expect(onValueChange).not.toHaveBeenCalled();
      click(radios()[1]!);
      expect(onValueChange).toHaveBeenCalledWith('note');
      click(radios()[2]!);
      expect(onValueChange).toHaveBeenCalledTimes(1);
    });
  });

  describe('mode="commit"', () => {
    it('moves focus with the arrows but not the value', () => {
      const onValueChange = vi.fn();
      render(<Harness mode="commit" onValueChange={onValueChange} />);
      focus(radios()[0]!);
      press(radios()[0]!, 'ArrowRight');
      expect(activeElement()).toBe(radios()[1]);
      expect(onValueChange).not.toHaveBeenCalled();
      expect(checkedLabel()).toBe('Reply');
      // The focused segment is the tab stop, the selection stays where it was.
      expect(radios().map((radio) => radio.tabIndex)).toEqual([-1, 0, -1, -1]);
    });

    it('commits with Space or Enter, and with a click', () => {
      const onValueChange = vi.fn();
      render(<Harness mode="commit" onValueChange={onValueChange} />);
      focus(radios()[0]!);
      press(radios()[0]!, 'ArrowRight');
      press(radios()[1]!, ' ');
      expect(onValueChange).toHaveBeenLastCalledWith('note');
      press(radios()[1]!, 'ArrowRight');
      press(radios()[3]!, 'Enter');
      expect(onValueChange).toHaveBeenLastCalledWith('forward');
      click(radios()[0]!);
      expect(onValueChange).toHaveBeenLastCalledWith('reply');
    });

    it('never commits a disabled segment', () => {
      const onValueChange = vi.fn();
      render(<Harness mode="commit" onValueChange={onValueChange} />);
      press(radios()[2]!, 'Enter');
      click(radios()[2]!);
      expect(onValueChange).not.toHaveBeenCalled();
    });
  });

  describe('mode="nav"', () => {
    function Nav({ value }: { readonly value: string }): ReactNode {
      return (
        <TestProvider>
          <SegmentedControl
            label="My requests"
            mode="nav"
            value={value}
            options={[
              { value: 'open', label: 'Open', href: '/tickets?scope=open', count: 3 },
              { value: 'needs-you', label: 'Needs you', href: '/tickets?scope=needs-you' },
              { value: 'all', label: 'All', href: '/tickets?scope=all' },
            ]}
          />
        </TestProvider>
      );
    }

    it('is a named nav of links, each a tab stop, the current one marked', () => {
      render(<Nav value="needs-you" />);
      const nav = document.querySelector('nav');
      expect(nav?.getAttribute('aria-label')).toBe('My requests');
      expect(document.querySelector('[role="radiogroup"]')).toBeNull();
      const links = [...document.querySelectorAll<HTMLAnchorElement>('nav a')];
      expect(links.map((link) => link.getAttribute('href'))).toEqual(['/tickets?scope=open', '/tickets?scope=needs-you', '/tickets?scope=all']);
      expect(links.map((link) => link.getAttribute('aria-current'))).toEqual([null, 'page', null]);
      expect(links.every((link) => link.tabIndex === 0)).toBe(true);
      expect(nav?.querySelectorAll('ul > li')).toHaveLength(3);
    });

    it('does not steal the arrow keys from the page', () => {
      render(<Nav value="open" />);
      const first = document.querySelector<HTMLAnchorElement>('nav a')!;
      focus(first);
      press(first, 'ArrowRight');
      expect(activeElement()).toBe(first);
    });
  });

  it('reads a count after its label, capped at 99+', () => {
    render(<Harness mode="value" />);
    const forward = radios()[3]!;
    expect(forward.querySelector('.itsm-SegmentedControl__count')?.textContent).toBe('99+');
    expect(forward.textContent).toBe('Forward, 99+');
  });

  it('reserves each label’s bold width and draws the selected segment itself until the thumb is placed', () => {
    render(<Harness mode="value" />);
    const root = document.querySelector('.itsm-SegmentedControl')!;
    expect(root.querySelector('.itsm-SegmentedControl__label')?.getAttribute('data-text')).toBe('Reply');
    // jsdom lays nothing out, so the thumb is never placed and the fallback stays.
    expect(root.hasAttribute('data-ready')).toBe(false);
    expect(radios()[0]?.hasAttribute('data-selected')).toBe(true);
  });

  it('moves its tab stop to a selection made elsewhere', () => {
    function Outside(): ReactNode {
      const [value, setValue] = useState('reply');
      return (
        <>
          <button type="button" onClick={() => setValue('forward')}>
            Forward it
          </button>
          <SegmentedControl label="Mode" mode="commit" options={OPTIONS} value={value} onValueChange={setValue} />
        </>
      );
    }
    render(<Outside />);
    click(document.querySelector('button')!);
    expect(radios().map((radio) => radio.tabIndex)).toEqual([-1, -1, -1, 0]);
  });
});
