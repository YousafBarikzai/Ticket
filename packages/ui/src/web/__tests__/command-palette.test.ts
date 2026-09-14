// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { activeElement, cleanupDocument, click, press, render, typeInto } from './support/render.js';
import { CommandPaletteHarness } from './support/fixtures.js';
import { rankCommands, type CommandItem } from '../CommandPalette.js';

afterEach(() => cleanupDocument());

function commands(run: (id: string) => void): readonly CommandItem[] {
  return [
    { id: 'new-ticket', label: 'Create ticket', group: 'Tickets', shortcut: 'C', run: () => run('new-ticket') },
    { id: 'my-queue', label: 'Go to my queue', group: 'Tickets', keywords: ['inbox'], run: () => run('my-queue') },
    { id: 'assign', label: 'Assign to me', group: 'Tickets', disabled: true, run: () => run('assign') },
    { id: 'kb', label: 'Search knowledge', group: 'Knowledge', description: 'Find an article', run: () => run('kb') },
  ];
}

function openPalette(run: (id: string) => void = () => undefined) {
  render(createElement(CommandPaletteHarness, { commands: commands(run) }));
  const input = document.querySelector<HTMLInputElement>('.itsm-CommandPalette__input');
  if (!input) throw new Error('palette did not open');
  return input;
}

const options = (): readonly HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[role="option"]')];
const activeOption = (): HTMLElement | undefined => options().find((option) => option.dataset.active === 'true');

describe('CommandPalette keyboard navigation', () => {
  it('is a modal combobox and takes focus on open', () => {
    const input = openPalette();
    const dialog = document.querySelector<HTMLElement>('.itsm-CommandPalette');
    expect(dialog?.getAttribute('role')).toBe('dialog');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(activeElement()).toBe(input);
  });

  it('starts on the first command and publishes it with aria-activedescendant', () => {
    const input = openPalette();
    expect(options()).toHaveLength(4);
    expect(activeOption()?.textContent).toContain('Create ticket');
    expect(input.getAttribute('aria-activedescendant')).toBe(activeOption()?.id);
  });

  it('moves down and up with the arrow keys, skipping disabled commands', () => {
    const input = openPalette();

    press(input, 'ArrowDown');
    expect(activeOption()?.textContent).toContain('Go to my queue');

    // "Assign to me" is disabled, so the next stop is the knowledge command.
    press(input, 'ArrowDown');
    expect(activeOption()?.textContent).toContain('Search knowledge');

    press(input, 'ArrowUp');
    expect(activeOption()?.textContent).toContain('Go to my queue');
  });

  it('wraps at the ends and jumps with Home and End', () => {
    const input = openPalette();

    press(input, 'ArrowUp');
    expect(activeOption()?.textContent).toContain('Search knowledge');

    press(input, 'Home');
    expect(activeOption()?.textContent).toContain('Create ticket');

    press(input, 'End');
    expect(activeOption()?.textContent).toContain('Search knowledge');
  });

  it('keeps DOM focus in the input while the virtual cursor moves', () => {
    const input = openPalette();
    press(input, 'ArrowDown');
    expect(activeElement()).toBe(input);
  });

  it('filters as the user types and resets the cursor to the best match', () => {
    const input = openPalette();

    typeInto(input, 'queue');
    expect(options()).toHaveLength(1);
    expect(activeOption()?.textContent).toContain('Go to my queue');

    // A keyword match counts: "inbox" is a synonym the agent may know it by.
    typeInto(input, 'inbox');
    expect(options()).toHaveLength(1);
    expect(options()[0]?.textContent).toContain('Go to my queue');

    typeInto(input, 'nothing matches this');
    expect(options()).toHaveLength(0);
    expect(document.querySelector('.itsm-CommandPalette__empty')?.textContent).toBe('No matching commands');
  });

  it('runs the highlighted command on Enter and closes', () => {
    const run = vi.fn();
    const input = openPalette(run);

    press(input, 'ArrowDown');
    press(input, 'Enter');

    expect(run).toHaveBeenCalledWith('my-queue');
    expect(document.querySelector('.itsm-CommandPalette')).toBeNull();
  });

  it('never runs a disabled command', () => {
    const run = vi.fn();
    openPalette(run);
    const disabled = options().find((option) => option.getAttribute('aria-disabled') === 'true');
    if (!disabled) throw new Error('no disabled option');

    click(disabled);
    expect(run).not.toHaveBeenCalled();
  });

  it('closes on Escape without running anything', () => {
    const run = vi.fn();
    const input = openPalette(run);

    press(input, 'Escape');
    expect(run).not.toHaveBeenCalled();
    expect(document.querySelector('.itsm-CommandPalette')).toBeNull();
  });

  it('announces the number of matches to screen readers', async () => {
    const input = openPalette();
    typeInto(input, 'ticket');
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(document.querySelector('[data-itsm-live-region="polite"]')?.textContent).toBe('1 command available');
  });
});

describe('command ranking', () => {
  it('prefers a prefix match on the label over a keyword or description hit', () => {
    const ranked = rankCommands(commands(() => undefined), 'go');
    expect(ranked[0]?.id).toBe('my-queue');
  });

  it('returns everything for an empty query', () => {
    expect(rankCommands(commands(() => undefined), '   ')).toHaveLength(4);
  });

  it('matches descriptions last', () => {
    const ranked = rankCommands(commands(() => undefined), 'article');
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.id).toBe('kb');
  });
});
