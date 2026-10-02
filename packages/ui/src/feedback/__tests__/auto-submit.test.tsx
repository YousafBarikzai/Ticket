// @vitest-environment jsdom
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, StrictMode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupDocument, render } from '../../web/__tests__/support/render.js';
import { AutoSubmitForm } from '../AutoSubmitForm.js';

/*
 * `AutoSubmitForm` (v3 §2.15, A3 §6.2): the `/demo` entry form submits itself
 * once, only when the page can be seen, and never from a speculative
 * prerender — a prerender that minted would sign a person in to a demo they
 * only hovered a link to.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let visibility: DocumentVisibilityState = 'visible';
let prerendering = false;

beforeEach(() => {
  visibility = 'visible';
  prerendering = false;
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  Object.defineProperty(document, 'prerendering', { configurable: true, get: () => prerendering });
});

afterEach(() => {
  cleanupDocument();
  vi.restoreAllMocks();
  delete (document as { prerendering?: boolean }).prerendering;
});

/** The `/demo` entry form with the island after it, as the page renders them, and a spy on its submission. */
function page(id = 'itsm-demo-entry', strict = false) {
  const requestSubmit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => undefined);
  const tree = (
    <>
      <form id={id} method="post" action="/api/session/demo">
        <input type="hidden" name="persona" value="agent" />
        <button type="submit">Open the demo</button>
      </form>
      <AutoSubmitForm formId={id} />
    </>
  );
  const view = render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  return { ...view, requestSubmit, form: document.getElementById(id) as HTMLFormElement };
}

function becomeVisible(): void {
  visibility = 'visible';
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

describe('AutoSubmitForm', () => {
  it('submits the form once, as if its button were pressed, when the page is visible', () => {
    const { requestSubmit, form } = page();
    expect(requestSubmit).toHaveBeenCalledTimes(1);
    expect(requestSubmit.mock.contexts[0]).toBe(form);
  });

  it('submits once even when React runs the effect twice, and never again on a re-render or a later event', () => {
    const { requestSubmit, rerender } = page('itsm-demo-strict', true);
    expect(requestSubmit).toHaveBeenCalledTimes(1);
    rerender(
      <StrictMode>
        <form id="itsm-demo-strict" />
        <AutoSubmitForm formId="itsm-demo-strict" />
      </StrictMode>,
    );
    becomeVisible();
    act(() => {
      document.dispatchEvent(new Event('prerenderingchange'));
    });
    expect(requestSubmit).toHaveBeenCalledTimes(1);
  });

  it('waits while the tab is hidden, and submits when it is first seen', () => {
    visibility = 'hidden';
    const { requestSubmit } = page('itsm-demo-hidden');
    expect(requestSubmit).not.toHaveBeenCalled();
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(requestSubmit).not.toHaveBeenCalled();
    becomeVisible();
    expect(requestSubmit).toHaveBeenCalledTimes(1);
    visibility = 'hidden';
    becomeVisible();
    expect(requestSubmit).toHaveBeenCalledTimes(1);
  });

  it('never submits from a prerender, and submits once the page is actually shown', () => {
    prerendering = true;
    const { requestSubmit } = page('itsm-demo-prerender');
    expect(requestSubmit).not.toHaveBeenCalled();
    // A visibility change during the prerender is not the page being shown.
    becomeVisible();
    expect(requestSubmit).not.toHaveBeenCalled();
    prerendering = false;
    act(() => {
      document.dispatchEvent(new Event('prerenderingchange'));
    });
    expect(requestSubmit).toHaveBeenCalledTimes(1);
  });

  it('stands down when the person pressed the button first', () => {
    visibility = 'hidden';
    const { requestSubmit, form } = page('itsm-demo-pressed');
    // A press while the island waits: the browser's own submit event, then the tab is looked at.
    act(() => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    becomeVisible();
    expect(requestSubmit).not.toHaveBeenCalled();
  });

  it('falls back to submit() where requestSubmit() is missing', () => {
    const original = HTMLFormElement.prototype.requestSubmit;
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => undefined);
    // An older engine: the method is simply not there.
    (HTMLFormElement.prototype as { requestSubmit?: unknown }).requestSubmit = undefined;
    try {
      render(
        <>
          <form id="itsm-demo-old" />
          <AutoSubmitForm formId="itsm-demo-old" />
        </>,
      );
      expect(submit).toHaveBeenCalledTimes(1);
    } finally {
      HTMLFormElement.prototype.requestSubmit = original;
    }
  });

  it('does nothing, and does not throw, when the form is not on the page', () => {
    const requestSubmit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => undefined);
    expect(() => render(<AutoSubmitForm formId="nowhere" />)).not.toThrow();
    expect(requestSubmit).not.toHaveBeenCalled();
  });

  it('renders nothing and announces nothing', () => {
    expect(renderToStaticMarkup(<AutoSubmitForm formId="itsm-demo-entry" />)).toBe('');
    const { container } = page('itsm-demo-silent');
    expect(container.querySelector('[role="status"], [role="alert"], [aria-live]')).toBeNull();
  });

  it('is a client module, reached only from the root entry and never through a barrel a layout imports', () => {
    const source = readFileSync(join(SRC, 'feedback/AutoSubmitForm.tsx'), 'utf8');
    expect(source.trimStart().startsWith("'use client'")).toBe(true);
    const barrels: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__') walk(path);
        } else if (entry.name === 'index.ts' || entry.name === 'index.tsx') barrels.push(relative(SRC, path).split(sep).join('/'));
      }
    };
    walk(SRC);
    const reexporting = barrels.filter((file) => /AutoSubmitForm/.test(readFileSync(join(SRC, file), 'utf8')));
    expect(reexporting.filter((file) => file !== 'index.ts')).toEqual([]);
  });
});
