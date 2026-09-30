// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Combobox, type ComboboxOption } from '../../web/Combobox.js';
import { DatePicker } from '../../web/DatePicker.js';
import { Dialog } from '../../web/Dialog.js';
import { activeElement, cleanupDocument, click, focus, press, render, settle } from '../../web/__tests__/support/render.js';

/**
 * `Combobox` and `DatePicker` draw their field at once and fetch the popover
 * (Radix, its positioning, the calendar) on intent — so a form that merely
 * contains one, such as the portal's catalogue item, does not carry ~25 kB of
 * overlay code in its first load (SPEC §3.7). These tests hold the layer back
 * until they say so, and check the seams: nothing typed or focused is lost,
 * ARIA references resolve while it loads, Escape still closes the list before
 * a dialog around it, and a calendar asked for early opens when it lands.
 */

const gate = vi.hoisted(() => {
  let release: () => void = () => undefined;
  const arrived = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { arrived, release: () => release() };
});

vi.mock('../../web/PopoverLayer.js', async (importOriginal) => {
  await gate.arrived;
  return importOriginal();
});
vi.mock('../../web/IconButtonTooltip.js', () => ({ IconButtonTooltip: () => null }));

afterEach(() => cleanupDocument());

const source = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Every module reachable from `entry` by static, non-type imports. */
function staticGraph(entry: string): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  const queue = [join(source, entry)];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (graph.has(file)) continue;
    const specifiers = [...readFileSync(file, 'utf8').matchAll(/^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm)].map((match) => match[1]!);
    graph.set(file, specifiers);
    for (const specifier of specifiers) {
      if (!specifier.startsWith('.')) continue;
      const base = resolve(dirname(file), specifier.replace(/\.js$/, ''));
      const next = [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')].find((candidate) => existsSync(candidate));
      if (next) queue.push(next);
    }
  }
  return graph;
}

describe('what a form carries in its first load', () => {
  it.each(['web/Combobox.tsx', 'web/DatePicker.tsx', 'forms/FormRenderer.tsx'])('%s reaches no Radix module statically', (entry) => {
    const offenders = [...staticGraph(entry)].flatMap(([file, specifiers]) =>
      specifiers.filter((specifier) => specifier.startsWith('@radix-ui/')).map((specifier) => `${file.slice(source.length)} → ${specifier}`),
    );
    expect(offenders).toEqual([]);
  });
});

const people: ComboboxOption[] = [
  { value: 'sam', label: 'Sam Agent' },
  { value: 'jo', label: 'Jo Resolver' },
];

function Picker(): ReactNode {
  const [value, setValue] = useState<ComboboxOption | null>(null);
  return <Combobox aria-label="Assignee" value={value} onChange={setValue} options={people} />;
}

function InDialog(): ReactNode {
  const [open, setOpen] = useState(true);
  const [value, setValue] = useState<ComboboxOption | null>(null);
  return (
    <Dialog open={open} onClose={() => setOpen(false)} title="Assign ticket">
      <Combobox aria-label="Assignee" value={value} onChange={setValue} options={people} />
    </Dialog>
  );
}

function DateField(): ReactNode {
  const [value, setValue] = useState<string | null>('2026-03-14');
  return <DatePicker aria-label="Needed by" locale="en-GB" value={value} onChange={setValue} />;
}

/** Waits (in act) until `ready` holds — the real import takes a moment once released — or fails after 2 s. */
async function until(ready: () => boolean): Promise<void> {
  for (let waited = 0; waited < 2000 && !ready(); waited += 20) await settle(20);
  expect(ready()).toBe(true);
}

const combobox = (): HTMLInputElement => document.querySelector<HTMLInputElement>('[role="combobox"]')!;

// In order: the first three run before the layer has arrived.
describe('before the popover has arrived', () => {
  it('opens the list in place, hidden, with every ARIA reference resolving; a choice still works', async () => {
    render(<Picker />);
    const input = combobox();
    focus(input);
    press(input, 'ArrowDown');
    await settle();

    expect(input.getAttribute('aria-expanded')).toBe('true');
    const listbox = document.getElementById(input.getAttribute('aria-controls')!)!;
    expect(listbox.getAttribute('role')).toBe('listbox');
    expect(listbox.closest('[hidden]')).not.toBeNull();
    expect(document.getElementById(input.getAttribute('aria-activedescendant')!)?.textContent).toContain('Sam Agent');

    press(input, 'Enter');
    expect(input.value).toBe('Sam Agent');
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps the first Escape for the list, not the dialog around it', async () => {
    render(<InDialog />);
    const input = combobox();
    focus(input);
    press(input, 'ArrowDown');
    await settle();
    press(input, 'Escape');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    press(input, 'Escape');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('remembers a calendar asked for, and opens it on the chosen day when the layer lands', async () => {
    render(<DateField />);
    const toggle = document.querySelector<HTMLButtonElement>('.itsm-DatePicker__toggle')!;
    expect(toggle.getAttribute('aria-haspopup')).toBe('dialog');
    focus(toggle);
    click(toggle);
    await settle();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.hasAttribute('aria-controls')).toBe(false);
    expect(document.querySelector('.itsm-DatePicker__popover')).toBeNull();

    gate.release();
    await until(() => document.querySelector('.itsm-DatePicker__popover') !== null);
    const calendar = document.querySelector('.itsm-DatePicker__popover')!;
    expect(calendar.getAttribute('role')).toBe('dialog');
    expect(toggle.getAttribute('aria-controls')).toBe(calendar.id);
    expect(activeElement()?.getAttribute('data-date')).toBe('2026-03-14');
  });
});

describe('once it has arrived', () => {
  it('moves the list into the popover without remounting the field, so focus and text stay', async () => {
    render(<Picker />);
    const input = combobox();
    focus(input);
    press(input, 'ArrowDown');
    await settle(20);
    expect(combobox()).toBe(input);
    expect(activeElement()).toBe(input);
    const listbox = document.getElementById(input.getAttribute('aria-controls')!)!;
    expect(listbox.closest('[hidden]')).toBeNull();
    expect(listbox.closest('.itsm-Combobox__popup')).not.toBeNull();
    expect(document.querySelectorAll('[role="listbox"]')).toHaveLength(1);
  });

  it('renders at once for every later field, and a press on the calendar button toggles it closed', async () => {
    render(<DateField />);
    const toggle = document.querySelector<HTMLButtonElement>('.itsm-DatePicker__toggle')!;
    click(toggle);
    expect(document.querySelector('.itsm-DatePicker__popover')).not.toBeNull();
    expect(toggle.getAttribute('data-state')).toBe('open');
    click(toggle);
    await settle();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('data-state')).toBe('closed');
  });
});
