// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { activeElement, cleanupDocument, click, focus, mouseDown, press, render } from './support/render.js';
import { DialogHarness } from './support/fixtures.js';
import { getFocusableElements } from '../../a11y/focus-trap.js';

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

  it('cycles Tab from the last focusable element back to the first', () => {
    const { dialog } = openDialog();
    const focusable = getFocusableElements(dialog);
    expect(focusable.length).toBeGreaterThanOrEqual(3);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) throw new Error('no focusable elements');

    focus(last);
    press(last, 'Tab');
    expect(activeElement()).toBe(first);
  });

  it('cycles Shift+Tab from the first focusable element back to the last', () => {
    const { dialog } = openDialog();
    const focusable = getFocusableElements(dialog);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) throw new Error('no focusable elements');

    focus(first);
    press(first, 'Tab', { shiftKey: true });
    expect(activeElement()).toBe(last);
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
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(activeElement()).toBe(opener);
  });

  it('closes when the scrim is pressed, but not when the dialog itself is', () => {
    const onCloseReason = vi.fn();
    const { dialog } = openDialog(onCloseReason);

    mouseDown(dialog);
    expect(onCloseReason).not.toHaveBeenCalled();

    const scrim = document.querySelector<HTMLElement>('.itsm-Dialog__scrim');
    if (!scrim) throw new Error('no scrim');
    mouseDown(scrim);
    expect(onCloseReason).toHaveBeenCalledWith('scrim');
  });

  it('ignores Escape when the dialog is not dismissible', () => {
    const onCloseReason = vi.fn();
    openDialog(onCloseReason, false);

    press(activeElement() ?? document, 'Escape');
    expect(onCloseReason).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('locks background scrolling while open and restores it on close', () => {
    const onCloseReason = vi.fn();
    openDialog(onCloseReason);
    expect(document.body.style.overflow).toBe('hidden');

    press(activeElement() ?? document, 'Escape');
    expect(document.body.style.overflow).not.toBe('hidden');
  });
});
