// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { activeElement, cleanupDocument, click, focus, pointerDown, press, render, settle } from './support/render.js';
import { DialogHarness } from './support/fixtures.js';
import { getFocusableElements } from '../../a11y/focus-trap.js';

// The close button is an `IconButton`, whose tooltip is fetched the first time
// it takes keyboard focus after a Tab. Nothing here is about the tooltip: it
// is stubbed, and the Tab tests let the (stubbed) fetch settle inside `act`.
vi.mock('../IconButtonTooltip.js', () => ({ IconButtonTooltip: () => null }));

afterEach(() => cleanupDocument());

function openDialog(onCloseReason?: (reason: string) => void, dismissible = true) {
  const rendered = render(createElement(DialogHarness, { onCloseReason, dismissible }));
  const opener = document.querySelector<HTMLButtonElement>('#opener');
  if (!opener) throw new Error('harness did not render');
  focus(opener);
  click(opener);
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
  if (!dialog) throw new Error('dialog did not open');
  return { rendered, opener, dialog };
}

describe('Dialog focus management', () => {
  it('announces itself as a modal with a name and a description', () => {
    const { dialog } = openDialog();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const titleId = dialog.getAttribute('aria-labelledby');
    const descriptionId = dialog.getAttribute('aria-describedby');
    expect(document.getElementById(titleId ?? '')?.textContent).toBe('Resolve ticket');
    expect(document.getElementById(descriptionId ?? '')?.textContent).toBe('Tell the requester what changed.');
  });

  it('moves focus into the dialog when it opens', () => {
    const { dialog } = openDialog();
    const focused = activeElement();
    expect(focused).not.toBeNull();
    expect(dialog.contains(focused)).toBe(true);
    // The first focusable element is the close button, so that is where focus lands.
    expect(focused?.getAttribute('aria-label')).toBe('Close dialog');
  });

  it('cycles Tab from the last focusable element back to the first', async () => {
    const { dialog } = openDialog();
    const focusable = getFocusableElements(dialog);
    expect(focusable.length).toBeGreaterThanOrEqual(3);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) throw new Error('no focusable elements');

    focus(last);
    press(last, 'Tab');
    expect(activeElement()).toBe(first);
    await settle();
  });

  it('cycles Shift+Tab from the first focusable element back to the last', async () => {
    const { dialog } = openDialog();
    const focusable = getFocusableElements(dialog);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) throw new Error('no focusable elements');

    focus(first);
    press(first, 'Tab', { shiftKey: true });
    expect(activeElement()).toBe(last);
    await settle();
  });

  it('pulls focus back when something outside the dialog takes it', () => {
    const { dialog } = openDialog();
    const outside = document.querySelector<HTMLButtonElement>('#outside');
    if (!outside) throw new Error('no outside button');

    focus(outside);
    expect(dialog.contains(activeElement())).toBe(true);
  });

  it('closes on Escape and returns focus to whatever opened it', () => {
    const onCloseReason = vi.fn();
    const { opener } = openDialog(onCloseReason);

    press(activeElement() ?? document, 'Escape');
    expect(onCloseReason).toHaveBeenCalledWith('escape');
    // Synchronously: no exit animation keeps a closed dialog in the page, and
    // focus is back on the opener in the same frame.
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(activeElement()).toBe(opener);
  });

  it('closes with the close button and says so', () => {
    const onCloseReason = vi.fn();
    const { opener } = openDialog(onCloseReason);

    const close = document.querySelector<HTMLButtonElement>('[aria-label="Close dialog"]');
    if (!close) throw new Error('no close button');
    click(close);
    expect(onCloseReason).toHaveBeenCalledWith('close-button');
    expect(activeElement()).toBe(opener);
  });

  it('closes when the scrim is pressed, but not when the dialog itself is', () => {
    const onCloseReason = vi.fn();
    const { dialog } = openDialog(onCloseReason);

    // pointerdown, not click: a drag that starts inside the dialog and ends
    // on the scrim must not be read as "dismiss".
    pointerDown(dialog);
    expect(onCloseReason).not.toHaveBeenCalled();

    const scrim = document.querySelector<HTMLElement>('.itsm-Dialog__scrim');
    if (!scrim) throw new Error('no scrim');
    pointerDown(scrim);
    expect(onCloseReason).toHaveBeenCalledWith('scrim');
  });

  it('ignores Escape and the scrim when the dialog is not dismissible', () => {
    const onCloseReason = vi.fn();
    openDialog(onCloseReason, false);

    press(activeElement() ?? document, 'Escape');
    const scrim = document.querySelector<HTMLElement>('.itsm-Dialog__scrim');
    if (scrim) pointerDown(scrim);
    expect(onCloseReason).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="Close dialog"]')).toBeNull();
  });

  it('locks background scrolling while open and restores it on close', () => {
    const onCloseReason = vi.fn();
    openDialog(onCloseReason);
    expect(document.body.hasAttribute('data-scroll-locked')).toBe(true);

    press(activeElement() ?? document, 'Escape');
    expect(document.body.hasAttribute('data-scroll-locked')).toBe(false);
  });

  it('hides the page behind it and makes it inert while open, as a native modal would', () => {
    const { rendered, opener } = openDialog();
    expect(rendered.container.getAttribute('aria-hidden')).toBe('true');
    expect(rendered.container.hasAttribute('inert')).toBe(true);

    // Usable again before focus goes back: a browser will not focus an inert
    // opener (jsdom would, so the order is checked at the moment of focus).
    let inertWhenFocused: boolean | null = null;
    opener.addEventListener('focus', () => {
      inertWhenFocused = rendered.container.hasAttribute('inert');
    });
    press(activeElement() ?? document, 'Escape');
    expect(rendered.container.hasAttribute('aria-hidden')).toBe(false);
    expect(rendered.container.hasAttribute('inert')).toBe(false);
    expect(activeElement()).toBe(opener);
    expect(inertWhenFocused).toBe(false);
  });
});
