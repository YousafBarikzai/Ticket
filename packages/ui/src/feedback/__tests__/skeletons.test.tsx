// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { componentStylesheet } from '../../styles/index.js';
import { cleanupDocument, render } from '../../web/__tests__/support/render.js';
import { Skeleton, SkeletonText } from '../../web/Skeleton.js';
import {
  SkeletonAvatar,
  SkeletonCard,
  SkeletonConversation,
  SkeletonList,
  SkeletonPage,
  SkeletonStat,
  SkeletonTable,
  type SkeletonPageVariant,
} from '../Skeletons.js';

/*
 * The skeleton family (SPEC §4.5, §1.9; WP6 acceptance "skeleton 200 ms reveal
 * and 1 s SR status"): server-rendered shapes that say nothing to a screen
 * reader, one delayed status per page, and all of the timing in CSS.
 */

afterEach(() => cleanupDocument());

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const variants: readonly SkeletonPageVariant[] = ['list', 'detail', 'dashboard', 'form', 'workspace', 'inbox', 'settings'];

/** Every rule in the stylesheet that mentions `selector`, as text. */
function rulesFor(selector: string): string {
  return componentStylesheet
    .split('}')
    .filter((chunk) => chunk.includes(selector))
    .join('}\n');
}

describe('server-safe', () => {
  it('has no client directive, so a loading.tsx streams it with no JavaScript', () => {
    for (const file of ['web/Skeleton.tsx', 'feedback/Skeletons.tsx', 'feedback/Spinner.tsx']) {
      const source = readFileSync(join(SRC, file), 'utf8');
      expect(source.trimStart().startsWith("'use client'"), file).toBe(false);
    }
  });

  it.each([
    ['Skeleton', <Skeleton width="40%" height={12} />],
    ['SkeletonText', <SkeletonText lines={2} />],
    ['SkeletonAvatar', <SkeletonAvatar size="lg" />],
    ['SkeletonStat', <SkeletonStat />],
    ['SkeletonCard', <SkeletonCard lines={4} />],
    ['SkeletonTable', <SkeletonTable rows={3} columns={5} />],
    ['SkeletonList', <SkeletonList rows={3} />],
    ['SkeletonConversation', <SkeletonConversation messages={2} />],
    ...variants.map((variant) => [`SkeletonPage ${variant}`, <SkeletonPage variant={variant} />] as const),
  ] as readonly (readonly [string, ReactElement])[])('%s renders on the server without a provider', (_name, element) => {
    expect(renderToStaticMarkup(element).length).toBeGreaterThan(0);
  });
});

describe('what a screen reader gets', () => {
  it('hides every bone', () => {
    const { container } = render(
      <div>
        {variants.map((variant) => (
          <SkeletonPage key={variant} variant={variant} />
        ))}
      </div>,
    );
    const bones = Array.from(container.querySelectorAll('.itsm-Skeleton'));
    expect(bones.length).toBeGreaterThan(50);
    for (const bone of bones) expect(bone.closest('[aria-hidden="true"]'), bone.outerHTML).not.toBeNull();
  });

  it('gives a page one status, beside — not inside — the busy shapes', () => {
    const { container } = render(<SkeletonPage variant="list" label="Loading rules…" />);
    const statuses = container.querySelectorAll('[role="status"]');
    expect(statuses).toHaveLength(1);
    const status = statuses[0]!;
    expect(status.querySelector('.itsm-SkeletonStatus__loading')?.textContent).toBe('Loading rules…');
    expect(status.querySelector('.itsm-SkeletonStatus__still')?.textContent).toBe('Still loading…');
    const busy = container.querySelector('[aria-busy="true"]');
    expect(busy).not.toBeNull();
    expect(busy?.contains(status)).toBe(false);
    expect(status.closest('[aria-busy]')).toBeNull();
  });

  it('says "Loading…" by default, and takes other words for "Still loading…"', () => {
    const { container } = render(<SkeletonPage variant="dashboard" stillLabel="This is taking longer than usual…" />);
    expect(container.querySelector('.itsm-SkeletonStatus__loading')?.textContent).toBe('Loading…');
    expect(container.querySelector('.itsm-SkeletonStatus__still')?.textContent).toBe('This is taking longer than usual…');
  });

  it('keeps section skeletons silent unless given a label, so six loading cards say it once', () => {
    const silent = render(<SkeletonCard />);
    expect(silent.container.querySelector('[role="status"]')).toBeNull();
    expect(silent.container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
    silent.unmount();

    const labelled = render(<SkeletonTable label="Loading deliveries…" />);
    expect(labelled.container.querySelector('[role="status"]')?.textContent).toContain('Loading deliveries…');
    expect(labelled.container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('shapes each page like the page it stands in for', () => {
    const shapes = variants.map((variant) => renderToStaticMarkup(<SkeletonPage variant={variant} />));
    expect(new Set(shapes).size).toBe(variants.length);
    expect(shapes[variants.indexOf('dashboard')]).toContain('itsm-SkeletonStat');
    expect(shapes[variants.indexOf('list')]).toContain('itsm-SkeletonTable');
    expect(shapes[variants.indexOf('inbox')]).toContain('itsm-SkeletonList');
    expect(shapes[variants.indexOf('workspace')]).toContain('itsm-SkeletonConversation');
  });
});

describe('the timing, which is all CSS', () => {
  it('reveals the bones after 200 ms, so a fast response never flashes a skeleton', () => {
    expect(rulesFor('.itsm-Skeleton {')).toMatch(/animation: itsm-skeleton-reveal [^;]* 200ms both/);
    expect(rulesFor('.itsm-SkeletonCard,')).toMatch(/animation: itsm-skeleton-reveal [^;]* 200ms both/);
  });

  it('shows the screen-reader status at 1 s and "Still loading…" at 10 s, when the first one goes', () => {
    expect(rulesFor('.itsm-SkeletonStatus__loading')).toMatch(/visibility: hidden;[\s\S]*itsm-skeleton-appear 0s linear 1s forwards, itsm-skeleton-vanish 0s linear 10s forwards/);
    expect(rulesFor('.itsm-SkeletonStatus__still {')).toMatch(/itsm-skeleton-appear 0s linear 10s forwards/);
    expect(componentStylesheet).toContain('@keyframes itsm-skeleton-appear');
  });

  it('shimmers for about ten seconds and then stops', () => {
    expect(rulesFor('.itsm-Skeleton::after {')).toMatch(/itsm-skeleton-sweep 1\.6s linear 200ms 6;/);
  });

  it('holds still under reduced motion, the system’s or the product’s', () => {
    expect(componentStylesheet).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.itsm-Skeleton::after \{\s*display: none;/);
    expect(componentStylesheet).toMatch(/:root\[data-itsm-motion="reduced"\] \.itsm-Skeleton::after \{\s*display: none;/);
  });
});

describe('Skeleton', () => {
  it('keeps its old API and sizes itself inline (dynamic geometry), with the radius as data', () => {
    const markup = renderToStaticMarkup(<Skeleton width={120} height="1rem" radius="pill" />);
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('data-radius="pill"');
    expect(markup).toContain('inline-size:120px');
    expect(markup).toContain('block-size:1rem');
  });

  it('draws lines of text with a shorter last line', () => {
    const { container } = render(<SkeletonText lines={3} lastLineWidth="40%" size="footnote" />);
    const lines = Array.from(container.querySelectorAll<HTMLElement>('.itsm-SkeletonText__line'));
    expect(lines.map((line) => line.style.inlineSize)).toEqual(['100%', '100%', '40%']);
    expect(container.firstElementChild?.getAttribute('data-size')).toBe('footnote');
  });
});
