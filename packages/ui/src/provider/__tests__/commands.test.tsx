// @vitest-environment jsdom
import { useState, type ReactElement } from 'react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanupDocument, render } from '../../web/__tests__/support/render.js';
import { useRegisterCommands, useRegisteredCommands, type CommandItem } from '../commands.js';

/*
 * Page commands (SPEC §4.1, §5.5): registered while a component is mounted,
 * most recent first, re-registered when their dependencies change, gone when
 * it unmounts — the palette's "Suggested".
 */

function Page({ items, deps = [] }: { items: CommandItem[]; deps?: unknown[] }): null {
  useRegisterCommands(items, deps);
  return null;
}

function Palette(): ReactElement {
  return <output>{useRegisteredCommands().map((item) => item.label).join(',')}</output>;
}

afterEach(() => cleanupDocument());

describe('useRegisterCommands', () => {
  it('lists the most recently mounted component’s commands first, each id once', () => {
    const { container } = render(
      <>
        <Page items={[{ id: 'new', label: 'New ticket' }, { id: 'copy', label: 'Copy link' }]} />
        <Page items={[{ id: 'resolve', label: 'Resolve…' }, { id: 'copy', label: 'Copy ticket link' }]} />
        <Palette />
      </>,
    );
    expect(container.querySelector('output')!.textContent).toBe('Resolve…,Copy ticket link,New ticket');
  });

  it('takes its commands away when the component unmounts', () => {
    function Toggle(): ReactElement {
      const [open, setOpen] = useState(true);
      return (
        <>
          {open ? <Page items={[{ id: 'resolve', label: 'Resolve…' }]} /> : null}
          <button type="button" onClick={() => setOpen(false)}>
            Close
          </button>
          <Palette />
        </>
      );
    }
    const { container } = render(<Toggle />);
    expect(container.querySelector('output')!.textContent).toBe('Resolve…');
    act(() => container.querySelector('button')!.click());
    expect(container.querySelector('output')!.textContent).toBe('');
  });

  it('re-registers when a dependency changes, so a command never runs on a stale ticket', () => {
    const run = vi.fn();
    const { container, rerender } = render(
      <>
        <Page items={[{ id: 'assign', label: 'Assign INC-1', run: () => run(1) }]} deps={[1]} />
        <Palette />
      </>,
    );
    rerender(
      <>
        <Page items={[{ id: 'assign', label: 'Assign INC-2', run: () => run(2) }]} deps={[2]} />
        <Palette />
      </>,
    );
    expect(container.querySelector('output')!.textContent).toBe('Assign INC-2');
  });
});
