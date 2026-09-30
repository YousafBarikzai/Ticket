// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupDocument, click, render } from '../../web/__tests__/support/render.js';
import { Avatar, avatarHue, initials } from '../../web/Avatar.js';
import { Badge } from '../../web/Badge.js';
import { AvatarStack } from '../AvatarStack.js';
import { StatusPill } from '../StatusPill.js';

/*
 * Badges, status pills, avatars and stacks (SPEC §4.6): themed by `data-*`
 * attributes, never inline style (§3.3 rule 6), server-renderable, and named
 * the way a screen reader needs.
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
  it('draws the tone’s own shape by default, so the state reads without its colour', () => {
    const icons = (['neutral', 'accent', 'info', 'success', 'warning', 'danger'] as const).map((tone) => {
      const html = renderToStaticMarkup(<StatusPill label="State" tone={tone} />);
      return /data-icon="([^"]+)"/.exec(html)?.[1];
    });
    expect(icons).toEqual(['dot', 'clock', 'info', 'circle-check', 'triangle-alert', 'circle-alert']);
    expect(new Set(icons).size).toBe(6);
  });

  it('takes a named icon, a prefix, a size and an emphasis, with no inline style', () => {
    const html = renderToStaticMarkup(<StatusPill label="Paused" tone="warning" icon="pause" srPrefix="Status" size="sm" emphasis="solid" />);
    expect(html).toContain('data-icon="pause"');
    expect(html).toContain('Status: </span>Paused');
    expect(html).toContain('data-size="sm"');
    expect(html).toContain('data-emphasis="solid"');
    expect(html).not.toContain('style=');
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

  it('draws a glyph for AI and system, a square for teams, and one letter at the smallest size', () => {
    const html = renderToStaticMarkup(
      <div>
        <Avatar name="Assist" kind="ai" />
        <Avatar name="Automation" kind="system" />
        <Avatar name="Service Desk" kind="team" />
        <Avatar name="Ada Lovelace" size="xs" />
        <Avatar name="Ada Lovelace" initials="AdL" size="xl" />
      </div>,
    );
    expect(html).toContain('data-icon="sparkles"');
    expect(html).toContain('data-icon="bot"');
    expect(html).toMatch(/data-kind="team"[^>]*>.*?SD</);
    expect(html).toMatch(/data-size="xs"[^>]*>.*?>A</);
    expect(html).toMatch(/data-size="xl"[^>]*>.*?>Ad</);
    expect(html).not.toContain('style=');
    expect(html).not.toContain('<img');
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
    // Each row is the one-letter avatar (hidden) and the name.
    expect(names).toEqual(people.map((person) => `${person.name[0]}${person.name}`));
    expect(details.open).toBe(false);
    click(summary);
    expect(details.open).toBe(true);
  });
});
