// @vitest-environment jsdom
import { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanupDocument, render } from '../../web/__tests__/support/render.js';
import { TimeCell } from '../cells/TimeCell.js';

/**
 * A `date`/`datetime` cell's tooltip is the long form, which Node's and a
 * browser's `Intl` spell differently ("Wednesday, 30 September" against
 * "Wednesday 30 September"). The cell must hydrate cleanly whatever the
 * server wrote, and still carry the reader's spelling afterwards.
 */

afterEach(() => {
  cleanupDocument();
  vi.restoreAllMocks();
});

describe('TimeCell', () => {
  it('leaves the tooltip out of the server HTML', () => {
    const html = renderToString(<TimeCell iso="2026-09-30T13:30:00Z" text="30 Sept 2026, 14:30" full="Wednesday, 30 September 2026 at 14:30" />);
    expect(html).toContain('dateTime="2026-09-30T13:30:00Z"');
    expect(html).not.toContain('title=');
  });

  it('hydrates without a mismatch when the server spelled the long form differently, then adds the reader’s', async () => {
    const server = <TimeCell iso="2026-09-30T13:30:00Z" text="30 Sept 2026, 14:30" full="Wednesday, 30 September 2026 at 14:30" />;
    const client = <TimeCell iso="2026-09-30T13:30:00Z" text="30 Sept 2026, 14:30" full="Wednesday 30 September 2026 at 14:30" />;
    const container = document.createElement('div');
    container.innerHTML = renderToString(server);
    document.body.appendChild(container);
    const errors: unknown[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args));
    let root: ReturnType<typeof hydrateRoot> | null = null;
    await act(async () => {
      root = hydrateRoot(container, client, { onRecoverableError: (error) => errors.push(error) });
    });
    expect(errors).toEqual([]);
    expect(container.querySelector('time')!.title).toBe('Wednesday 30 September 2026 at 14:30');
    act(() => root!.unmount());
  });

  it('has the tooltip from the first render on the client', () => {
    const { container } = render(<TimeCell iso="2026-09-30T13:30:00Z" text="30 Sept 2026" full="Wednesday 30 September 2026 at 14:30" />);
    const time = container.querySelector('time')!;
    expect(time.textContent).toBe('30 Sept 2026');
    expect(time.title).toBe('Wednesday 30 September 2026 at 14:30');
  });
});
