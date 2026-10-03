// @vitest-environment jsdom
import axe from 'axe-core';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

const { default: TryPage, generateMetadata } = await import('../app/try/[persona]/page.js');

/**
 * The role page `/try/<persona>` (SPEC v3 §6.3; A5 §6.8): a 404 for an
 * unknown persona or with DEMO_MODE off; the deep link checked, dropped when
 * unsafe or while its Service Desk route is pending (RV6, R12); the Open
 * Graph title and description; plain nofollow anchors; axe.
 */

const DEPLOYED = {
  NODE_ENV: 'production',
  SITE_ORIGIN: 'https://www.example.com',
  PORTAL_ORIGIN: 'https://help.example.com',
  WORKBENCH_ORIGIN: 'https://desk.example.com',
  ADMIN_ORIGIN: 'https://admin.example.com',
  DEMO_MODE: 'on',
};

function deploy(env: Readonly<Record<string, string | undefined>> = DEPLOYED): void {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value ?? '');
}

async function render(persona: string, search: Record<string, string | string[]> = {}): Promise<Document> {
  const page = await TryPage({ params: Promise.resolve({ persona }), searchParams: Promise.resolve(search) });
  document.open();
  document.write(`<!doctype html><html lang="en-GB"><head><title>Try</title></head><body>${renderToStaticMarkup(page as ReactElement)}</body></html>`);
  document.close();
  return document;
}

function primary(doc: Document): string | null {
  return doc.querySelector('a[data-persona]')?.getAttribute('href') ?? null;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('/try/[persona]', () => {
  it('is a 404 for a persona outside the table', async () => {
    deploy();
    await expect(render('root')).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(render('toString')).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('is a 404 for every persona when DEMO_MODE is off, and has no metadata', async () => {
    deploy({ ...DEPLOYED, DEMO_MODE: 'off' });
    for (const persona of ['employee', 'agent', 'admin']) await expect(render(persona)).rejects.toThrow('NEXT_NOT_FOUND');
    expect(await generateMetadata({ params: Promise.resolve({ persona: 'agent' }) })).toEqual({});
  });

  it('names the area and the persona, and opens the demo with one plain nofollow link', async () => {
    deploy();
    const doc = await render('agent');
    expect([...doc.querySelectorAll('h1')].map((h) => h.textContent)).toEqual(['Explore the Service Desk']);
    expect(doc.body.textContent).toContain("You'll be signed in as Alex Morgan, Service Desk team lead at Northwind Traders (UK), a fictional company.");
    expect(doc.body.textContent).not.toContain('This link opens a specific page');
    const open = doc.querySelector<HTMLAnchorElement>('a[data-persona="agent"]')!;
    expect(open.getAttribute('href')).toBe('https://desk.example.com/demo?persona=agent&demo=1');
    expect(open.getAttribute('rel')).toBe('nofollow');
    expect(open.hasAttribute('target')).toBe(false);
    expect(doc.querySelector('a[href="/sign-in?start=demo"]')?.textContent).toBe('See all roles');
    expect(doc.querySelector('.app-DemoNotes')).not.toBeNull();
    expect(doc.querySelectorAll('form')).toHaveLength(0);
  });

  it('carries a safe deep link and says so', async () => {
    deploy();
    const doc = await render('agent', { to: '/tickets/INC-004101' });
    expect(primary(doc)).toBe('https://desk.example.com/demo?persona=agent&demo=1&redirectTo=%2Ftickets%2FINC-004101');
    expect(doc.body.textContent).toContain('This link opens a specific page in the Service Desk.');
  });

  it('drops an unsafe deep link without failing', async () => {
    deploy();
    for (const to of ['//evil.example', '/\\evil', 'javascript:alert(1)', '/api/session/logout', '/demo', 'https://evil.example/']) {
      const doc = await render('agent', { to });
      expect(primary(doc)).toBe('https://desk.example.com/demo?persona=agent&demo=1');
      expect(doc.body.textContent).not.toContain('This link opens a specific page');
    }
    expect(primary(await render('agent', { to: ['/overview', '/x'] }))).toBe('https://desk.example.com/demo?persona=agent&demo=1');
  });

  it('drops a Service Desk deep link while its route is pending, and keeps a shipped one', async () => {
    deploy();
    expect(primary(await render('agent', { to: '/board' }))).toBe('https://desk.example.com/demo?persona=agent&demo=1');
    expect(primary(await render('agent', { to: '/major-incidents/MI-0004' }))).toBe('https://desk.example.com/demo?persona=agent&demo=1');
    expect(primary(await render('agent', { to: '/overview' }))).toBe('https://desk.example.com/demo?persona=agent&demo=1&redirectTo=%2Foverview');
    // The pending set is the Service Desk's: the portal's own /knowledge is a real page.
    expect(primary(await render('employee', { to: '/knowledge' }))).toBe('https://help.example.com/demo?persona=employee&demo=1&redirectTo=%2Fknowledge');
  });

  it('gives the link a preview: title, description, Open Graph, noindex', async () => {
    deploy();
    const meta = await generateMetadata({ params: Promise.resolve({ persona: 'employee' }) });
    expect(meta.title).toBe('Explore the Help Portal as Emma Clarke');
    expect(meta.description).toBe('A one-click demo of IT Service Management with a fictional company. Demo data resets every night.');
    expect(meta.openGraph).toMatchObject({ title: 'Explore the Help Portal as Emma Clarke', description: meta.description });
    expect(meta.robots).toEqual({ index: false, follow: true });
  });

  it('says the demo is unavailable when the area’s origin is missing', async () => {
    deploy({ ...DEPLOYED, ADMIN_ORIGIN: undefined });
    const doc = await render('admin');
    expect(doc.querySelector('a[data-persona]')).toBeNull();
    expect(doc.body.textContent).toContain("This part of the demo isn't available right now.");
  });

  it('passes axe', async () => {
    deploy();
    await render('admin', { to: '/' });
    const results = await axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
      rules: { 'color-contrast': { enabled: false }, 'color-contrast-enhanced': { enabled: false }, 'target-size': { enabled: false } },
    });
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});
