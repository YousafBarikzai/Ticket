// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ComponentProps, ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BrandMark } from '../BrandMark.js';
import { brandGlyphs, brandMarkSvg } from '../brand.js';
import { Icon } from '../Icon.js';
import { iconNodes } from '../nodes.js';
import { iconNames, iconRegistry, isIconName, type IconName } from '../registry.js';

/*
 * The icon registry and its renderers (SPEC §1.8, §4.1). Every name must draw
 * the lucide 1.48 icon the registry says it does — the deep imports in
 * `nodes.ts` are written by hand from the registry, and this is what keeps the
 * two in step. The renderers are server-safe, so they are tested the way a
 * server component uses them: rendered to static markup.
 */

const lucideIcons = join(dirname(createRequire(import.meta.url).resolve('lucide/package.json')), 'dist/esm/icons');

describe('the registry', () => {
  it.each(iconNames.map((name) => [name, iconRegistry[name]] as const))('%s draws lucide’s %s', async (name, file) => {
    const module = (await import(pathToFileURL(join(lucideIcons, `${file}.mjs`)).href)) as { default: unknown };
    expect(iconNodes[name]).toEqual(module.default);
  });

  it('has a drawing for every name and no drawing without a name', () => {
    expect(Object.keys(iconNodes).sort()).toEqual([...iconNames].sort());
  });

  it('checks names that arrive as data', () => {
    expect(isIconName('inbox')).toBe(true);
    expect(isIconName('toString')).toBe(false);
    expect(isIconName('Inbox')).toBe(false);
  });
});

function markup(element: ReactElement): Document {
  const html = renderToStaticMarkup(element);
  return new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html');
}

describe('Icon', () => {
  it('draws the icon’s shapes on the server, decorative by default', () => {
    const svg = markup(<Icon name="inbox" />).querySelector('svg')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('focusable')).toBe('false');
    expect(svg.hasAttribute('role')).toBe(false);
    expect(svg.getAttribute('data-icon')).toBe('inbox');
    expect(svg.querySelectorAll('path, polyline').length).toBe(iconNodes.inbox.length);
    expect(svg.getAttribute('stroke')).toBe('currentColor');
  });

  it('becomes an image with a name when labelled', () => {
    const svg = markup(<Icon name="triangle-alert" label="Warning" />).querySelector('svg')!;
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('Warning');
    expect(svg.hasAttribute('aria-hidden')).toBe(false);
  });

  it('keeps the stroke at 1.75 px whatever the size', () => {
    const stroke = (size: ComponentProps<typeof Icon>['size']): number =>
      Number(markup(<Icon name="check" {...(size === undefined ? {} : { size })} />).querySelector('svg')!.getAttribute('stroke-width'));
    const width = (size: ComponentProps<typeof Icon>['size'], px: number): number => (stroke(size) * px) / 24;
    expect(width(undefined, 18)).toBeCloseTo(1.75, 2);
    expect(width('xs', 14)).toBeCloseTo(1.75, 2);
    expect(width('2xl', 32)).toBeCloseTo(1.75, 2);
    expect(width(40, 40)).toBeCloseTo(1.75, 2);
  });

  it('sizes from the token, and marks token sizes for the rem rule in the stylesheet', () => {
    const svg = markup(<Icon name="check" size="lg" />).querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('20');
    expect(svg.getAttribute('data-size')).toBe('lg');
    const custom = markup(<Icon name="check" size={40} />).querySelector('svg')!;
    expect(custom.getAttribute('width')).toBe('40');
    expect(custom.hasAttribute('data-size')).toBe(false);
  });

  it('marks directional icons for mirroring in right-to-left text', () => {
    expect(markup(<Icon name="chevron-right" directional />).querySelector('svg')!.hasAttribute('data-directional')).toBe(true);
    expect(markup(<Icon name="chevron-right" />).querySelector('svg')!.hasAttribute('data-directional')).toBe(false);
  });

  it('draws an empty square for a name that is not registered, rather than failing the page', () => {
    const svg = markup(<Icon name={'no-such-icon' as IconName} />).querySelector('svg')!;
    expect(svg.childElementCount).toBe(0);
    expect(svg.getAttribute('width')).toBe('18');
  });

  it('passes data and aria attributes through, and keeps its own class', () => {
    const svg = markup(<Icon name="check" className="app-Tick" data-testid="tick" aria-describedby="hint" />).querySelector('svg')!;
    expect(svg.getAttribute('class')).toBe('itsm-Icon app-Tick');
    expect(svg.getAttribute('data-testid')).toBe('tick');
    expect(svg.getAttribute('aria-describedby')).toBe('hint');
  });
});

describe('BrandMark', () => {
  it.each([
    [undefined, 'layers-2'],
    ['admin', 'settings-2'],
    ['workbench', 'inbox'],
    ['portal', 'life-buoy'],
  ] as const)('draws the %s glyph (%s)', (app, glyph) => {
    const mark = markup(<BrandMark {...(app ? { app } : {})} />).querySelector('.itsm-BrandMark')!;
    expect(mark.getAttribute('data-app')).toBe(app ?? 'product');
    expect(mark.querySelectorAll('svg > *').length).toBe(iconNodes[glyph].length);
    expect(brandGlyphs[app ?? 'product']).toBe(glyph);
  });

  it('is decorative beside a visible name, and an image with one when titled', () => {
    const plain = markup(<BrandMark app="portal" />).querySelector('.itsm-BrandMark')!;
    expect(plain.getAttribute('aria-hidden')).toBe('true');
    const named = markup(<BrandMark app="portal" title="Help centre" />).querySelector('.itsm-BrandMark')!;
    expect(named.getAttribute('role')).toBe('img');
    expect(named.getAttribute('aria-label')).toBe('Help centre');
  });

  it('takes its size inline, as dynamic geometry', () => {
    const mark = markup(<BrandMark size={64} />).querySelector<HTMLElement>('.itsm-BrandMark')!;
    expect(mark.getAttribute('style')).toContain('inline-size:64px');
    expect(mark.getAttribute('style')).toContain('block-size:64px');
  });
});

describe('brandMarkSvg', () => {
  it('is a self-contained SVG document in the brand gradient', () => {
    const svg = brandMarkSvg({ app: 'workbench', size: 48 });
    const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(document.querySelector('parsererror')).toBeNull();
    const root = document.documentElement;
    expect(root.getAttribute('width')).toBe('48');
    expect(root.getAttribute('aria-hidden')).toBe('true');
    const stops = [...document.querySelectorAll('stop')].map((stop) => stop.getAttribute('stop-color'));
    expect(stops).toEqual(['#57A8FF', '#007AFF']);
    expect(document.querySelectorAll('g > *').length).toBe(iconNodes.inbox.length);
  });

  it('escapes the title it is given', () => {
    const svg = brandMarkSvg({ title: 'Help & "support" <centre>' });
    const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(document.querySelector('parsererror')).toBeNull();
    expect(document.querySelector('title')!.textContent).toBe('Help & "support" <centre>');
    expect(document.documentElement.getAttribute('role')).toBe('img');
  });
});
