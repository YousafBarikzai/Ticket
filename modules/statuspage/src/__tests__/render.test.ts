import { describe, expect, it } from 'vitest';
import { renderNotice, renderStatusPage } from '../service/page-render.js';
import type { PublicStatus } from '../service/public-service.js';

function status(overrides: Partial<PublicStatus> = {}): PublicStatus {
  return {
    page: { slug: 'acme', name: 'Acme', description: null, supportUrl: null, path: '/status/acme' },
    overall: 'operational',
    components: [{ key: 'email', name: 'Email', description: null, group: null, status: 'operational' }],
    incidents: [],
    maintenance: [],
    generatedAt: '2026-09-15T10:00:00.000Z',
    ...overrides,
  };
}

describe('the page as HTML', () => {
  it('escapes everything that came from the database', () => {
    // The title of an incident is typed by an operator and the body of an
    // update comes from the incident bridge; neither is trusted to be markup.
    const html = renderStatusPage(
      status({
        page: { slug: 'acme', name: '<script>alert(1)</script>', description: 'a "quoted" & <b>bold</b> claim', supportUrl: 'https://help.example/?a=1&b=2', path: '/status/acme' },
        overall: 'degraded',
        incidents: [
          {
            id: 'i1',
            title: '<img src=x onerror=alert(1)>',
            impact: 'minor',
            status: 'investigating',
            startedAt: '2026-09-15T09:00:00.000Z',
            resolvedAt: null,
            components: ['email'],
            updates: [{ status: 'investigating', body: "it's </div> broken", postedAt: '2026-09-15T09:00:00.000Z' }],
          },
        ],
      }),
    );
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('</div> broken');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('it&#39;s &lt;/div&gt; broken');
    expect(html).toContain('a &quot;quoted&quot; &amp; &lt;b&gt;bold&lt;/b&gt; claim');
    expect(html).toContain('href="https://help.example/?a=1&amp;b=2"');
  });

  it('says the headline for the worst component and lists each one with its state', () => {
    const html = renderStatusPage(
      status({
        overall: 'partial_outage',
        components: [
          { key: 'email', name: 'Email', description: null, group: 'Collaboration', status: 'partial_outage' },
          { key: 'vpn', name: 'VPN', description: 'Remote access', group: 'Network', status: 'operational' },
        ],
      }),
    );
    expect(html).toContain('Some systems are experiencing an outage');
    expect(html).toContain('Collaboration');
    expect(html).toContain('Partial outage');
    expect(html).toContain('Remote access');
    expect(html).toContain('Operational');
  });

  it('posts the subscribe form back to the page itself', () => {
    const html = renderStatusPage(status());
    expect(html).toContain('action="/status/acme/subscribe"');
    expect(html).toContain('type="email"');
  });

  it('separates what is happening from what is over', () => {
    const html = renderStatusPage(
      status({
        incidents: [
          { id: 'a', title: 'Still going', impact: 'major', status: 'monitoring', startedAt: '2026-09-15T08:00:00.000Z', resolvedAt: null, components: [], updates: [] },
          { id: 'b', title: 'Over now', impact: 'minor', status: 'resolved', startedAt: '2026-09-14T08:00:00.000Z', resolvedAt: '2026-09-14T09:00:00.000Z', components: [], updates: [] },
        ],
      }),
    );
    const active = html.indexOf('Active incidents');
    const recent = html.indexOf('Recently resolved');
    expect(html.indexOf('Still going')).toBeGreaterThan(active);
    expect(html.indexOf('Still going')).toBeLessThan(recent);
    expect(html.indexOf('Over now')).toBeGreaterThan(recent);
  });

  it('renders a notice with an escaped way back', () => {
    const html = renderNotice('Subscribed', 'You will be told.', '/status/acme"><script>');
    expect(html).toContain('You will be told.');
    expect(html).toContain('href="/status/acme&quot;&gt;&lt;script&gt;"');
  });
});
