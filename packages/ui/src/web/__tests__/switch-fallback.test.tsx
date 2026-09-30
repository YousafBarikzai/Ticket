// @vitest-environment jsdom
import { act, useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Switch } from '../Switch.js';
import { cleanupDocument, click, render } from './support/render.js';

/*
 * When the confirmation dialog's code cannot be fetched (offline, or a deploy
 * replaced the chunk), a switch that must ask still asks — with the browser's
 * own confirm — instead of crashing the page or changing unasked.
 */

vi.mock('../../overlays/ConfirmDialog.js', () => {
  throw new Error('Failed to fetch dynamically imported module');
});

afterEach(() => {
  cleanupDocument();
  vi.restoreAllMocks();
});

async function flush(): Promise<void> {
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 32));
  });
}

function Harness({ spy }: { readonly spy: (next: boolean) => void }): ReactNode {
  const [checked, setChecked] = useState(true);
  return (
    <Switch
      label="AI triage"
      checked={checked}
      confirm={{ title: 'Turn off AI for everyone?', body: 'Agents stop seeing suggestions.', confirmLabel: 'Turn off AI' }}
      onChange={(next) => {
        spy(next);
        setChecked(next);
      }}
    />
  );
}

describe('Switch without its dialog', () => {
  it('asks with the browser’s confirm and applies the change when accepted', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    click(document.querySelector('button[role="switch"]')!);
    await flush();
    expect(confirm).toHaveBeenCalledWith('Turn off AI for everyone?\n\nAgents stop seeing suggestions.');
    expect(spy).toHaveBeenCalledWith(false);
    expect(document.querySelector('button[role="switch"]')?.getAttribute('aria-checked')).toBe('false');
  });

  it('changes nothing when the question is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    click(document.querySelector('button[role="switch"]')!);
    await flush();
    expect(spy).not.toHaveBeenCalled();
    expect(document.querySelector('button[role="switch"]')?.getAttribute('aria-checked')).toBe('true');
  });
});
