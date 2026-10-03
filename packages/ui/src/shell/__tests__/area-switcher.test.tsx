// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestProvider } from '../../provider/__tests__/support/provider.js';
import { componentStylesheet } from '../../styles/index.js';
import { expectNoViolations } from '../../web/__tests__/support/audit.js';
import { activeElement, cleanupDocument, focus, pointerDown, press, render, settle } from '../../web/__tests__/support/render.js';
import { AreaList, areaHopText, areaPersonaLine } from '../AreaList.js';
import { resetAreaHopForTesting } from '../AreaMenuPanel.js';
import { AreaSwitcher } from '../AreaSwitcher.js';
import { adminAreas, agentPortalAreas, demoAreas, requesterAreas } from './support.js';

/**
 * The area switcher (A2 §15.1): a lockup for one area, otherwise a button
 * named "Switch area. Current: …" whose menu loads on intent and lists every
 * area as a link — descriptions, persona lines in a demo, the current one
 * checked — and the plain list the navigation sheet and the Me page draw.
 */

const q = <T extends Element = HTMLElement>(selector: string): T | null => document.querySelector<T>(selector);
const all = (selector: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(selector)];

/** Links in jsdom would try to navigate; the tests only need to see the click. */
function stopNavigation(event: Event): void {
  if (event.target instanceof Element && event.target.closest('a')) event.preventDefault();
}

beforeEach(() => {
  document.addEventListener('click', stopNavigation);
});

afterEach(() => {
  document.removeEventListener('click', stopNavigation);
  cleanupDocument();
  resetAreaHopForTesting();
  document.documentElement.removeAttribute('data-itsm-theme');
  vi.useRealTimers();
});

async function loaded(): Promise<void> {
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  await settle();
}

async function openWithKeyboard(): Promise<HTMLButtonElement> {
  focus(q<HTMLButtonElement>('button.itsm-AreaSwitcher')!);
  await loaded();
  const trigger = q<HTMLButtonElement>('button.itsm-AreaSwitcher')!;
  press(trigger, 'Enter');
  await settle();
  return trigger;
}

function rowNames(): string[] {
  return all('[role="menu"] [role="menuitem"]').map((row) => row.querySelector('.itsm-Menu__itemLabel')!.firstChild!.textContent ?? '');
}

describe('AreaSwitcher', () => {
  it('is a lockup for a person with one area: the words, no button, no focus stop', () => {
    render(
      <TestProvider app="portal">
        <AreaSwitcher model={requesterAreas} display="compact" />
      </TestProvider>,
    );
    const lockup = q('.itsm-AreaSwitcher')!;
    expect(lockup.tagName).toBe('DIV');
    expect(lockup.getAttribute('data-display')).toBe('lockup');
    expect(lockup.textContent).toContain('Help Portal');
    expect(lockup.querySelector('button, a, [tabindex]')).toBeNull();
  });

  it('renders a plain button on the server: named, described, saying it has a menu, with no menu library', () => {
    const html = renderToStaticMarkup(
      <TestProvider>
        <AreaSwitcher model={adminAreas} display="card" />
      </TestProvider>,
    );
    expect(html).toContain('aria-label="Switch area. Current: Administration"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('Set up rules, SLAs, people and reports');
    expect(html).not.toContain('data-state');
  });

  it('names the trigger with the visible area name, described by its one-liner', () => {
    render(
      <TestProvider>
        <AreaSwitcher model={demoAreas('workbench')} display="card" />
      </TestProvider>,
    );
    const trigger = q('button.itsm-AreaSwitcher')!;
    expect(trigger.getAttribute('aria-label')).toBe('Switch area. Current: Service Desk');
    expect(document.getElementById(trigger.getAttribute('aria-describedby')!)?.textContent).toBe('Work tickets, queues and SLAs');
  });

  it('loads the menu on focus without dropping focus, opens it with Enter, and lists every area as a link', async () => {
    render(
      <TestProvider>
        <AreaSwitcher model={adminAreas} display="card" />
      </TestProvider>,
    );
    const trigger = await openWithKeyboard();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const menu = q('[role="menu"]')!;
    expect(menu.getAttribute('aria-label')).toBe('Switch area');
    expect(menu.textContent).toContain('IT Service Management · Acme');
    expect(rowNames()).toEqual(['Help Portal', 'Service Desk', 'Administration']);
    const rows = all('[role="menu"] [role="menuitem"]');
    for (const row of rows) expect(row.tagName).toBe('A');
    expect(rows.map((row) => row.getAttribute('href'))).toEqual(['https://help.example/resume', 'https://desk.example/resume', '/']);
    // Rows are plain same-tab links: never rel="noreferrer" (a demo hop needs the Referer, D22).
    for (const row of rows) expect(row.getAttribute('rel')).toBeNull();
    // Each row is described by its one-liner.
    expect(document.getElementById(rows[1]!.getAttribute('aria-describedby')!)?.textContent).toBe('Work tickets, queues and SLAs');
    // The current area: checked, aria-current, and said in words.
    const current = rows[2]!;
    expect(current.getAttribute('aria-current')).toBe('true');
    expect(current.querySelector('.itsm-Menu__current')).not.toBeNull();
    expect(current.textContent).toContain('(current area)');
    expect(rows[0]!.getAttribute('aria-current')).toBeNull();
  });

  it('returns focus to the trigger on Escape', async () => {
    render(
      <TestProvider>
        <AreaSwitcher model={adminAreas} display="card" />
      </TestProvider>,
    );
    const trigger = await openWithKeyboard();
    press(activeElement()!, 'Escape');
    await settle();
    expect(q('[role="menu"]')).toBeNull();
    expect(activeElement()).toBe(q('button.itsm-AreaSwitcher'));
    expect(trigger.isConnected || q('button.itsm-AreaSwitcher') !== null).toBe(true);
  });

  it('honours a press made while the menu was on its way', async () => {
    render(
      <TestProvider>
        <AreaSwitcher model={adminAreas} display="card" />
      </TestProvider>,
    );
    pointerDown(q('button.itsm-AreaSwitcher')!);
    await loaded();
    expect(q('[role="menu"]')).not.toBeNull();
  });

  it('in a demo, gives every row its persona line and ends with "IT Service Management home"', async () => {
    render(
      <TestProvider app="workbench">
        <AreaSwitcher model={demoAreas('workbench')} display="card" />
      </TestProvider>,
    );
    await openWithKeyboard();
    const rows = all('[role="menu"] [role="menuitem"]');
    expect(rows.map((row) => row.querySelector('.itsm-AreaMenu__persona')?.textContent ?? null)).toEqual([
      "You'll continue as Emma Clarke, Finance Manager",
      "You're Alex Morgan · Service Desk team lead",
      "You'll continue as Jordan Lee, IT Service Manager",
      null,
    ]);
    expect(rows[0]!.getAttribute('href')).toBe('https://help.example/demo?persona=employee&demo=1&redirectTo=%2Fresume');
    const home = rows.at(-1)!;
    expect(home.textContent).toBe('IT Service Management home');
    expect(home.getAttribute('href')).toBe('https://itsm.example/');
  });

  it('veils the page while a cross-area link loads, says so politely, and lifts it on pageshow', async () => {
    render(
      <TestProvider app="workbench">
        <AreaSwitcher model={demoAreas('workbench')} display="card" />
      </TestProvider>,
    );
    await openWithKeyboard();
    const portal = all('[role="menu"] [role="menuitem"]')[0]!;
    act(() => {
      portal.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    });
    await settle();
    expect(document.documentElement.dataset.itsmLeaving).toBe('Opening the Help Portal as Emma Clarke…');
    const live = all('[aria-live="polite"]').find((node) => node.textContent === 'Opening the Help Portal as Emma Clarke…');
    expect(live).toBeDefined();
    expect(live!.getAttribute('role')).toBeNull();

    act(() => {
      window.dispatchEvent(new Event('pageshow'));
    });
    expect(document.documentElement.dataset.itsmLeaving).toBeUndefined();
  });

  it('does not veil the page for a link opened in a new tab, nor for the current area', async () => {
    render(
      <TestProvider>
        <AreaSwitcher model={adminAreas} display="card" />
      </TestProvider>,
    );
    await openWithKeyboard();
    const [portal, , current] = all('[role="menu"] [role="menuitem"]');
    act(() => {
      portal!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ctrlKey: true }));
    });
    expect(document.documentElement.dataset.itsmLeaving).toBeUndefined();
    act(() => {
      current!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    });
    expect(document.documentElement.dataset.itsmLeaving).toBeUndefined();
  });

  it('lifts the veil after ten seconds if the next page never comes', async () => {
    render(
      <TestProvider>
        <AreaSwitcher model={adminAreas} display="card" />
      </TestProvider>,
    );
    await openWithKeyboard();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    act(() => {
      all('[role="menu"] [role="menuitem"]')[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    });
    expect(document.documentElement.dataset.itsmLeaving).toBe('Opening the Service Desk…');
    vi.advanceTimersByTime(10_000);
    expect(document.documentElement.dataset.itsmLeaving).toBeUndefined();
  });

  it('draws the veil in CSS only, as the hop card, with no text for assistive technology', () => {
    expect(componentStylesheet).toContain('html[data-itsm-leaving]::after {');
    expect(componentStylesheet).toContain("content: attr(data-itsm-leaving) / '';");
  });

  it('is the 36 px "Help Portal ⌄" in the portal, and the 32 × 44 chevron under 375 px', () => {
    render(
      <TestProvider app="portal">
        <AreaSwitcher model={agentPortalAreas} display="compact" />
      </TestProvider>,
    );
    const trigger = q('button.itsm-AreaSwitcher')!;
    expect(trigger.getAttribute('data-display')).toBe('compact');
    expect(trigger.getAttribute('aria-label')).toBe('Switch area. Current: Help Portal');
    expect(trigger.querySelector('.itsm-AreaSwitcher__name')?.textContent).toBe('Help Portal');
    expect(componentStylesheet).toMatch(/@media \(max-width: 23\.4375rem\) \{\s*button\.itsm-AreaSwitcher\[data-variant="compact"\] \{[^}]*inline-size: 2rem;[^}]*block-size: var\(--itsm-control-height-lg\);/);
  });

  it.each(['apple', 'apple-dark'])('has no violations, closed and open, in the %s theme', async (theme) => {
    document.documentElement.setAttribute('data-itsm-theme', theme);
    render(
      <TestProvider app="workbench">
        <AreaSwitcher model={demoAreas('workbench')} display="card" />
        <AreaSwitcher model={requesterAreas} display="compact" />
      </TestProvider>,
    );
    await expectNoViolations();
    await openWithKeyboard();
    await expectNoViolations();
  });
});

describe('AreaList', () => {
  it('is server-safe: no directive, renders as static markup', () => {
    const source = readFileSync(join(import.meta.dirname, '../AreaList.tsx'), 'utf8');
    expect(source.startsWith("'use client'")).toBe(false);
    const html = renderToStaticMarkup(<AreaList model={adminAreas} />);
    expect(html).toContain('<h2 id="itsm-area-list-heading" class="itsm-AreaList__heading">Switch area</h2>');
    expect(html).toContain('aria-labelledby="itsm-area-list-heading"');
  });

  it('lists the areas as plain links, the current one checked, and the demo’s persona lines and home', () => {
    render(<AreaList model={demoAreas('portal')} />);
    const rows = all('.itsm-AreaList__row');
    expect(rows.map((row) => row.getAttribute('href'))).toEqual([
      '/',
      'https://desk.example/demo?persona=agent&demo=1&redirectTo=%2Fresume',
      'https://admin.example/demo?persona=admin&demo=1&redirectTo=%2Fresume',
      'https://itsm.example/',
    ]);
    expect(rows[0]!.getAttribute('aria-current')).toBe('true');
    expect(rows[0]!.textContent).toContain('(current area)');
    expect(rows[1]!.textContent).toContain("You'll continue as Alex Morgan, Service Desk team lead");
    expect(rows.at(-1)!.textContent).toBe('IT Service Management home');
    for (const row of rows) expect(row.getAttribute('rel')).toBeNull();
  });

  it('renders nothing for a person with one area', () => {
    const { container } = render(<AreaList model={requesterAreas} />);
    expect(container.innerHTML).toBe('');
  });

  it('words a hop and a persona the way the hop card does', () => {
    const [portal, desk] = demoAreas('admin').areas;
    expect(areaHopText(portal!)).toBe('Opening the Help Portal as Emma Clarke…');
    expect(areaPersonaLine(desk!)).toBe("You'll continue as Alex Morgan, Service Desk team lead");
    expect(areaHopText(adminAreas.areas[2]!)).toBe('Opening Administration…');
  });

  it.each(['apple', 'apple-dark'])('has no violations in the %s theme', async (theme) => {
    document.documentElement.setAttribute('data-itsm-theme', theme);
    render(<AreaList model={demoAreas('workbench')} />);
    await expectNoViolations();
  });
});
