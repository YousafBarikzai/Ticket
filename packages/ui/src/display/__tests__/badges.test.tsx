// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { unknownVariables } from '../../styles/css.js';
import { cleanupDocument, click, render } from '../../web/__tests__/support/render.js';
import { Avatar, avatarHue, initials } from '../../web/Avatar.js';
import { avatarStyles } from '../../web/Avatar.styles.js';
import { Badge } from '../../web/Badge.js';
import { AvatarStack } from '../AvatarStack.js';
import { StatusPill } from '../StatusPill.js';
import { statusPillStyles } from '../StatusPill.styles.js';
import { TICKET_STATE_LOOK } from '../ticket-states.js';

/*
 * Badges, status pills, avatars and stacks (SPEC §4.6; v3 §2.14): themed by
 * `data-*` attributes, never inline style (§3.3 rule 6) except a custom
 * avatar's size, server-renderable, and named the way a screen reader needs.
 */

afterEach(() => cleanupDocument());

describe('Badge', () => {
  it('carries its tone, emphasis and size as attributes, with no inline style', () => {
    const html = renderToStaticMarkup(
      <Badge tone="danger" emphasis="solid" size="sm">
        P1
      </Badge>,
    );
    expect(html).toContain('data-tone="danger"');
    expect(html).toContain('data-emphasis="solid"');
    expect(html).toContain('data-size="sm"');
    expect(html).not.toContain('style=');
  });

  it('defaults to a neutral, subtle, medium badge', () => {
    const { container } = render(<Badge>Draft</Badge>);
    const badge = container.querySelector<HTMLElement>('.itsm-Badge')!;
    expect(badge.dataset).toMatchObject({ tone: 'neutral', emphasis: 'subtle', size: 'md' });
  });

  it('still accepts the deprecated intent, with brand meaning accent', () => {
    const { container } = render(
      <div>
        <Badge intent="brand">New</Badge>
        <Badge intent="warning">Paused</Badge>
        <Badge intent="warning" tone="success">
          tone wins
        </Badge>
      </div>,
    );
    expect([...container.querySelectorAll<HTMLElement>('.itsm-Badge')].map((badge) => badge.dataset.tone)).toEqual([
      'accent',
      'warning',
      'success',
    ]);
  });

  it('speaks its prefix and keeps the dot and icon silent', () => {
    const { container } = render(
      <Badge srPrefix="Priority" dot icon="flag" tone="warning">
        P2
      </Badge>,
    );
    const badge = container.querySelector('.itsm-Badge')!;
    expect(badge.querySelector('.itsm-visually-hidden')!.textContent).toBe('Priority: ');
    expect(badge.querySelector('.itsm-Badge__dot')!.getAttribute('aria-hidden')).toBe('true');
    expect(badge.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    expect(badge.textContent).toBe('Priority: P2');
  });

  it('spreads data and aria attributes and forwards its ref', () => {
    let node: HTMLSpanElement | null = null;
    render(
      <Badge data-testid="count" aria-live="off" ref={(element) => void (node = element)}>
        3
      </Badge>,
    );
    expect(node).not.toBeNull();
    expect(node!.getAttribute('data-testid')).toBe('count');
    expect(node!.getAttribute('aria-live')).toBe('off');
  });
});

describe('StatusPill', () => {
  it('draws each of the eight tones in its own shape, so the state reads without its colour', () => {
    const tones = ['neutral', 'accent', 'info', 'success', 'warning', 'danger', 'hold', 'high'] as const;
    const icons = tones.map((tone) => {
      const html = renderToStaticMarkup(<StatusPill label="State" tone={tone} />);
      expect(html).toContain(`data-tone="${tone}"`);
      return /data-icon="([^"]+)"/.exec(html)?.[1];
    });
    expect(icons).toEqual(['dot', 'clock', 'info', 'circle-check', 'triangle-alert', 'circle-alert', 'pause', 'flag']);
    expect(new Set(icons).size).toBe(8);
  });

  it('takes a named icon, a prefix, a size and an emphasis, with no inline style', () => {
    const html = renderToStaticMarkup(<StatusPill label="Paused" tone="hold" icon="pause" srPrefix="Status" size="sm" emphasis="solid" />);
    expect(html).toContain('data-icon="pause"');
    expect(html).toContain('Status: </span>Paused');
    expect(html).toContain('data-size="sm"');
    expect(html).toContain('data-emphasis="solid"');
    expect(html).not.toContain('style=');
  });

  it('spreads a ticket state’s look straight in', () => {
    const { container } = render(<StatusPill {...TICKET_STATE_LOOK.pending_approval} />);
    const pill = container.querySelector<HTMLElement>('.itsm-StatusPill')!;
    expect(pill.dataset.tone).toBe('hold');
    expect(pill.querySelector('svg')!.getAttribute('data-icon')).toBe('hourglass');
    expect(pill.textContent).toBe('Awaiting approval');
  });

  it('adds a meta figure after a middle dot, and nothing when it is blank', () => {
    const { container } = render(
      <div>
        <StatusPill label="Critical" tone="danger" meta="16" />
        <StatusPill label="Open" tone="info" meta="  " />
      </div>,
    );
    const [scored, plain] = [...container.querySelectorAll('.itsm-StatusPill')];
    expect(scored!.textContent).toBe('Critical · 16');
    expect(scored!.querySelector('.itsm-StatusPill__meta')!.textContent).toBe(' · 16');
    expect(plain!.querySelector('.itsm-StatusPill__meta')).toBeNull();
  });

  it('is a span by default and a plain button only when asked, passing a trigger’s props through', () => {
    const { container } = render(
      <div>
        <StatusPill label="Open" tone="info" />
        <StatusPill label="View only" tone="neutral" as="button" aria-expanded={false} aria-haspopup="dialog" />
      </div>,
    );
    const [span, button] = [...container.querySelectorAll('.itsm-StatusPill')];
    expect(span!.tagName).toBe('SPAN');
    expect(button!.tagName).toBe('BUTTON');
    expect(button!.getAttribute('type')).toBe('button');
    expect(button!.getAttribute('aria-expanded')).toBe('false');
    expect(button!.getAttribute('aria-haspopup')).toBe('dialog');
  });

  it('is 22 px at md and 20 at sm, rings the neutral tone, and turns into an outlined chip on a navy hero', () => {
    const rule = (selector: string): string => {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`).exec(statusPillStyles)?.[1] ?? '';
    };
    expect(rule('.itsm-StatusPill')).toContain('min-block-size: 1.375rem;');
    expect(rule('.itsm-StatusPill[data-size="sm"]')).toContain('min-block-size: 1.25rem;');
    expect(rule('.itsm-StatusPill[data-tone="neutral"][data-emphasis="subtle"]')).toContain('var(--itsm-colour-border-subtle)');
    const hero = rule('[data-surface="hero"] .itsm-StatusPill[data-emphasis="subtle"]');
    expect(hero).toContain('background: transparent;');
    expect(hero).toContain('color: var(--itsm-colour-hero-text);');
    for (const tone of ['neutral', 'accent', 'info', 'success', 'warning', 'danger', 'hold', 'high']) {
      expect(statusPillStyles).toContain(`[data-surface="hero"] .itsm-StatusPill[data-tone="${tone}"] { --_itsm-pill-mark: var(--itsm-colour-hero-${tone}); }`);
    }
    expect(statusPillStyles).not.toMatch(/opacity/);
    expect(unknownVariables(statusPillStyles)).toEqual([]);
  });
});

describe('Avatar', () => {
  it('works out initials from names and addresses', () => {
    expect(initials('Ada Lovelace')).toBe('AL');
    expect(initials('  grace  brewster murray hopper ')).toBe('GH');
    expect(initials('Ada')).toBe('A');
    expect(initials('ada.lovelace@example.com')).toBe('AL');
    expect(initials('Jean-Luc Picard')).toBe('JP');
    expect(initials('   ')).toBe('');
    expect(initials('𝒜da Lovelace')).toBe('𝒜L');
  });

  it('gives a name the same hue every time, from eight', () => {
    expect(avatarHue('Ada Lovelace')).toBe(avatarHue(' ada lovelace '));
    const hues = new Set(['Ada', 'Grace', 'Alan', 'Edsger', 'Barbara', 'Donald', 'Margaret', 'Tim', 'Radia', 'Ken'].map(avatarHue));
    expect([...hues].every((hue) => hue >= 1 && hue <= 8)).toBe(true);
    expect(hues.size).toBeGreaterThan(3);
  });

  it('is an image named by the person and their presence', () => {
    const { container } = render(<Avatar name="Ada Lovelace" status="away" />);
    const avatar = container.querySelector('.itsm-Avatar')!;
    expect(avatar.getAttribute('role')).toBe('img');
    expect(avatar.getAttribute('aria-label')).toBe('Ada Lovelace, away');
    expect(avatar.querySelector('.itsm-Avatar__status')!.getAttribute('data-status')).toBe('away');
    expect(avatar.textContent).toBe('AL');
  });

  it('adds nothing to announce when decorative', () => {
    const { container } = render(<Avatar name="Ada Lovelace" decorative />);
    const avatar = container.querySelector('.itsm-Avatar')!;
    expect(avatar.getAttribute('aria-hidden')).toBe('true');
    expect(avatar.hasAttribute('role')).toBe(false);
    expect(avatar.hasAttribute('aria-label')).toBe(false);
  });

  it('draws a glyph for AI (violet) and system, a square for teams, and two letters at every size on the ramp', () => {
    const html = renderToStaticMarkup(
      <div>
        <Avatar name="Assist" kind="ai" />
        <Avatar name="Automation" kind="system" />
        <Avatar name="Service Desk" kind="team" />
        <Avatar name="Ada Lovelace" size="xs" />
        <Avatar name="Ada Lovelace" initials="AdL" size="xl" />
      </div>,
    );
    expect(html).toMatch(/data-kind="ai" data-hue="3"[^>]*>.*?data-icon="sparkles"/);
    expect(html).toMatch(/data-kind="system"(?![^>]*data-hue)[^>]*>.*?data-icon="bot"/);
    expect(html).toMatch(/data-kind="team"[^>]*>.*?SD</);
    expect(html).toMatch(/data-size="xs"[^>]*>.*?>AL</);
    expect(html).toMatch(/data-size="xl"[^>]*>.*?>Ad</);
    expect(html).not.toContain('style=');
    expect(html).not.toContain('<img');
  });

  it('keeps two letters at every size and drops to one only below the ramp', () => {
    for (const size of ['xs', 'sm', 'md', 'lg', 'xl'] as const) {
      const { container } = render(<Avatar name="Grace Hopper" size={size} />);
      expect(container.querySelector('.itsm-Avatar__initials')!.textContent, size).toBe('GH');
      cleanupDocument();
    }
    const { container } = render(
      <div>
        <Avatar name="Grace Hopper" size={44} />
        <Avatar name="Grace Hopper" size={16} />
      </div>,
    );
    const [card, tiny] = [...container.querySelectorAll<HTMLElement>('.itsm-Avatar')];
    expect(card!.dataset.size).toBe('custom');
    expect(card!.style.getPropertyValue('--_itsm-avatar-size')).toBe('2.75rem');
    expect(card!.textContent).toBe('GH');
    expect(tiny!.textContent).toBe('G');
    cleanupDocument();
    const { container: odd } = render(<Avatar name="Grace Hopper" size={Number.NaN} />);
    const fallback = odd.querySelector<HTMLElement>('.itsm-Avatar')!;
    expect(fallback.dataset.size).toBe('md');
    expect(fallback.hasAttribute('style')).toBe(false);
  });

  it('never splits a letter outside the Basic Multilingual Plane', () => {
    const { container } = render(<Avatar name="x" initials="𝒜𝒷" size="xs" />);
    expect(container.querySelector('.itsm-Avatar__initials')!.textContent).toBe('𝒜𝒷');
  });

  it('draws nobody as a dashed "Unassigned" placeholder with a person glyph and no hue', () => {
    const { container } = render(
      <div>
        <Avatar kind="unassigned" />
        <Avatar kind="unassigned" size="sm" decorative />
      </div>,
    );
    const [named, quiet] = [...container.querySelectorAll<HTMLElement>('.itsm-Avatar')];
    expect(named!.getAttribute('role')).toBe('img');
    expect(named!.getAttribute('aria-label')).toBe('Unassigned');
    expect(named!.dataset.kind).toBe('unassigned');
    expect(named!.hasAttribute('data-hue')).toBe(false);
    expect(named!.querySelector('svg')!.getAttribute('data-icon')).toBe('user');
    expect(quiet!.getAttribute('aria-hidden')).toBe('true');
    expect(avatarStyles).toMatch(/\.itsm-Avatar\[data-kind="unassigned"\] \{[^}]*border: calc\(var\(--itsm-border-hair\) \* 1\.5\) dashed var\(--itsm-colour-border-interactive\);[^}]*color: var\(--itsm-colour-text-muted\);/);
  });

  it('rings an avatar in the raised surface when asked', () => {
    const { container } = render(<Avatar name="Ada Lovelace" ring />);
    expect(container.querySelector<HTMLElement>('.itsm-Avatar')!.hasAttribute('data-ring')).toBe(true);
    expect(avatarStyles).toContain('.itsm-Avatar[data-ring] {\n  box-shadow: 0 0 0 var(--itsm-border-thick) var(--itsm-colour-surface-raised);');
  });

  it('sets 9 px untracked letters at xs and 40 % of the disc elsewhere', () => {
    expect(avatarStyles).toContain('.itsm-Avatar[data-size="xs"] { --_itsm-avatar-size: 1.25rem; font-size: 0.5625rem; letter-spacing: 0; }');
    expect(avatarStyles).toContain('.itsm-Avatar[data-size="sm"] { --_itsm-avatar-size: 1.5rem; font-size: 0.625rem; }');
    expect(avatarStyles).toContain('.itsm-Avatar[data-size="md"] { --_itsm-avatar-size: 2rem; font-size: 0.8125rem; }');
    expect(avatarStyles).toContain('.itsm-Avatar[data-size="lg"] { --_itsm-avatar-size: 2.5rem; font-size: 1rem; }');
    expect(avatarStyles).toContain('.itsm-Avatar[data-size="xl"] { --_itsm-avatar-size: 3.5rem; font-size: 1.375rem; }');
    expect(avatarStyles).toContain('font-size: calc(var(--_itsm-avatar-size) * 0.4);');
    expect(avatarStyles).toContain('letter-spacing: 0.02em;');
    expect(unknownVariables(avatarStyles)).toEqual([]);
  });
});

describe('AvatarStack', () => {
  const people = ['Ada Lovelace', 'Grace Hopper', 'Alan Turing', 'Edsger Dijkstra', 'Barbara Liskov'].map((name) => ({ name }));

  it('is one image named by the whole list when everybody fits', () => {
    const { container } = render(<AvatarStack people={people.slice(0, 3)} label="Assignees" />);
    const stack = container.querySelector('.itsm-AvatarStack')!;
    expect(stack.getAttribute('role')).toBe('img');
    expect(stack.getAttribute('aria-label')).toBe('Assignees: Ada Lovelace, Grace Hopper and Alan Turing');
    expect(stack.querySelectorAll('.itsm-Avatar')).toHaveLength(3);
    expect(stack.querySelector('.itsm-AvatarStack__more')).toBeNull();
  });

  it('never hides one person behind "+1"', () => {
    const { container } = render(<AvatarStack people={people.slice(0, 4)} />);
    expect(container.querySelectorAll('.itsm-Avatar')).toHaveLength(4);
    expect(container.querySelector('details')).toBeNull();
  });

  it('shows "+2" and reveals every name on a tap, with no script', () => {
    const { container } = render(<AvatarStack people={people} />);
    const details = container.querySelector('details')!;
    const summary = details.querySelector('summary')!;
    expect(details.querySelectorAll('summary .itsm-Avatar')).toHaveLength(3);
    expect(summary.querySelector('.itsm-AvatarStack__more')!.textContent).toBe('+2');
    expect(summary.getAttribute('aria-label')).toBe('Ada Lovelace, Grace Hopper, Alan Turing, Edsger Dijkstra and Barbara Liskov');
    const names = [...details.querySelectorAll('.itsm-AvatarStack__person')].map((person) => person.textContent);
    // Each row is the two-letter avatar (hidden) and the name.
    expect(names).toEqual(people.map((person) => `${initials(person.name)}${person.name}`));
    expect(details.open).toBe(false);
    click(summary);
    expect(details.open).toBe(true);
  });
});
