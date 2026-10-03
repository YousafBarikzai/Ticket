// @vitest-environment jsdom
import { describe, expect, it, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { diffJson, flatten } from '../components/JsonDiff.js';
import { JsonView, summarise } from '../components/JsonView.js';
import { copyMondayToWeekdays, dayProblem, describeDay, fromShiftPattern, toShiftPattern, WeekHours } from '../components/WeekHours.js';
import { PersonCell } from '../components/PersonCell.js';
import { drawerHref, parseDrawer } from '../client/useDrawer.js';
import { lifecycle, publishState } from '../lifecycle.js';
import { config, proxy } from '../proxy.js';
import { cleanupDocument, render } from './support/render.js';

/**
 * The shared admin building blocks' own rules: what a diff reports, what a
 * week of hours may hold, how a drawer sits in the URL, how a state is
 * named — and the front door that keeps a deep link through sign-in.
 */

afterEach(cleanupDocument);

describe('JsonDiff', () => {
  it('reports leaves by path: added, removed, changed and the same', () => {
    const rows = diffJson({ name: 'VIP', targets: [{ minutes: 60 }], old: true }, { name: 'VIP requester', targets: [{ minutes: 60 }, { minutes: 240 }] });
    expect(rows).toEqual([
      { path: 'name', kind: 'changed', before: '"VIP"', after: '"VIP requester"' },
      { path: 'targets.0.minutes', kind: 'same', before: '60', after: '60' },
      { path: 'targets.1.minutes', kind: 'added', after: '240' },
      { path: 'old', kind: 'removed', before: 'true' },
    ]);
  });

  it('treats an empty object or list as a value, so filling it is a change', () => {
    expect(flatten({ a: {} })).toEqual(new Map([['a', '{}']]));
    expect(diffJson({ a: [] }, { a: [1] }).map((row) => row.kind)).toEqual(['added', 'removed']);
    expect(diffJson(null, 3)).toEqual([{ path: '(value)', kind: 'changed', before: 'null', after: '3' }]);
  });
});

describe('JsonView', () => {
  it('shows a value as a tree, open to two levels, with Copy', () => {
    const { container } = render(<JsonView value={{ ticket: { priority: 'P1', tags: ['vip'] }, retries: 3 }} label="Payload" />);
    expect(container.querySelector('section')?.getAttribute('aria-label')).toBe('Payload');
    expect(container.textContent).toContain('"P1"');
    expect(container.querySelectorAll('details[open]').length).toBeGreaterThanOrEqual(2);
    expect([...container.querySelectorAll('button')].some((button) => button.textContent === 'Copy')).toBe(true);
    expect(summarise([1, 2])).toBe('2 items');
    expect(summarise({ a: 1 })).toBe('1 key');
  });
});

describe('WeekHours', () => {
  it('finds hours that end before they start, or overlap', () => {
    expect(dayProblem([{ start: '09:00', end: '17:30' }])).toBeNull();
    expect(dayProblem([{ start: '17:00', end: '09:00' }])).toBe('09:00 is not after 17:00.');
    expect(dayProblem([{ start: '09:00', end: '13:00' }, { start: '12:00', end: '17:00' }])).toBe('These hours overlap.');
    expect(dayProblem([{ start: '00:00', end: '24:00' }])).toBeNull();
  });

  it('copies Monday to the weekdays, and a closed Monday closes them', () => {
    const week = copyMondayToWeekdays({ mon: [{ start: '08:00', end: '16:00' }], sat: [{ start: '10:00', end: '12:00' }] });
    expect(Object.keys(week).sort()).toEqual(['fri', 'mon', 'sat', 'thu', 'tue', 'wed']);
    expect(week.fri).toEqual([{ start: '08:00', end: '16:00' }]);
    expect(copyMondayToWeekdays({ tue: [{ start: '09:00', end: '10:00' }] })).toEqual({});
  });

  it('converts to and from a shift pattern', () => {
    const pattern = { mon: [{ from: '07:00', to: '15:00' }] };
    expect(fromShiftPattern(pattern)).toEqual({ mon: [{ start: '07:00', end: '15:00' }] });
    expect(toShiftPattern(fromShiftPattern(pattern))).toEqual(pattern);
    expect(describeDay(undefined)).toBe('Closed');
  });

  it('draws the week with a switch per day, and a compact strip that is read out', () => {
    const value = { mon: [{ start: '09:00', end: '17:30' }] };
    const { container } = render(<WeekHours label="Business hours" value={value} onChange={() => undefined} />);
    expect(container.querySelectorAll('[role="switch"]')).toHaveLength(7);
    expect(container.querySelector('[role="switch"][aria-checked="true"]')).not.toBeNull();
    const compact = render(<WeekHours label="Business hours" value={value} compact />);
    expect(compact.container.textContent).toContain('Monday: 09:00–17:30');
    expect(compact.container.textContent).toContain('Sunday: Closed');
  });
});

describe('PersonCell', () => {
  it('names a person, and says so honestly when it cannot', () => {
    const known = render(<PersonCell person={{ id: 'a', name: 'Ada Lovelace', email: 'ada@acme.test' }} detail />);
    expect(known.container.textContent).toContain('Ada Lovelace');
    const unknown = render(<PersonCell person="c0000000-0000-4000-8000-000000000003" />);
    expect(unknown.container.textContent).toContain('Unknown person');
    expect(unknown.container.textContent).toContain('c0000000');
    expect(unknown.container.querySelector('button')?.getAttribute('aria-label')).toBe('Copy the person’s id');
    const nobody = render(<PersonCell person={null} empty="Unassigned" />);
    expect(nobody.container.textContent).toBe('Unassigned');
  });
});

describe('drawers in the URL', () => {
  it('reads and writes ?open=<kind>:<key>, keeping every other parameter', () => {
    expect(parseDrawer('rule:vip-requester')).toEqual({ kind: 'rule', key: 'vip-requester' });
    expect(parseDrawer('run:a:b')).toEqual({ kind: 'run', key: 'a:b' });
    expect(parseDrawer('rule:')).toBeNull();
    expect(parseDrawer(null)).toBeNull();
    expect(drawerHref('/rules', 'status=draft', 'rule', 'vip')).toBe('/rules?status=draft&open=rule%3Avip');
    expect(drawerHref('/rules', 'status=draft&open=rule%3Avip', 'rule', null)).toBe('/rules?status=draft');
    expect(drawerHref('/rules', '', 'rule', null)).toBe('/rules');
  });
});

describe('lifecycle words', () => {
  it('names each state in words with a tone and an icon', () => {
    expect(lifecycle('published')).toEqual({ label: 'Live', tone: 'success', icon: 'circle-check' });
    expect(lifecycle('archived').label).toBe('Retired');
    expect(lifecycle('waiting')).toMatchObject({ label: 'Waiting', tone: 'hold' });
    expect(lifecycle('pending_third_party')).toMatchObject({ label: 'Pending third party', tone: 'neutral' });
    expect(lifecycle(null).label).toBe('Unknown');
    expect(publishState('published', true).label).toBe('Unpublished changes');
    expect(publishState('draft', true).label).toBe('Draft');
  });
});

describe('the front door', () => {
  const matcher = new RegExp(`^${config.matcher[0]!}$`);

  it('sends a request with no session to sign in, carrying the deep link', () => {
    const response = proxy(new NextRequest('https://admin.acme.test/rules?open=rule:vip'));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get('location')!);
    expect(location.pathname).toBe('/api/session/login');
    expect(location.searchParams.get('redirectTo')).toBe('/rules?open=rule:vip');
  });

  it('passes a request with a session through, with the path for the layout', () => {
    const request = new NextRequest('https://admin.acme.test/sla/calendars?x=1', {
      headers: { cookie: '__Host-session=abc', 'x-itsm-path': '//evil.example' },
    });
    const response = proxy(request);
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-request-x-itsm-path')).toBe('/sla/calendars?x=1');
  });

  it('leaves the API, Next’s files, the stylesheet and the signed-out pages alone', () => {
    for (const path of ['/api/proxy/api/v1/me', '/_next/static/x.js', '/itsm-ui.css', '/sign-in', '/signed-out', '/icon.svg']) {
      expect(matcher.test(path), path).toBe(false);
    }
    for (const path of ['/', '/rules', '/tenants', '/queues']) expect(matcher.test(path), path).toBe(true);
  });
});
