// @vitest-environment jsdom
import { act, useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { announcerText, destroyAnnouncer } from '../../a11y/announcer.js';
import { TestProvider } from '../../provider/__tests__/support/provider.js';
import { activeElement, cleanupDocument, click, focus, press, render, selectOption, settle, typeInto } from '../../web/__tests__/support/render.js';
import { InlineEdit, type InlineEditProps, type InlineEditResult } from '../InlineEdit.js';

/*
 * `InlineEdit` (SPEC §4.4): at rest a button that names the value; Enter or
 * a click edits; Enter saves, Escape cancels, focus comes home; the save is
 * optimistic, rolled back with a message on failure, and a conflict is
 * settled in place.
 */

vi.mock('../../overlays/Toaster.js', () => ({ Toaster: () => null }));

afterEach(() => {
  cleanupDocument();
  destroyAnnouncer();
  vi.useRealTimers();
});

/** The value lives in the parent, as it does in an application. */
function Harness(props: Partial<InlineEditProps> & { readonly initial?: string; readonly save?: (next: string) => Promise<InlineEditResult> }): ReactNode {
  const [value, setValue] = useState(props.initial ?? 'Printer jammed');
  return (
    <TestProvider>
      <InlineEdit
        label="Title"
        {...props}
        value={value}
        onSave={async (next) => {
          const result = await (props.save ?? (async () => undefined))(next);
          if (!result) setValue(next);
          return result;
        }}
      />
      <button type="button">Elsewhere</button>
    </TestProvider>
  );
}

const trigger = (): HTMLButtonElement => {
  const button = document.querySelector<HTMLButtonElement>('.itsm-InlineEdit__trigger');
  if (!button) throw new Error('not at rest');
  return button;
};

const editor = <T extends HTMLElement = HTMLInputElement>(): T => {
  const element = document.querySelector<T>('.itsm-InlineEdit__control input:not([type="hidden"]), .itsm-InlineEdit__control textarea, .itsm-InlineEdit__control select');
  if (!element) throw new Error('not editing');
  return element;
};

/** A save the test resolves when it chooses. */
function deferred(): { readonly save: (next: string) => Promise<InlineEditResult>; resolve(result: InlineEditResult): Promise<void>; readonly calls: string[] } {
  let settleSave: (result: InlineEditResult) => void = () => undefined;
  const calls: string[] = [];
  return {
    calls,
    save: (next) => {
      calls.push(next);
      return new Promise<InlineEditResult>((resolve) => (settleSave = resolve));
    },
    async resolve(result) {
      await act(async () => {
        settleSave(result);
      });
      await settle(40);
    },
  };
}

describe('InlineEdit at rest', () => {
  it('is a button named for what it edits, with the value in its name', () => {
    render(<Harness />);
    expect(trigger().textContent).toBe('Edit Title, Printer jammed');
    expect(trigger().querySelector('.itsm-InlineEdit__adornment svg')).not.toBeNull();
  });

  it('shows the placeholder, muted, when there is no value', () => {
    render(<Harness initial="" placeholder="Add a title" />);
    const value = trigger().querySelector('.itsm-InlineEdit__value');
    expect(value?.textContent).toBe('Add a title');
    expect(value?.hasAttribute('data-empty')).toBe(true);
  });

  it('explains instead of editing when the value is read-only', () => {
    render(<Harness readOnlyReason="Managed by a workflow" />);
    expect(trigger().getAttribute('aria-disabled')).toBe('true');
    const reason = document.getElementById(trigger().getAttribute('aria-describedby') ?? '');
    expect(reason?.textContent).toBe('Managed by a workflow');
    click(trigger());
    expect(document.querySelector('.itsm-InlineEdit__control')).toBeNull();
  });
});

describe('InlineEdit editing a line of text', () => {
  it('opens with the value focused, and Escape cancels back to the button', () => {
    render(<Harness />);
    click(trigger());
    expect(activeElement()).toBe(editor());
    expect(editor().value).toBe('Printer jammed');
    expect(editor().getAttribute('aria-label')).toBe('Title');

    typeInto(editor(), 'Something else');
    press(editor(), 'Escape');
    expect(trigger().textContent).toContain('Printer jammed');
    expect(activeElement()).toBe(trigger());
  });

  it('saves with Enter, optimistically, then says "Saved"', async () => {
    const save = deferred();
    render(<Harness save={save.save} />);
    click(trigger());
    typeInto(editor(), 'Printer on floor 3 jammed');
    press(editor(), 'Enter');

    // At once: the new value, busy, and focus back on the button.
    expect(save.calls).toEqual(['Printer on floor 3 jammed']);
    expect(trigger().textContent).toContain('Printer on floor 3 jammed');
    expect(trigger().getAttribute('aria-busy')).toBe('true');
    expect(activeElement()).toBe(trigger());

    await save.resolve(undefined);
    expect(trigger().getAttribute('aria-busy')).toBeNull();
    expect(trigger().textContent).toContain('Printer on floor 3 jammed');
    expect(announcerText('polite')).toBe('Saved');
  });

  it('does not save a value that did not change', () => {
    const save = vi.fn(async () => undefined);
    render(<Harness save={save} />);
    click(trigger());
    press(editor(), 'Enter');
    expect(save).not.toHaveBeenCalled();
    expect(activeElement()).toBe(trigger());
  });

  it('cannot be opened again while a save is in flight', async () => {
    const save = deferred();
    render(<Harness save={save.save} />);
    click(trigger());
    typeInto(editor(), 'Renamed');
    press(editor(), 'Enter');
    click(trigger());
    expect(document.querySelector('.itsm-InlineEdit__control')).toBeNull();
    await save.resolve(undefined);
  });

  it('rolls back with the reason, said at once, and brings the typed text back on the next try', async () => {
    const save = deferred();
    render(<Harness save={save.save} />);
    click(trigger());
    typeInto(editor(), 'Printer on fire');
    press(editor(), 'Enter');
    await save.resolve({ error: 'Titles cannot mention fire' });

    expect(trigger().textContent).toContain('Printer jammed');
    const message = document.getElementById((trigger().getAttribute('aria-describedby') ?? '').split(' ')[0] ?? '');
    expect(message?.textContent).toBe('Titles cannot mention fire');
    expect(announcerText('assertive')).toBe('Titles cannot mention fire');

    click(trigger());
    expect(editor().value).toBe('Printer on fire');
  });

  it('reports a save that throws as a failure, not a crash', async () => {
    render(
      <Harness
        save={async () => {
          throw new Error('offline');
        }}
      />,
    );
    click(trigger());
    typeInto(editor(), 'New title');
    press(editor(), 'Enter');
    await settle(40);
    expect(document.querySelector('.itsm-InlineEdit__message')?.textContent).toBe("Couldn't save that. Try again.");
    expect(trigger().textContent).toContain('Printer jammed');
  });

  it('keeps the editor open with the problem when the value is not valid', () => {
    const save = vi.fn(async () => undefined);
    render(<Harness save={save} validate={(value) => (value.trim() === '' ? 'Enter a title' : null)} />);
    click(trigger());
    typeInto(editor(), '   ');
    press(editor(), 'Enter');
    expect(save).not.toHaveBeenCalled();
    expect(editor().getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(editor().getAttribute('aria-describedby') ?? '')?.textContent).toBe('Enter a title');
  });

  it('saves when focus leaves the field, without pulling focus back', async () => {
    const save = vi.fn(async () => undefined);
    render(<Harness save={save} />);
    click(trigger());
    typeInto(editor(), 'Renamed');
    const elsewhere = [...document.querySelectorAll('button')].find((button) => button.textContent === 'Elsewhere')!;
    focus(elsewhere);
    await settle(40);
    expect(save).toHaveBeenCalledWith('Renamed');
    expect(activeElement()).toBe(elsewhere);
  });

  it('offers Save and Cancel buttons that keep focus in the field until pressed', async () => {
    const save = vi.fn(async () => undefined);
    render(<Harness save={save} />);
    click(trigger());
    typeInto(editor(), 'Renamed');
    const saveButton = document.querySelector<HTMLButtonElement>('button[aria-label="Save Title"]');
    expect(saveButton).not.toBeNull();
    click(saveButton!);
    expect(save).toHaveBeenCalledWith('Renamed');
    await settle(40);
  });
});

describe('InlineEdit conflicts', () => {
  it('settles someone else’s change in place: use theirs', async () => {
    const save = deferred();
    const onConflictResolved = vi.fn();
    render(<Harness initial="P2" editor="select" options={[{ value: 'P1', label: 'P1 · Critical' }, { value: 'P2', label: 'P2 · High' }, { value: 'P3', label: 'P3 · Moderate' }]} save={save.save} onConflictResolved={onConflictResolved} label="Priority" />);
    click(trigger());
    selectOption(editor<HTMLSelectElement>(), 'P3');
    expect(save.calls).toEqual(['P3']);
    await save.resolve({ conflict: { theirs: 'P1', by: 'Jo' } });

    const conflict = document.querySelector('.itsm-InlineEdit__conflict');
    expect(conflict?.textContent).toContain('Jo changed this to P1 · Critical');
    // The saved truth shows, and the choice has focus.
    expect(trigger().textContent).toContain('P1 · Critical');
    expect(activeElement()?.textContent).toBe('Use theirs');
    expect(announcerText('assertive')).toContain('Jo changed Priority to P1 · Critical before you');

    click(activeElement()!);
    expect(onConflictResolved).toHaveBeenCalledWith('theirs', 'P1');
    expect(document.querySelector('.itsm-InlineEdit__conflict')).toBeNull();
    expect(trigger().textContent).toContain('P1 · Critical');
    expect(activeElement()).toBe(trigger());
  });

  it('settles someone else’s change in place: keep mine saves again', async () => {
    const save = deferred();
    render(<Harness initial="P2" editor="select" options={[{ value: 'P1', label: 'P1' }, { value: 'P2', label: 'P2' }, { value: 'P3', label: 'P3' }]} save={save.save} label="Priority" />);
    click(trigger());
    selectOption(editor<HTMLSelectElement>(), 'P3');
    await save.resolve({ conflict: { theirs: 'P1' } });
    expect(document.querySelector('.itsm-InlineEdit__conflict')?.textContent).toContain('Someone else changed this to P1');

    const keep = [...document.querySelectorAll('button')].find((button) => button.textContent === 'Keep mine')!;
    click(keep);
    expect(save.calls).toEqual(['P3', 'P3']);
    await save.resolve(undefined);
    expect(trigger().textContent).toContain('P3');
  });
});

describe('InlineEdit editors', () => {
  it('text area: Enter is a new line, mod+Enter saves', async () => {
    const save = vi.fn(async () => undefined);
    render(<Harness editor="textarea" save={save} label="Description" />);
    click(trigger());
    const area = editor<HTMLTextAreaElement>();
    typeInto(area, 'Line one');
    press(area, 'Enter');
    expect(save).not.toHaveBeenCalled();
    press(area, 'Enter', { ctrlKey: true });
    expect(save).toHaveBeenCalledWith('Line one');
    await settle(40);
  });

  it('select: a pick saves at once, an arrow on the closed control only moves the choice', async () => {
    const save = vi.fn(async () => undefined);
    const options = [
      { value: 'open', label: 'Open' },
      { value: 'paused', label: 'Paused' },
      { value: 'resolved', label: 'Resolved' },
    ];
    render(<Harness initial="open" editor="select" options={options} save={save} label="Status" />);
    click(trigger());
    const select = editor<HTMLSelectElement>();
    press(select, 'ArrowDown');
    selectOption(select, 'paused');
    expect(save).not.toHaveBeenCalled();
    press(select, 'Enter');
    expect(save).toHaveBeenCalledWith('paused');
    await settle(40);

    click(trigger());
    selectOption(editor<HTMLSelectElement>(), 'resolved');
    expect(save).toHaveBeenLastCalledWith('resolved');
    await settle(40);
  });

  it('combobox: fetched on intent, a choice saves and reads as its label', async () => {
    const save = vi.fn(async () => undefined);
    const options = [
      { value: 'net', label: 'Networking' },
      { value: 'hw', label: 'Hardware' },
    ];
    render(<Harness initial="" editor="combobox" options={options} save={save} label="Category" />);
    click(trigger());
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    await settle(10);
    const input = editor();
    expect(input.getAttribute('role')).toBe('combobox');
    expect(activeElement()).toBe(input);

    typeInto(input, 'hard');
    await settle(10);
    const option = [...document.querySelectorAll('[role="option"]')].find((candidate) => candidate.textContent?.includes('Hardware'));
    if (!option) throw new Error('no option');
    act(() => {
      option.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      option.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await settle(10);
    expect(save).toHaveBeenCalledWith('hw');
    expect(trigger().textContent).toContain('Hardware');
  });

  it('date: a typed date saves as an ISO day, and unreadable text is refused', async () => {
    const save = vi.fn(async () => undefined);
    render(<Harness initial="2026-03-14" editor="date" save={save} label="Due" />);
    // At rest, the reader's date.
    expect(trigger().textContent).toContain('14 Mar 2026');
    click(trigger());
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    await settle(10);
    const input = editor();
    typeInto(input, 'not a date');
    press(input, 'Enter');
    await settle(10);
    expect(save).not.toHaveBeenCalled();
    expect(document.querySelector('.itsm-InlineEdit__message')?.textContent).toBe('Enter a real date, or clear the box');

    typeInto(input, '21/04/2026');
    press(input, 'Enter');
    await settle(10);
    expect(save).toHaveBeenCalledWith('2026-04-21');
  });

  it('date: leaving the date as it was saves nothing', async () => {
    const save = vi.fn(async () => undefined);
    render(<Harness initial="2026-03-14" editor="date" save={save} label="Due" />);
    click(trigger());
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    await settle(10);
    press(editor(), 'Enter');
    await settle(10);
    expect(save).not.toHaveBeenCalled();
    expect(activeElement()).toBe(trigger());
  });

  it('person: a choice saves the id; Escape cancels rather than clearing the assignee', async () => {
    const save = vi.fn(async () => undefined);
    const people = [
      { value: 'u-1', label: 'Jo Resolver' },
      { value: 'u-2', label: 'Ada Lovelace' },
    ];
    render(
      <Harness
        initial="u-1"
        editor="person"
        options={people}
        loadOptions={async (query) => people.filter((person) => person.label.toLowerCase().includes(query.toLowerCase()))}
        save={save}
        label="Assignee"
      />,
    );
    expect(trigger().textContent).toContain('Jo Resolver');
    click(trigger());
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    await settle(10);
    expect(editor().getAttribute('role')).toBe('combobox');

    // Escape on the closed field: the edit is abandoned, the assignee kept.
    press(editor(), 'Escape');
    expect(save).not.toHaveBeenCalled();
    expect(activeElement()).toBe(trigger());
    expect(trigger().textContent).toContain('Jo Resolver');

    click(trigger());
    await settle(10);
    typeInto(editor(), 'ada');
    await settle(300);
    const option = [...document.querySelectorAll('[role="option"]')].find((candidate) => candidate.textContent?.includes('Ada Lovelace'));
    if (!option) throw new Error('no option');
    act(() => {
      option.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      option.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await settle(10);
    expect(save).toHaveBeenCalledWith('u-2');
    expect(trigger().textContent).toContain('Ada Lovelace');
  });
});
