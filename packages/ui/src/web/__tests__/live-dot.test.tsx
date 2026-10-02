// @vitest-environment jsdom
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { unknownVariables } from '../../styles/css.js';
import { Badge, type BadgeDotState } from '../Badge.js';
import { badgeStyles } from '../Badge.styles.js';
import { expectNoViolations } from './support/audit.js';
import { cleanupDocument, render } from './support/render.js';

/*
 * The live dot (v3 §2.14, `Badge` `dotState`): the connection's state as an
 * 8 px dot in its own colour, always with the words beside it, pulsing only
 * when live and only when motion is allowed. Server-safe, like `Badge`.
 */

afterEach(() => cleanupDocument());

function markup(element: ReactElement): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(element);
  return host.firstElementChild as HTMLElement;
}

const words: Readonly<Record<BadgeDotState, string>> = { live: 'Live', reconnecting: 'Reconnecting…', offline: 'Offline' };

/** The declarations of every top-level rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...badgeStyles.matchAll(new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`, 'g'))].map((match) => match[1]).join('\n');
}

describe('the live dot', () => {
  it.each(Object.entries(words) as [BadgeDotState, string][])('%s: a dot in its state, hidden from assistive technology, with the words beside it', (state, label) => {
    const badge = markup(<Badge dotState={state}>{label}</Badge>);
    const dot = badge.querySelector<HTMLElement>('.itsm-Badge__dot')!;
    expect(dot.dataset.state).toBe(state);
    expect(dot.getAttribute('aria-hidden')).toBe('true');
    // The words are the badge's own text, right after the dot: the state is never colour alone.
    expect(dot.nextSibling?.textContent).toBe(label);
    expect(badge.textContent).toBe(label);
  });

  it('draws the dot by itself, without the dot flag', () => {
    expect(markup(<Badge dotState="offline">Offline</Badge>).querySelector('.itsm-Badge__dot')).not.toBeNull();
    // A plain dot keeps v2's look and carries no state.
    expect(markup(<Badge dot>Draft</Badge>).querySelector('.itsm-Badge__dot')?.hasAttribute('data-state')).toBe(false);
    expect(markup(<Badge>Draft</Badge>).querySelector('.itsm-Badge__dot')).toBeNull();
  });

  it('colours each state from its own token, whatever the badge’s tone, at 8 px', () => {
    expect(rule('.itsm-Badge__dot[data-state]')).toMatch(/inline-size: 0\.5rem;[\s\S]*block-size: 0\.5rem;/);
    expect(rule('.itsm-Badge .itsm-Badge__dot[data-state="live"]')).toContain('background: var(--itsm-colour-success-border);');
    expect(rule('.itsm-Badge .itsm-Badge__dot[data-state="reconnecting"]')).toContain('background: var(--itsm-colour-warning-border);');
    expect(rule('.itsm-Badge .itsm-Badge__dot[data-state="offline"]')).toContain('background: var(--itsm-colour-neutral-border);');
    // Declared after the tone's solid dot, at the same weight, so the state wins on a solid badge too.
    expect(badgeStyles.indexOf('.itsm-Badge .itsm-Badge__dot[data-state="live"]')).toBeGreaterThan(badgeStyles.indexOf('.itsm-Badge[data-emphasis="solid"] .itsm-Badge__dot'));
    expect(unknownVariables(badgeStyles)).toEqual([]);
  });

  it('pulses a ring every 2 s only when live', () => {
    const ring = rule('.itsm-Badge__dot[data-state="live"]::after');
    expect(ring).toContain('animation: itsm-Badge-live 2s');
    expect(badgeStyles).not.toMatch(/data-state="(?:reconnecting|offline)"\]::after/);
    // Transform and opacity only: nothing is laid out again on each beat.
    const keyframes = badgeStyles.slice(badgeStyles.indexOf('@keyframes itsm-Badge-live'), badgeStyles.indexOf('.itsm-Badge__dot[data-state] {'));
    expect(keyframes).toMatch(/opacity/);
    expect(keyframes).toMatch(/transform: scale/);
    expect(keyframes).not.toMatch(/box-shadow|inline-size|block-size/);
  });

  it('never pulses under reduced motion, the system’s or the product’s', () => {
    expect(badgeStyles).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.itsm-Badge__dot\[data-state="live"\]::after \{\s*animation: none;/);
    expect(badgeStyles).toMatch(/:root\[data-itsm-motion="reduced"\] \.itsm-Badge__dot\[data-state="live"\]::after \{\s*animation: none;/);
  });

  it('keeps the dot visible when colours are forced', () => {
    const forced = badgeStyles.slice(badgeStyles.indexOf('@media (forced-colors: active)'));
    expect(forced).toContain('.itsm-Badge .itsm-Badge__dot[data-state],');
    expect(forced).toContain('background: CanvasText;');
  });

  it('passes axe in each state', async () => {
    render(
      <p>
        <Badge dotState="live" tone="success">
          Live
        </Badge>{' '}
        <Badge dotState="reconnecting" tone="warning">
          Reconnecting…
        </Badge>{' '}
        <Badge dotState="offline">Offline</Badge>
      </p>,
    );
    await expectNoViolations(document.body);
  });
});
