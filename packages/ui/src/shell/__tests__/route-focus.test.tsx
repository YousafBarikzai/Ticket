// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { activeElement, cleanupDocument, focus, render } from '../../web/__tests__/support/render.js';
import { RouteFocus } from '../RouteFocus.js';
import { createLocation } from './support.js';

afterEach(() => cleanupDocument());

/** Runs pending animation frames (jsdom schedules them on a timer). */
async function frame(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  });
}

function Page({ title, location }: { readonly title: string | null; readonly location: ReturnType<typeof createLocation> }): ReactNode {
  return (
    <location.Provider>
      <RouteFocus />
      <nav>
        <a href="/rules" id="nav-link">
          Rules
        </a>
        <input aria-label="Filter" id="filter" />
      </nav>
      <main>{title ? <h1 tabIndex={-1}>{title}</h1> : <p>Loading…</p>}</main>
    </location.Provider>
  );
}

describe('RouteFocus (X-60)', () => {
  it('moves focus to the new page’s h1 when the pathname changes', async () => {
    const location = createLocation('/rules');
    const view = render(<Page title="Rules" location={location} />);
    focus(document.getElementById('nav-link')!);

    act(() => location.go('/workflows'));
    view.rerender(<Page title="Workflows" location={location} />);
    await frame();

    expect(activeElement()?.tagName).toBe('H1');
    expect(activeElement()?.textContent).toBe('Workflows');
  });

  it('never moves focus when only the query changes', async () => {
    const location = createLocation('/rules');
    render(<Page title="Rules" location={location} />);
    const filter = document.getElementById('filter') as HTMLInputElement;
    focus(filter);

    act(() => location.go('/rules?status=draft'));
    await frame();
    act(() => location.go('/rules?status=draft&q=vip'));
    await frame();

    expect(activeElement()).toBe(filter);
  });

  it('does nothing on the first render: the page load is the browser’s', async () => {
    const location = createLocation('/rules');
    render(<Page title="Rules" location={location} />);
    await frame();
    expect(activeElement()).toBe(document.body);
  });

  it('waits for a heading that is still streaming in', async () => {
    const location = createLocation('/rules');
    const view = render(<Page title="Rules" location={location} />);
    focus(document.getElementById('nav-link')!);

    act(() => location.go('/workflows'));
    view.rerender(<Page title={null} location={location} />);
    await frame();
    expect(activeElement()?.id).toBe('nav-link');

    view.rerender(<Page title="Workflows" location={location} />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(activeElement()?.textContent).toBe('Workflows');
  });

  it('leaves focus alone when the person has moved it, or a dialog is open', async () => {
    const location = createLocation('/rules');
    const view = render(<Page title="Rules" location={location} />);
    focus(document.getElementById('nav-link')!);

    act(() => location.go('/workflows'));
    view.rerender(<Page title={null} location={location} />);
    await frame();
    // The person tabs on before the heading arrives.
    focus(document.getElementById('filter')!);
    view.rerender(<Page title="Workflows" location={location} />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(activeElement()?.id).toBe('filter');

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    document.body.appendChild(dialog);
    focus(document.getElementById('nav-link')!);
    act(() => location.go('/tickets'));
    view.rerender(<Page title="Tickets" location={location} />);
    await frame();
    expect(activeElement()?.id).toBe('nav-link');
  });
});
