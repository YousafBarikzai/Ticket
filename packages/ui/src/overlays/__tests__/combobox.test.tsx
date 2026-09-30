// @vitest-environment jsdom
import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Combobox, type ComboboxOption } from '../../web/Combobox.js';
import { FormField } from '../../web/FormField.js';
import { activeElement, cleanupDocument, click, focus, press, render, settle, typeInto } from '../../web/__tests__/support/render.js';
import { PersonPicker, type PersonOption } from '../PersonPicker.js';

afterEach(() => cleanupDocument());

const services: ComboboxOption[] = [
  { value: 'laptop', label: 'Laptop', group: 'Hardware' },
  { value: 'monitor', label: 'Monitor', group: 'Hardware' },
  { value: 'vpn', label: 'VPN access', group: 'Access', description: 'Remote working' },
  { value: 'badge', label: 'Building badge', group: 'Access', disabled: true },
];

const input = (): HTMLInputElement => document.querySelector<HTMLInputElement>('[role="combobox"]')!;
const options = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[role="option"]')];
const active = (): HTMLElement | undefined => options().find((option) => option.dataset.active === 'true');

function Single(props: { readonly creatable?: boolean; readonly onPick?: (option: ComboboxOption | null) => void }): ReactNode {
  const [value, setValue] = useState<ComboboxOption | null>(null);
  return (
    <FormField label="Service">
      <Combobox
        value={value}
        onChange={(next) => {
          setValue(next);
          props.onPick?.(next);
        }}
        options={services}
        {...(props.creatable ? { creatable: { label: (query: string) => `Create “${query}”` } } : {})}
      />
    </FormField>
  );
}

function Multiple({ onChange }: { readonly onChange?: (options: ComboboxOption[]) => void }): ReactNode {
  const [value, setValue] = useState<ComboboxOption[]>([services[0]!, services[2]!]);
  return (
    <Combobox
      aria-label="Services"
      multiple
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
      options={services}
    />
  );
}

describe('Combobox', () => {
  it('is labelled by its field, and keeps focus in the input while the cursor moves', async () => {
    render(<Single />);
    const field = input();
    expect(document.querySelector(`label[for="${field.id}"]`)?.textContent).toContain('Service');
    focus(field);
    press(field, 'ArrowDown');
    await settle();
    expect(field.getAttribute('aria-expanded')).toBe('true');
    expect(field.getAttribute('aria-controls')).toBe(document.querySelector('[role="listbox"]')!.id);
    expect(field.getAttribute('aria-activedescendant')).toBe(active()!.id);
    press(field, 'ArrowDown');
    expect(active()!.textContent).toContain('Monitor');
    expect(activeElement()).toBe(field);
  });

  it('lists options under their group headings, as groups', async () => {
    render(<Single />);
    focus(input());
    press(input(), 'ArrowDown');
    await settle();
    const groups = [...document.querySelectorAll<HTMLElement>('[role="listbox"] [role="group"]')];
    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual(['Hardware', 'Access']);
    expect(groups[1]!.querySelectorAll('[role="option"]')).toHaveLength(2);
  });

  it('skips unavailable options and chooses with Enter', async () => {
    const onPick = vi.fn();
    render(<Single onPick={onPick} />);
    focus(input());
    press(input(), 'ArrowDown');
    await settle();
    press(input(), 'End');
    expect(active()!.getAttribute('aria-disabled')).toBe('true');
    press(input(), 'Enter');
    expect(onPick).not.toHaveBeenCalled();
    press(input(), 'ArrowUp');
    press(input(), 'Enter');
    await settle();
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ value: 'vpn' }));
    expect(input().value).toBe('VPN access');
    expect(input().getAttribute('aria-expanded')).toBe('false');
  });

  it('clears with its clear button, and puts focus back in the field', async () => {
    const onPick = vi.fn();
    render(<Single onPick={onPick} />);
    focus(input());
    typeInto(input(), 'lap');
    await settle();
    press(input(), 'Enter');
    await settle();
    const clear = document.querySelector<HTMLButtonElement>('.itsm-InputGroup__clear')!;
    expect(clear.getAttribute('aria-label')).toBe('Clear');
    click(clear);
    expect(onPick).toHaveBeenLastCalledWith(null);
    expect(activeElement()).toBe(input());
  });

  it('offers what was typed as a new option when nothing matches it exactly', async () => {
    const onPick = vi.fn();
    render(<Single creatable onPick={onPick} />);
    focus(input());
    typeInto(input(), 'Printer');
    await settle();
    const create = options().at(-1)!;
    expect(create.textContent).toContain('Create “Printer”');
    click(create);
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ value: 'Printer', label: 'Printer', created: true }));

    typeInto(input(), 'Laptop');
    await settle();
    expect(options().some((option) => option.textContent?.includes('Create'))).toBe(false);
  });

  it('holds several choices as chips, toggles them from the list, and removes the last with Backspace', async () => {
    const onChange = vi.fn();
    render(<Multiple onChange={onChange} />);
    const chips = (): string[] => [...document.querySelectorAll('.itsm-Combobox__chipLabel')].map((chip) => chip.textContent ?? '');
    expect(chips()).toEqual(['Laptop', 'VPN access']);

    focus(input());
    press(input(), 'ArrowDown');
    await settle();
    expect(document.querySelector('[role="listbox"]')!.getAttribute('aria-multiselectable')).toBe('true');
    // Monitor is added; Laptop, already chosen, is taken away again.
    click(options().find((option) => option.textContent?.includes('Monitor'))!);
    expect(chips()).toEqual(['Laptop', 'VPN access', 'Monitor']);
    click(options().find((option) => option.textContent?.includes('Laptop'))!);
    expect(chips()).toEqual(['VPN access', 'Monitor']);

    press(input(), 'Backspace');
    expect(chips()).toEqual(['VPN access']);

    click(document.querySelector<HTMLButtonElement>('[aria-label="Remove VPN access"]')!);
    expect(chips()).toEqual([]);
    expect(activeElement()).toBe(input());
  });

  it('searches through the injected loader, debounced, and says when there is nothing', async () => {
    const loadOptions = vi.fn(async (query: string) => services.filter((option) => option.label.toLowerCase().startsWith(query)));
    function Async(): ReactNode {
      const [value, setValue] = useState<ComboboxOption | null>(null);
      return <Combobox aria-label="Service" value={value} onChange={setValue} loadOptions={loadOptions} minQueryLength={2} />;
    }
    render(<Async />);
    focus(input());
    typeInto(input(), 'l');
    await settle(250);
    expect(loadOptions).not.toHaveBeenCalled();
    expect(document.querySelector('.itsm-Combobox__status')?.textContent).toBe('Type at least 2 characters');

    typeInto(input(), 'la');
    typeInto(input(), 'lap');
    await settle(250);
    expect(loadOptions).toHaveBeenCalledTimes(1);
    expect(loadOptions.mock.calls[0]![0]).toBe('lap');
    expect(options().map((option) => option.textContent)).toEqual(['Laptop']);

    typeInto(input(), 'zzz');
    await settle(250);
    expect(document.querySelector('.itsm-Combobox__status')?.textContent).toBe('No matches');
  });
});

describe('PersonPicker', () => {
  const people: PersonOption[] = [
    { id: 'u1', name: 'Sam Agent', detail: 'sam@example.com' },
    { id: 'u2', name: 'Jo Resolver', detail: 'Network team' },
  ];
  const me: PersonOption = { id: 'u9', name: 'Ada Lovelace' };

  it('shows people with avatars and availability spoken after the name', async () => {
    const loadPeople = vi.fn(async () => people);
    function Picker(): ReactNode {
      const [value, setValue] = useState<PersonOption | PersonOption[] | null>(null);
      return <PersonPicker aria-label="Assignee" value={value} onChange={setValue} loadPeople={loadPeople} availability={{ u2: 'busy' }} />;
    }
    render(<Picker />);
    focus(input());
    typeInto(input(), 'o');
    await settle(250);
    const jo = options().find((option) => option.textContent?.includes('Jo Resolver'))!;
    expect(jo.querySelector('.itsm-Avatar')).not.toBeNull();
    expect(jo.textContent).toContain('Jo Resolver, busy');
    expect(jo.textContent).toContain('Network team');
  });

  it('pins "Assign to me" and "Unassigned", which choose the person and nobody', async () => {
    const onChange = vi.fn();
    render(
      <PersonPicker
        aria-label="Assignee"
        value={people[0]!}
        onChange={onChange}
        loadPeople={async () => people}
        me={me}
        extras={{ assignToMe: true, unassign: true }}
      />,
    );
    focus(input());
    press(input(), 'ArrowDown');
    await settle(250);
    const labels = options().map((option) => option.textContent ?? '');
    expect(labels[0]).toContain('Assign to me');
    expect(labels[1]).toContain('Unassigned');

    click(options()[0]!);
    expect(onChange).toHaveBeenLastCalledWith(me);
    press(input(), 'ArrowDown');
    await settle(250);
    click(options()[1]!);
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});
