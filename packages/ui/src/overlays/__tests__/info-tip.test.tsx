// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { unknownVariables } from '../../styles/css.js';
import { expectNoViolations } from '../../web/__tests__/support/audit.js';
import { activeElement, cleanupDocument, click, focus, pointerDown, press, render, settle } from '../../web/__tests__/support/render.js';
import { InfoTipTrigger } from '../../web/InfoTipTrigger.js';
import { infoTipStyles } from '../InfoTip.styles.js';

/*
 * `InfoTip` and its lazy trigger (v3 §2.14): a toggletip. The behaviour that
 * matters is the one a keyboard and a screen reader meet — Enter opens it, it
 * is a dialog with a name and a description, Escape closes it and puts focus
 * back on the ⓘ — and the cost: the root entry's trigger must not carry the
 * popover library, so it loads on intent and remembers a press made while it
 * was loading.
 */

/*
 * The popover module is held back until a test lets it through, so the first
 * tests can press the button while it is still on its way — the moment a
 * real person on a slow connection meets.
 */
const gate = vi.hoisted(() => {
  let release: () => void = () => undefined;
  const arrived = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { arrived, release: () => release() };
});

vi.mock('../InfoTip.js', async (importOriginal) => {
  await gate.arrived;
  return importOriginal();
});

afterEach(() => cleanupDocument());

const content = {
  label: 'About Backlog',
  title: 'Backlog',
  body: 'Open tickets in your teams that nobody has resolved yet.',
  source: 'Open tickets, now',
};

const button = (): HTMLButtonElement => document.querySelector<HTMLButtonElement>('.itsm-InfoTip__trigger')!;
const bubble = (): HTMLElement | null => document.querySelector<HTMLElement>('.itsm-InfoTip');

/** Lets the dynamic import land and Radix mount (or unmount) its content. */
async function arrive(): Promise<void> {
  for (let i = 0; i < 5; i++) await settle();
}

/** Waits for the first fetch of the popover module, which compiles Radix on its way: real time, not ticks. */
async function until(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for the popover module');
    await settle(10);
  }
}

/**
 * Enter on a button, the way a browser handles it: the key goes to the page
 * first, and unless something prevented it the button is then clicked. jsdom
 * dispatches the key and stops there.
 */
function enter(target: HTMLElement): void {
  let prevented = false;
  act(() => {
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    prevented = event.defaultPrevented;
  });
  if (!prevented) click(target);
}

describe('InfoTipTrigger before anybody reaches for it', () => {
  it('renders on the server as a plain, named button that says it opens a dialog', () => {
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(<InfoTipTrigger {...content} />);
    const plain = host.querySelector('button')!;
    expect(plain.getAttribute('type')).toBe('button');
    expect(plain.getAttribute('aria-label')).toBe('About Backlog');
    expect(plain.getAttribute('aria-haspopup')).toBe('dialog');
    expect(plain.getAttribute('aria-expanded')).toBe('false');
    expect(plain.classList.contains('itsm-InfoTip__trigger')).toBe(true);
    // The explanation is not in the page until it is asked for.
    expect(host.textContent).not.toContain('nobody has resolved');
    expect(plain.querySelector('svg')?.getAttribute('data-icon')).toBe('info');
    expect(plain.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('passes a class to the button', () => {
    render(<InfoTipTrigger {...content} className="app-Kpi__info" />);
    expect(button().classList.contains('app-Kpi__info')).toBe(true);
  });
});

describe('InfoTipTrigger while its popover is on its way', () => {
  it('remembers Enter pressed before the module arrived, and opens when it lands', async () => {
    render(<InfoTipTrigger {...content} />);
    const plain = button();
    focus(plain);
    enter(plain);
    await settle();
    expect(bubble()).toBeNull();
    expect(plain.getAttribute('aria-expanded')).toBe('false');

    gate.release();
    await until(() => bubble() !== null);
    await arrive();
    expect(button().getAttribute('aria-expanded')).toBe('true');

    press(activeElement() ?? document.body, 'Escape');
    await arrive();
    expect(bubble()).toBeNull();
    expect(activeElement()).toBe(button());
  });
});

describe('InfoTipTrigger as a toggletip', () => {
  it('opens on a click as a dialog named by its title and described by its body', async () => {
    render(<InfoTipTrigger {...content} />);
    click(button());
    await arrive();
    const dialog = bubble()!;
    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(document.getElementById(dialog.getAttribute('aria-labelledby') ?? '')?.textContent).toBe('Backlog');
    expect(document.getElementById(dialog.getAttribute('aria-describedby') ?? '')?.textContent).toBe(content.body);
    expect(dialog.querySelector('.itsm-InfoTip__source')?.textContent).toBe('Open tickets, now');
    expect(button().getAttribute('aria-expanded')).toBe('true');
    expect(button().getAttribute('aria-label')).toBe('About Backlog');
  });

  it('opens on Enter, and Escape closes it and gives focus back to the button', async () => {
    render(<InfoTipTrigger {...content} />);
    await arrive();
    focus(button());
    enter(button());
    await arrive();
    expect(bubble()).not.toBeNull();

    press(activeElement() ?? document.body, 'Escape');
    await arrive();
    expect(bubble()).toBeNull();
    expect(activeElement()).toBe(button());
    expect(button().getAttribute('aria-expanded')).toBe('false');
  });

  it('draws the popover’s own trigger at once when another ⓘ already fetched it, with focus kept', async () => {
    render(<InfoTipTrigger {...content} />);
    await arrive();
    // Radix's trigger carries its state; the plain button drawn before the module arrives does not.
    expect(button().dataset.state).toBe('closed');
    focus(button());
    await arrive();
    expect(activeElement()).toBe(button());
    expect(bubble()).toBeNull();
  });

  it('closes on a second click, as a toggle', async () => {
    render(<InfoTipTrigger {...content} />);
    click(button());
    await arrive();
    expect(bubble()).not.toBeNull();
    click(button());
    await arrive();
    expect(bubble()).toBeNull();
  });

  it('closes on a press elsewhere', async () => {
    render(
      <div>
        <button type="button" id="elsewhere">
          Elsewhere
        </button>
        <InfoTipTrigger {...content} />
      </div>,
    );
    click(button());
    await arrive();
    expect(bubble()).not.toBeNull();
    const outside = document.getElementById('elsewhere')!;
    pointerDown(outside);
    click(outside);
    await arrive();
    expect(bubble()).toBeNull();
  });

  it('is named by its button when it has no title, and leaves out the source when it has none', async () => {
    render(<InfoTipTrigger label="About Due today" body="Open tickets whose deadline is before midnight." />);
    click(button());
    await arrive();
    const dialog = bubble()!;
    expect(document.getElementById(dialog.getAttribute('aria-labelledby') ?? '')?.getAttribute('aria-label')).toBe('About Due today');
    expect(dialog.querySelector('.itsm-InfoTip__title')).toBeNull();
    expect(dialog.querySelector('.itsm-InfoTip__source')).toBeNull();
  });
});

describe('InfoTip, the eager form', () => {
  it('draws its own ⓘ and opens from it', async () => {
    const { InfoTip } = await import('../InfoTip.js');
    render(<InfoTip {...content} side="bottom" />);
    expect(button().getAttribute('aria-label')).toBe('About Backlog');
    expect(button().getAttribute('aria-haspopup')).toBe('dialog');
    click(button());
    await arrive();
    expect(bubble()?.getAttribute('data-side')).toBe('bottom');
    expect(bubble()?.textContent).toContain('Backlog');
  });
});

describe('what the root entry carries', () => {
  const source = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

  /** Every module reachable from `entry` by static, non-type imports. */
  function staticGraph(entry: string): Map<string, string[]> {
    const graph = new Map<string, string[]>();
    const queue = [join(source, entry)];
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (graph.has(file)) continue;
      const specifiers = [...readFileSync(file, 'utf8').matchAll(/^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm)].map((match) => match[1]!);
      graph.set(file, specifiers);
      for (const specifier of specifiers) {
        if (!specifier.startsWith('.')) continue;
        const base = resolve(dirname(file), specifier.replace(/\.js$/, ''));
        const next = [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')].find((candidate) => existsSync(candidate));
        if (next) queue.push(next);
      }
    }
    return graph;
  }

  it('reaches no Radix, TanStack or sonner module from the trigger statically', () => {
    const graph = staticGraph('web/InfoTipTrigger.tsx');
    const offenders = [...graph].flatMap(([file, specifiers]) =>
      specifiers.filter((specifier) => /^(?:@radix-ui\/|@tanstack\/|sonner$)/.test(specifier)).map((specifier) => `${file.slice(source.length)} → ${specifier}`),
    );
    expect(offenders).toEqual([]);
    expect([...graph.keys()].some((file) => file.endsWith('overlays/InfoTip.tsx'))).toBe(false);
  });

  it('loads the popover by dynamic import', () => {
    expect(readFileSync(join(source, 'web/InfoTipTrigger.tsx'), 'utf8')).toContain("import('../overlays/InfoTip.js')");
  });
});

describe('InfoTip styles', () => {
  it('reference only variables the tokens emit', () => {
    expect(unknownVariables(infoTipStyles)).toEqual([]);
  });

  it('draw the bubble on the inverse surface, at most 300 px wide', () => {
    expect(infoTipStyles).toMatch(/\.itsm-InfoTip \{[^}]*background: var\(--itsm-colour-surface-inverse\);[^}]*color: var\(--itsm-colour-text-inverse\);/);
    expect(infoTipStyles).toContain('max-inline-size: min(18.75rem,');
  });

  it('make the button 24 px with a muted glyph, and give it a larger target on touch screens', () => {
    expect(infoTipStyles).toMatch(/\.itsm-InfoTip__trigger \{[^}]*inline-size: var\(--itsm-space-lg\);[^}]*block-size: var\(--itsm-space-lg\);[^}]*color: var\(--itsm-colour-text-muted\);/);
    expect(infoTipStyles).toMatch(/@media \(pointer: coarse\) \{\s*\.itsm-InfoTip__trigger::after/);
  });
});

describe('InfoTip audit', () => {
  it('passes axe closed and open', async () => {
    render(
      <p>
        Backlog <InfoTipTrigger {...content} /> <InfoTipTrigger label="About Due today" body="Open tickets due before midnight." />
      </p>,
    );
    await expectNoViolations(document.body);
    click(button());
    await arrive();
    expect(bubble()).not.toBeNull();
    await expectNoViolations(document.body);
  });
});
