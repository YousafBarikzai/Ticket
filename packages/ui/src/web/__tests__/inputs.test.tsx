// @vitest-environment jsdom
import { act, createRef, useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConfirmDialogProps } from '../../overlays/ConfirmDialog.js';
import { Checkbox } from '../Checkbox.js';
import { FormField } from '../FormField.js';
import { Input } from '../Input.js';
import { inputStyles } from '../Input.styles.js';
import { RadioGroup } from '../RadioGroup.js';
import { Select } from '../Select.js';
import { selectStyles } from '../Select.styles.js';
import { Switch, type SwitchProps } from '../Switch.js';
import { Tabs } from '../Tabs.js';
import { tabsStyles } from '../Tabs.styles.js';
import { Textarea } from '../Textarea.js';
import { activeElement, cleanupDocument, click, focus, press, render, typeInto } from './support/render.js';

/*
 * The inputs (SPEC §4.2, WP3 acceptance): the FormField context, Input's
 * adornments, the Textarea ref fix and its counter and submit shortcut,
 * Select, Checkbox, RadioGroup cards, Tabs variants — and the Switch that
 * asks first and keeps `aria-checked` until it is confirmed (X-43).
 *
 * The confirmation dialog belongs to the overlays package; a test double
 * stands in for it here, so these tests are about the switch's side of the
 * contract (`open`, `spec`, `onConfirm`, `onOpenChange`).
 */

vi.mock('../../overlays/ConfirmDialog.js', async () => {
  const { useState: useDialogState } = await import('react');
  function ConfirmDialog({ open, onOpenChange, spec, onConfirm }: ConfirmDialogProps): ReactNode {
    const [error, setError] = useDialogState<string | null>(null);
    if (!open) return null;
    return (
      <div role="alertdialog" aria-modal="true" aria-label={spec.title}>
        <button type="button" onClick={() => onOpenChange(false)}>
          {spec.cancelLabel ?? 'Cancel'}
        </button>
        <button
          type="button"
          onClick={() => {
            onConfirm().then(
              () => onOpenChange(false),
              (reason: unknown) => setError(String(reason)),
            );
          }}
        >
          {spec.confirmLabel}
        </button>
        {error ? <p role="alert">{error}</p> : null}
      </div>
    );
  }
  return { ConfirmDialog };
});

afterEach(() => {
  cleanupDocument();
  vi.useRealTimers();
});

async function flush(): Promise<void> {
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  // Past a frame: focus returns to the switch on the frame after the dialog closes.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 32));
  });
}

/** The declarations of the first rule in `sheet` written exactly as `selector {`. */
function rule(sheet: string, selector: string): string {
  const start = sheet.indexOf(`${selector} {`);
  return start < 0 ? '' : sheet.slice(start, sheet.indexOf('}', start));
}

/** What a screen reader hears: the text, less anything hidden from assistive technology. */
function spoken(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (node instanceof Element && node.getAttribute('aria-hidden') === 'true') return '';
  return [...node.childNodes].map(spoken).join('');
}

function byText<T extends HTMLElement = HTMLElement>(selector: string, text: string): T {
  const found = [...document.querySelectorAll<T>(selector)].find((element) => element.textContent?.includes(text));
  if (!found) throw new Error(`no ${selector} with "${text}"`);
  return found;
}

describe('FormField', () => {
  it('wires a control placed as a plain child through its context', () => {
    render(
      <FormField label="Summary" hint="One line." error="Give the ticket a summary." required>
        <Input />
      </FormField>,
    );
    const input = document.querySelector('input')!;
    const label = document.querySelector('label')!;
    expect(label.htmlFor).toBe(input.id);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-required')).toBe('true');
    expect(input.required).toBe(true);
    const described = (input.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent);
    expect(described).toEqual(['One line.', 'Give the ticket a summary.']);
  });

  it('keeps the render prop, and never repeats an id in the description', () => {
    render(
      <FormField label="Reply" hint="Markdown is supported.">
        {(control) => <Textarea {...control} />}
      </FormField>,
    );
    const describedBy = document.querySelector('textarea')?.getAttribute('aria-describedby');
    expect(document.getElementById(describedBy ?? '')?.textContent).toBe('Markdown is supported.');
  });

  it('draws the error with an icon, not a glyph', () => {
    render(
      <FormField label="Summary" error="Required.">
        <Input />
      </FormField>,
    );
    const error = document.querySelector('.itsm-Field__error')!;
    expect(error.querySelector('svg[data-icon="circle-alert"]')).not.toBeNull();
    expect(error.textContent).toBe('Required.');
  });

  it('says "(optional)" as part of the label', () => {
    render(
      <FormField label="Phone" optional>
        <Input type="tel" />
      </FormField>,
    );
    expect(document.querySelector('label')?.textContent).toBe('Phone (optional)');
  });

  it('counts characters as they are typed and as the caller changes the value', () => {
    function Field(): ReactNode {
      const [value, setValue] = useState('Hello');
      return (
        <>
          <FormField label="Title" counter={{ max: 12 }}>
            <Input value={value} onChange={(event) => setValue(event.target.value)} />
          </FormField>
          <button type="button" onClick={() => setValue('')}>
            Reset
          </button>
        </>
      );
    }
    render(<Field />);
    const count = (): string => document.querySelector('.itsm-Count__value')?.textContent ?? '';
    expect(count()).toBe('5/12');
    const input = document.querySelector('input')!;
    const description = (input.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent);
    expect(description).toContain('Up to 12 characters');

    typeInto(input, 'Hello, world!');
    expect(count()).toBe('13/12');
    expect(document.querySelector('.itsm-Count')?.getAttribute('data-state')).toBe('over');

    click(byText('button', 'Reset'));
    expect(count()).toBe('0/12');
  });

  it('speaks the remaining count only near the limit and only once typing pauses', () => {
    vi.useFakeTimers();
    function Field(): ReactNode {
      const [value, setValue] = useState('');
      return (
        <FormField label="Title" counter={{ max: 20 }}>
          <Input value={value} onChange={(event) => setValue(event.target.value)} />
        </FormField>
      );
    }
    render(<Field />);
    const status = (): string => document.querySelector('.itsm-Count [role="status"]')?.textContent ?? '';
    const input = document.querySelector('input')!;
    typeInto(input, 'Short');
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(status()).toBe('');
    typeInto(input, 'Nearly at the limit');
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(status()).toBe('');
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(status()).toBe('You have 1 character left');
  });

  it('puts the label beside the control in the inline layout', () => {
    render(
      <FormField label="Time zone" hint="An IANA name." layout="inline">
        <Input />
      </FormField>,
    );
    const head = document.querySelector('.itsm-Field--inline .itsm-Field__head');
    expect(head?.querySelector('label')).not.toBeNull();
    expect(head?.querySelector('.itsm-Field__hint')).not.toBeNull();
    expect(document.querySelector('.itsm-Field__body input')).not.toBeNull();
  });
});

describe('Input', () => {
  it('is one bare input when it has no adornments', () => {
    render(<Input aria-label="Name" className="mine" size="sm" />);
    const input = document.querySelector('input')!;
    expect(input.className).toBe('itsm-Input itsm-Input--sm mine');
    expect(input.parentElement?.className).not.toContain('itsm-InputGroup');
  });

  it('puts adornments in a box that takes the class, with the input inside', () => {
    render(<Input aria-label="Amount" prefix="search" suffix="min" className="mine" />);
    const group = document.querySelector('.itsm-InputGroup')!;
    expect(group.className).toContain('mine');
    expect(group.querySelector('svg[data-icon="search"]')).not.toBeNull();
    expect(group.querySelector('.itsm-InputGroup__suffix')?.textContent).toBe('min');
    expect(group.querySelector('input')?.className).toBe('itsm-InputGroup__input');
  });

  it('clears a controlled field through its own onChange, then keeps focus there', () => {
    const onClear = vi.fn();
    function Field(): ReactNode {
      const [value, setValue] = useState('');
      return <Input aria-label="Filter" clearable value={value} onChange={(event) => setValue(event.target.value)} onClear={onClear} />;
    }
    render(<Field />);
    expect(document.querySelector('.itsm-InputGroup__clear')).toBeNull();
    const input = document.querySelector('input')!;
    typeInto(input, 'vpn');
    const clear = document.querySelector<HTMLButtonElement>('.itsm-InputGroup__clear')!;
    expect(clear.getAttribute('aria-label')).toBe('Clear');
    click(clear);
    expect(input.value).toBe('');
    expect(activeElement()).toBe(input);
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.itsm-InputGroup__clear')).toBeNull();
  });

  it('shows the clear button for an uncontrolled field once something is typed', () => {
    render(<Input aria-label="Filter" clearable defaultValue="" />);
    const input = document.querySelector('input')!;
    typeInto(input, 'printer');
    expect(document.querySelector('.itsm-InputGroup__clear')).not.toBeNull();
  });

  it('never moves its input out of the box once boxed, so focus survives an adornment coming and going', () => {
    function Field(): ReactNode {
      const [value, setValue] = useState('');
      return <Input aria-label="Target" value={value} onChange={(event) => setValue(event.target.value)} suffix={value ? 'min' : null} />;
    }
    render(<Field />);
    const bare = document.querySelector('input')!;
    focus(bare);
    typeInto(bare, '5');
    // The first adornment boxes it (one remount, before anything else is typed)…
    const boxed = document.querySelector('input')!;
    expect(boxed.closest('.itsm-InputGroup')).not.toBeNull();
    focus(boxed);
    typeInto(boxed, '');
    // …and it stays the same element when the adornment goes again.
    expect(document.querySelector('input')).toBe(boxed);
    expect(activeElement()).toBe(boxed);
  });

  it('marks itself invalid with `invalid`', () => {
    render(<Input aria-label="Email" invalid />);
    expect(document.querySelector('input')?.getAttribute('aria-invalid')).toBe('true');
  });

  it('hands the caller its ref, bare or in a box', () => {
    const bare = createRef<HTMLInputElement>();
    const boxed = createRef<HTMLInputElement>();
    render(
      <>
        <Input aria-label="One" ref={bare} />
        <Input aria-label="Two" ref={boxed} clearable />
      </>,
    );
    expect(bare.current?.getAttribute('aria-label')).toBe('One');
    expect(boxed.current?.getAttribute('aria-label')).toBe('Two');
  });
});

describe('the v3 field box (§2.9, §2.14)', () => {
  const focusSelector =
    '.itsm-Input:focus-visible,\n.itsm-Textarea:focus-visible,\n.itsm-Select:focus-visible,\n.itsm-InputGroup:has(.itsm-InputGroup__input:focus-visible)';

  it('is 36 px with the control radius, a border.interactive edge, the xs shadow and the input text size', () => {
    const box = rule(inputStyles, '.itsm-Input,\n.itsm-Textarea,\n.itsm-Select,\n.itsm-InputGroup');
    expect(box).toContain('min-block-size: var(--itsm-control-height-md)');
    expect(box).toContain('border-radius: var(--itsm-radius-lg)');
    expect(box).toContain('solid var(--itsm-colour-border-interactive)');
    expect(box).toContain('box-shadow: var(--itsm-elevation-xs)');
    expect(box).toContain('font-size: var(--itsm-input-font-size)');
  });

  it('focuses with the halo, not the ring: no outline, an accent edge and a 4 px focusHalo wash', () => {
    const focused = rule(inputStyles, focusSelector);
    expect(focused).toContain('outline: none');
    expect(focused).toContain('border-color: var(--itsm-colour-accent)');
    expect(focused).toContain('0 0 0 var(--itsm-border-hair) var(--itsm-colour-accent)');
    expect(focused).toContain('0 0 0 var(--itsm-space-2xs) var(--itsm-colour-focusHalo)');
  });

  it('brings the outline back where the halo cannot be seen: the high-contrast themes and forced colours', () => {
    expect(inputStyles).toContain(':root[data-itsm-theme="high-contrast"] :is(.itsm-Input, .itsm-Textarea, .itsm-Select):focus-visible');
    expect(inputStyles).toMatch(/@media \(prefers-contrast: more\) \{[\s\S]*outline: var\(--itsm-focus-width\) solid var\(--itsm-colour-border-focus\)/);
    expect(inputStyles).toMatch(/@media \(forced-colors: active\) \{[\s\S]*outline: var\(--itsm-border-thick\) solid Highlight/);
  });

  it('haloes an invalid field in danger at 18 % when it has focus', () => {
    const invalid = rule(
      inputStyles,
      '.itsm-Input[aria-invalid="true"]:focus-visible,\n.itsm-Textarea[aria-invalid="true"]:focus-visible,\n.itsm-Select[aria-invalid="true"]:focus-visible,\n.itsm-InputGroup[data-invalid]:has(.itsm-InputGroup__input:focus-visible)',
    );
    expect(invalid).toContain('color-mix(in srgb, var(--itsm-colour-danger-border) 18%, transparent)');
  });

  it('draws disabled on the sunken surface, and the large size at 44 px with the item radius and 15 px text', () => {
    expect(rule(inputStyles, '.itsm-Input:disabled,\n.itsm-Textarea:disabled,\n.itsm-Select:disabled,\n.itsm-InputGroup[data-disabled]')).toContain(
      'background-color: var(--itsm-colour-surface-sunken)',
    );
    const large = rule(inputStyles, '.itsm-Input--lg,\n.itsm-InputGroup--lg,\n.itsm-Select--lg');
    expect(large).toContain('min-block-size: var(--itsm-control-height-lg)');
    expect(large).toContain('border-radius: var(--itsm-radius-item)');
    expect(large).toContain('max(var(--itsm-font-size-md), var(--itsm-input-font-size))');
  });

  it('keeps every size at 16 px or more under a coarse pointer, so iOS does not zoom on focus', () => {
    expect(inputStyles).toMatch(/@media \(pointer: coarse\) \{\s*\.itsm-Input--sm,\s*\.itsm-InputGroup--sm,\s*\.itsm-Select--sm \{\s*font-size: var\(--itsm-input-font-size\);/);
  });

  it('draws the select chevron in text.muted', () => {
    expect(rule(selectStyles, '.itsm-SelectField__chevron')).toContain('color: var(--itsm-colour-text-muted)');
  });
});

describe('Textarea', () => {
  it('hands the caller its ref — object and callback — while still growing itself', () => {
    const objectRef = createRef<HTMLTextAreaElement>();
    const callbackRef = vi.fn();
    render(
      <>
        <Textarea aria-label="One" ref={objectRef} autoGrow value="Hello" onChange={() => undefined} />
        <Textarea aria-label="Two" ref={callbackRef} />
      </>,
    );
    expect(objectRef.current).toBeInstanceOf(HTMLTextAreaElement);
    expect(objectRef.current?.getAttribute('aria-label')).toBe('One');
    // The grow effect ran against the same element the caller holds.
    expect(objectRef.current?.style.height).toMatch(/px$/);
    expect(callbackRef).toHaveBeenCalledWith(expect.any(HTMLTextAreaElement));
  });

  it('submits its form with mod+Enter and says so outside the submit button', () => {
    const onSubmit = vi.fn((event: Event) => event.preventDefault());
    render(
      <form onSubmit={(event) => onSubmit(event.nativeEvent)}>
        <Textarea aria-label="Reply" submitShortcut="mod+enter" submitHint="to send" />
        <button type="submit">Send</button>
      </form>,
    );
    const textarea = document.querySelector('textarea')!;
    expect(textarea.getAttribute('aria-keyshortcuts')).toBe('Meta+Enter Control+Enter');
    expect(document.querySelector('.itsm-TextareaField__hint')?.textContent).toContain('to send');
    expect(document.querySelector('button[type="submit"]')?.textContent).toBe('Send');

    press(textarea, 'Enter');
    expect(onSubmit).not.toHaveBeenCalled();
    press(textarea, 'Enter', { ctrlKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    press(textarea, 'Enter', { metaKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it('calls onSubmitShortcut instead when given one', () => {
    const onSubmitShortcut = vi.fn();
    render(<Textarea aria-label="Note" submitShortcut="mod+enter" onSubmitShortcut={onSubmitShortcut} />);
    press(document.querySelector('textarea')!, 'Enter', { ctrlKey: true });
    expect(onSubmitShortcut).toHaveBeenCalledTimes(1);
  });

  it('counts its own characters and is described by the limit', () => {
    render(<Textarea aria-label="Resolution" counter={{ max: 280 }} value="Replaced the toner." onChange={() => undefined} />);
    expect(document.querySelector('.itsm-Count__value')?.textContent).toBe('19/280');
    const describedBy = document.querySelector('textarea')?.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(describedBy)?.textContent).toBe('Up to 280 characters');
  });
});

describe('Select', () => {
  it('draws the registry chevron and takes the field’s wiring', () => {
    render(
      <FormField label="Team" error="Choose a team.">
        <Select options={[{ value: 'desk', label: 'Service desk' }]} placeholder="Choose…" />
      </FormField>,
    );
    const select = document.querySelector('select')!;
    expect(document.querySelector('label')?.htmlFor).toBe(select.id);
    expect(select.getAttribute('aria-invalid')).toBe('true');
    expect(document.querySelector('.itsm-SelectField svg[data-icon="chevron-down"]')).not.toBeNull();
  });

  it('starts an uncontrolled select on its placeholder, not on the first answer', () => {
    render(<Select aria-label="Team" options={[{ value: 'desk', label: 'Service desk' }]} placeholder="Choose…" />);
    expect(document.querySelector('select')?.value).toBe('');
  });
});

describe('Checkbox', () => {
  it('hands the caller its ref and keeps the indeterminate property', () => {
    const ref = createRef<HTMLInputElement>();
    render(<Checkbox label="Select all" indeterminate ref={ref} />);
    expect(ref.current?.type).toBe('checkbox');
    expect(ref.current?.indeterminate).toBe(true);
  });

  it('toggles from a press in the hit area round the box', () => {
    const onChange = vi.fn();
    render(<Checkbox label="Include closed" onChange={onChange} />);
    click(document.querySelector('.itsm-Checkbox__box')!);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(document.querySelector('input')?.checked).toBe(true);
  });

  it('can hide its label and keep it for assistive technology', () => {
    render(<Checkbox label="Select INC-12" labelHidden />);
    const label = document.querySelector('label')!;
    expect(label.className).toContain('itsm-visually-hidden');
    expect(label.htmlFor).toBe(document.querySelector('input')?.id);
  });
});

describe('RadioGroup cards', () => {
  function Cards(): ReactNode {
    const [value, setValue] = useState<string | null>('team');
    return (
      <RadioGroup
        label="Who sees it"
        variant="cards"
        columns={3}
        value={value}
        onChange={setValue}
        error="Choose who sees it."
        options={[
          { value: 'everyone', label: 'Everyone', description: 'Requesters and agents.', icon: 'people' },
          { value: 'team', label: 'The team', description: 'Agents only.', icon: 'lock' },
          { value: 'me', label: 'Only me', icon: 'user', disabled: true },
        ]}
      />
    );
  }

  it('renders radios as cards with their icons, in a column-aware grid', () => {
    render(<Cards />);
    const group = document.querySelector('[role="radiogroup"]')!;
    expect(group.getAttribute('data-columns')).toBe('3');
    expect(group.getAttribute('aria-orientation')).toBeNull();
    const cards = [...document.querySelectorAll<HTMLElement>('[role="radio"]')];
    expect(cards.map((card) => card.className.includes('itsm-RadioGroup__card'))).toEqual([true, true, true]);
    expect(cards[0]?.querySelector('svg[data-icon="people"]')).not.toBeNull();
    expect(document.querySelector('.itsm-Field__error svg[data-icon="circle-alert"]')).not.toBeNull();
  });

  it('answers every arrow key in a grid, skipping disabled cards', () => {
    render(<Cards />);
    const cards = [...document.querySelectorAll<HTMLElement>('[role="radio"]')];
    focus(cards[1]!);
    press(cards[1]!, 'ArrowRight');
    // "Only me" is disabled, so the next stop wraps to "Everyone".
    expect(activeElement()).toBe(cards[0]);
    expect(cards[0]?.getAttribute('aria-checked')).toBe('true');
    press(cards[0]!, 'ArrowDown');
    expect(activeElement()).toBe(cards[1]);
  });
});

describe('Tabs', () => {
  it('takes a variant and keeps each panel’s text untouched', () => {
    render(
      <Tabs
        label="Sections"
        variant="segmented"
        items={[
          { id: 'a', label: 'Details', content: <p>Details panel</p> },
          { id: 'b', label: 'Tasks', content: <p>Tasks panel</p> },
        ]}
      />,
    );
    expect(document.querySelector('.itsm-Tabs')?.className).toContain('itsm-Tabs--segmented');
    expect(document.querySelector('[role="tab"] .itsm-Tabs__label')?.getAttribute('data-text')).toBe('Details');
    expect(document.querySelector('[role="tabpanel"]')?.textContent).toBe('Details panel');
  });

  it('is the underline look by default', () => {
    render(<Tabs label="Sections" items={[{ id: 'a', label: 'Details', content: <p>Details panel</p> }]} />);
    expect(document.querySelector('.itsm-Tabs')?.className).toContain('itsm-Tabs--underline');
  });

  it('draws a count after the label, accent on the selected tab, and speaks it with the label', () => {
    render(
      <Tabs
        label="Register"
        variant="pill"
        items={[
          { id: 'register', label: 'Register', count: 24, content: <p>Register panel</p> },
          { id: 'overdue', label: 'Overdue', count: 3, content: <p>Overdue panel</p> },
          { id: 'mine', label: 'Mine', count: null, content: <p>Mine panel</p> },
        ]}
      />,
    );
    expect(document.querySelector('.itsm-Tabs')?.className).toContain('itsm-Tabs--pill');
    const tabs = [...document.querySelectorAll<HTMLElement>('[role="tab"]')];
    expect(tabs.map((tab) => spoken(tab))).toEqual(['Register, 24', 'Overdue, 3', 'Mine']);
    expect(tabs.map((tab) => tab.querySelector('.itsm-Count')?.getAttribute('data-tone') ?? null)).toEqual(['accent', 'neutral', null]);
    expect(tabs[0]!.querySelector('.itsm-Count')?.getAttribute('data-size')).toBe('sm');
    click(tabs[1]!);
    expect(tabs.map((tab) => tab.querySelector('.itsm-Count')?.getAttribute('data-tone') ?? null)).toEqual(['neutral', 'accent', null]);
  });

  it('draws the v3 looks: underline 40 px tabs over a hairline, raised pills, a sunken segmented track', () => {
    const underline = rule(tabsStyles, '.itsm-Tabs--underline .itsm-Tabs__tab');
    expect(underline).toContain('min-block-size: calc(var(--itsm-control-height-md) + var(--itsm-space-2xs))');
    expect(underline).toContain('font-size: var(--itsm-text-body-size)');
    expect(rule(tabsStyles, '.itsm-Tabs__tab')).toContain('color: var(--itsm-colour-text-muted)');
    expect(rule(tabsStyles, '.itsm-Tabs--underline .itsm-Tabs__tab::after')).toContain('background-color: var(--itsm-colour-accent)');
    const pill = rule(tabsStyles, '.itsm-Tabs--pill .itsm-Tabs__tab[aria-selected="true"]');
    expect(pill).toContain('var(--itsm-colour-surface-raised)');
    expect(pill).toContain('var(--itsm-colour-border-soft)');
    expect(pill).toContain('var(--itsm-elevation-sm)');
    expect(rule(tabsStyles, '.itsm-Tabs--segmented .itsm-Tabs__list')).toContain('var(--itsm-colour-surface-sunken)');
  });

  it('fades the ends of a row that scrolls, where scroll timelines exist, and never for the segmented track', () => {
    expect(tabsStyles).toContain('@supports (animation-timeline: scroll())');
    expect(tabsStyles).toContain('.itsm-Tabs:not(.itsm-Tabs--segmented) > .itsm-Tabs__list {');
    expect(tabsStyles).toContain('animation-timeline: scroll(self inline)');
    expect(tabsStyles).toMatch(/:dir\(rtl\) \{\s*animation-direction: reverse;/);
    expect(tabsStyles).toContain('@keyframes itsm-scroll-fades');
  });
});

describe('Switch', () => {
  function Harness(props: Partial<SwitchProps> & { readonly initial?: boolean; readonly onChangeSpy?: (next: boolean) => void }): ReactNode {
    const { initial = true, onChangeSpy, ...rest } = props;
    const [checked, setChecked] = useState(initial);
    return (
      <Switch
        label="AI triage"
        {...rest}
        checked={checked}
        onChange={(next) => {
          onChangeSpy?.(next);
          setChecked(next);
        }}
      />
    );
  }

  const toggle = (): HTMLButtonElement => document.querySelector<HTMLButtonElement>('button[role="switch"]')!;
  const danger = { title: 'Turn off AI for everyone?', confirmLabel: 'Turn off AI', tone: 'danger' as const };

  it('flips at once without a confirmation, and its label flips it too', () => {
    const onChangeSpy = vi.fn();
    render(<Harness initial={false} onChangeSpy={onChangeSpy} />);
    click(toggle());
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    click(document.querySelector('label')!);
    expect(onChangeSpy).toHaveBeenLastCalledWith(false);
    expect(toggle().getAttribute('aria-checked')).toBe('false');
  });

  it('with `confirm`, keeps aria-checked until the change is confirmed', async () => {
    const onChangeSpy = vi.fn();
    render(<Harness confirm={danger} onChangeSpy={onChangeSpy} />);
    click(toggle());
    await flush();
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog?.getAttribute('aria-label')).toBe('Turn off AI for everyone?');
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    expect(onChangeSpy).not.toHaveBeenCalled();

    click(byText('button', 'Turn off AI'));
    await flush();
    expect(onChangeSpy).toHaveBeenCalledWith(false);
    expect(toggle().getAttribute('aria-checked')).toBe('false');
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(activeElement()).toBe(toggle());
  });

  it('keeps its state when the question is cancelled, and gets focus back', async () => {
    const onChangeSpy = vi.fn();
    render(<Harness confirm={danger} onChangeSpy={onChangeSpy} />);
    click(toggle());
    await flush();
    click(byText('button', 'Cancel'));
    await flush();
    expect(onChangeSpy).not.toHaveBeenCalled();
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    expect(activeElement()).toBe(toggle());
  });

  it('asks only in the direction it was given', async () => {
    const onChangeSpy = vi.fn();
    render(<Harness initial={false} confirm={{ off: danger }} onChangeSpy={onChangeSpy} />);
    click(toggle());
    await flush();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(onChangeSpy).toHaveBeenLastCalledWith(true);
    click(toggle());
    await flush();
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(toggle().getAttribute('aria-checked')).toBe('true');
  });

  it('waits for onRequestChange, busy, and moves only if it agrees', async () => {
    let settle: (value: boolean) => void = () => undefined;
    const onRequestChange = vi.fn(() => new Promise<boolean>((resolve) => (settle = resolve)));
    const onChangeSpy = vi.fn();
    render(<Harness onRequestChange={onRequestChange} onChangeSpy={onChangeSpy} />);

    click(toggle());
    expect(onRequestChange).toHaveBeenCalledWith(false);
    expect(toggle().getAttribute('aria-busy')).toBe('true');
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    // A second press while it waits does nothing.
    click(toggle());
    expect(onRequestChange).toHaveBeenCalledTimes(1);

    await act(async () => settle(false));
    expect(onChangeSpy).not.toHaveBeenCalled();
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    expect(toggle().getAttribute('aria-busy')).toBeNull();

    click(toggle());
    await act(async () => settle(true));
    expect(onChangeSpy).toHaveBeenCalledWith(false);
    expect(toggle().getAttribute('aria-checked')).toBe('false');
  });

  it('runs onRequestChange from the dialog and stays open with the error if it fails', async () => {
    const onRequestChange = vi.fn(() => Promise.reject(new Error('The setting could not be saved')));
    const onChangeSpy = vi.fn();
    render(<Harness confirm={danger} onRequestChange={onRequestChange} onChangeSpy={onChangeSpy} />);
    click(toggle());
    await flush();
    click(byText('button', 'Turn off AI'));
    await flush();
    expect(onRequestChange).toHaveBeenCalledWith(false);
    expect(document.querySelector('[role="alertdialog"] [role="alert"]')?.textContent).toContain('could not be saved');
    expect(onChangeSpy).not.toHaveBeenCalled();
    expect(toggle().getAttribute('aria-checked')).toBe('true');
  });

  it('does nothing while disabled', () => {
    const onChangeSpy = vi.fn();
    render(<Harness disabled onChangeSpy={onChangeSpy} />);
    click(toggle());
    expect(onChangeSpy).not.toHaveBeenCalled();
    expect(toggle().getAttribute('aria-disabled')).toBe('true');
  });

  it('takes a size and the row layout', () => {
    render(<Harness size="sm" layout="row" />);
    expect(toggle().className).toContain('itsm-Switch--sm');
    expect(document.querySelector('.itsm-SwitchField')?.className).toContain('itsm-SwitchField--row');
  });
});
