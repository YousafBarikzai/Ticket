// @vitest-environment jsdom
import { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { kbdStyles } from '../Kbd.styles.js';
import { Kbd } from '../Kbd.js';
import { cleanupDocument } from './support/render.js';

/*
 * `Kbd` (SPEC §4.1): both glyph sets where the platforms differ, one shown by
 * `[data-itsm-os]`; a spoken sentence in place of the caps; server-safe, so the
 * server's HTML is exactly what the browser renders.
 */

function parse(html: string): HTMLElement {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  return holder;
}

const caps = (set: Element): string[] => [...set.querySelectorAll('.itsm-Kbd__key')].map((key) => key.textContent ?? '');
const spoken = (set: Element): string => set.querySelector('.itsm-visually-hidden')?.textContent ?? '';

afterEach(() => cleanupDocument());

describe('Kbd', () => {
  it('renders ⌘ and Ctrl sets for mod, each with its own spoken name', () => {
    const root = parse(renderToStaticMarkup(<Kbd keys="mod+k" />));
    const apple = root.querySelector('[data-platform="apple"]')!;
    const other = root.querySelector('[data-platform="other"]')!;
    expect(caps(apple)).toEqual(['⌘', 'K']);
    expect(spoken(apple)).toBe('Command K');
    expect(caps(other)).toEqual(['Ctrl', 'K']);
    expect(spoken(other)).toBe('Control K');
  });

  it('hides the caps from assistive technology and lets the sentence speak for them', () => {
    const root = parse(renderToStaticMarkup(<Kbd keys="mod+k" />));
    for (const keys of root.querySelectorAll('.itsm-Kbd__keys')) expect(keys.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders one set where every platform reads the same', () => {
    const question = parse(renderToStaticMarkup(<Kbd keys="?" />));
    expect(question.querySelectorAll('.itsm-Kbd__set')).toHaveLength(1);
    expect(question.querySelector('.itsm-Kbd__set')!.hasAttribute('data-platform')).toBe(false);
    expect(spoken(question)).toBe('Question mark');
  });

  it('writes a chord as one key then the next', () => {
    const root = parse(renderToStaticMarkup(<Kbd keys="g m" />));
    expect(caps(root)).toEqual(['G', 'M']);
    expect(root.querySelector('.itsm-Kbd__then')!.textContent).toBe('then');
    expect(spoken(root)).toBe('G, then M');
  });

  it('shows a shortcut it cannot read as written rather than dropping it', () => {
    const root = parse(renderToStaticMarkup(<Kbd keys="Ctrl-Alt-Moon" />));
    expect(root.querySelector('kbd')!.textContent).toBe('Ctrl-Alt-Moon');
  });

  it('takes a size, a class and aria-hidden for a control that announces its own shortcut', () => {
    const kbd = parse(renderToStaticMarkup(<Kbd keys="/" size="sm" className="app-Hint" aria-hidden />)).querySelector('kbd')!;
    expect(kbd.getAttribute('class')).toBe('itsm-Kbd app-Hint');
    expect(kbd.getAttribute('data-size')).toBe('sm');
    expect(kbd.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows the non-Apple set unless the pre-paint script says the device is Apple', () => {
    expect(kbdStyles).toContain('.itsm-Kbd__set[data-platform="apple"] {\n  display: none;');
    expect(kbdStyles).toContain(':root[data-itsm-os="apple"] .itsm-Kbd__set[data-platform="apple"]');
    expect(kbdStyles).toContain(':root[data-itsm-os="apple"] .itsm-Kbd__set[data-platform="other"]');
  });

  it('draws v3 caps: a raised key in text.muted with a 1 px edge and a 2 px lip, 600 11/16', () => {
    const rule = (selector: string): string => {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return kbdStyles.match(new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`))?.[1] ?? '';
    };
    const kbd = rule('.itsm-Kbd');
    expect(kbd).toContain('font-size: var(--itsm-text-caption-size);');
    expect(kbd).toContain('line-height: var(--itsm-text-caption-line);');
    expect(kbd).toContain('font-weight: var(--itsm-font-weight-semibold);');
    expect(kbd).toContain('color: var(--itsm-colour-text-muted);');
    const key = rule('.itsm-Kbd__key');
    expect(key).toContain('--_itsm-kbd-face: var(--itsm-colour-surface-raised);');
    expect(key).toContain('--_itsm-kbd-edge: var(--itsm-colour-border-subtle);');
    expect(key).toContain('--_itsm-kbd-lip: var(--itsm-colour-border-soft);');
    expect(key).toContain('border: var(--itsm-border-hair) solid var(--_itsm-kbd-edge);');
    expect(key).toContain('border-block-end: var(--itsm-border-thick) solid var(--_itsm-kbd-lip);');
    expect(key).toContain('border-radius: var(--itsm-radius-xs);');
    expect(key).toContain('background: var(--_itsm-kbd-face);');
  });

  it('draws the caps from the text around them on a dark bubble and on navy, never as light keys', () => {
    const context = ':where(.itsm-Tooltip__content, .itsm-Bubble, .itsm-Sidebar__tip, [data-surface="hero"])';
    expect(kbdStyles).toContain(`${context} .itsm-Kbd {\n  color: inherit;`);
    const keys = kbdStyles.slice(kbdStyles.indexOf(`${context} .itsm-Kbd__key {`));
    expect(keys).toMatch(/--_itsm-kbd-face: color-mix\(in srgb, currentColor 10%, transparent\);/);
    // The tooltip renders its shortcut inside its bubble, which the context names.
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(
      <span className="itsm-Tooltip__content">
        Copy <Kbd keys="mod+shift+c" size="sm" aria-hidden />
      </span>,
    );
    expect(host.querySelector('.itsm-Tooltip__content .itsm-Kbd')).not.toBeNull();
  });

  it('hydrates what the server rendered without a mismatch', async () => {
    const element = (
      <p>
        Press <Kbd keys="mod+shift+enter" /> to send
      </p>
    );
    const container = document.createElement('div');
    container.innerHTML = renderToString(element);
    document.body.appendChild(container);
    const errors: unknown[] = [];
    const consoleError = vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args));
    let root: ReturnType<typeof hydrateRoot> | null = null;
    await act(async () => {
      root = hydrateRoot(container, element, { onRecoverableError: (error) => errors.push(error) });
    });
    consoleError.mockRestore();
    expect(errors).toEqual([]);
    act(() => root!.unmount());
  });
});
