import { describe, expect, it } from 'vitest';
import {
  assertMethodAllowed,
  assertSameOrigin,
  forwardRequestHeaders,
  forwardResponseHeaders,
  ProxyRefused,
  refusalBody,
  targetPathFor,
} from '../proxy.js';

/**
 * The proxy is the browser's whole route to the platform, so these are tests
 * about refusals rather than about happy paths. Each one names a request
 * somebody could actually send.
 */

const ORIGIN = 'https://desk.example.test';

describe('the path the proxy will build', () => {
  it('forwards a versioned API path unchanged', () => {
    expect(targetPathFor(['api', 'v1', 'tickets'])).toBe('/api/v1/tickets');
    expect(targetPathFor(['api', 'v1', 'tickets', 'INC-1042', 'timeline'])).toBe('/api/v1/tickets/INC-1042/timeline');
  });

  it('refuses anything outside /api/v1, whatever else the API serves', () => {
    for (const path of [
      ['metrics'],
      ['scim', 'v2', 'Users'],
      ['api', 'platform', 'v1', 'tenants'],
      ['health', 'ready'],
      ['api', 'v2', 'tickets'],
    ]) {
      expect(() => targetPathFor(path)).toThrow(ProxyRefused);
    }
  });

  it('refuses a traversal, however it is spelled', () => {
    // A catch-all hands over decoded segments, so `%2e%2e` has already become
    // `..` by the time it reaches here.
    expect(() => targetPathFor(['api', 'v1', '..', '..', 'metrics'])).toThrow(/will not forward/);
    expect(() => targetPathFor(['api', 'v1', 'tickets', '..'])).toThrow(/will not forward/);
    expect(() => targetPathFor(['api', 'v1', 'tickets/../../metrics'])).toThrow(/will not forward/);
    expect(() => targetPathFor(['api', 'v1', 'tickets\\..\\..'])).toThrow(/will not forward/);
    expect(() => targetPathFor(['api', 'v1', ''])).toThrow(/will not forward/);
  });

  it('refuses a segment carrying a control character', () => {
    expect(() => targetPathFor(['api', 'v1', 'tickets\nX-Injected: 1'])).toThrow(/will not forward/);
  });

  it('re-encodes a legal segment rather than letting it split the path', () => {
    expect(targetPathFor(['api', 'v1', 'search', 'two words'])).toBe('/api/v1/search/two%20words');
  });

  it('refuses a bare prefix with nothing after it', () => {
    expect(() => targetPathFor(['api', 'v1'])).toThrow(ProxyRefused);
  });
});

describe('the headers the proxy will carry', () => {
  it('drops the browser cookie and any authorization the caller supplied', () => {
    const incoming = new Headers({
      cookie: '__Host-session=abc',
      authorization: 'Bearer forged',
      accept: 'application/json',
      'content-type': 'application/json',
      'if-match': '"7"',
      'idempotency-key': 'k-1',
      'x-forwarded-for': '10.0.0.1',
      host: 'evil.example',
    });

    const out = forwardRequestHeaders(incoming, 'real-token', 'corr-1');

    expect(out.get('cookie')).toBeNull();
    expect(out.get('x-forwarded-for')).toBeNull();
    expect(out.get('host')).toBeNull();
    expect(out.get('authorization')).toBe('Bearer real-token');
    expect(out.get('accept')).toBe('application/json');
    expect(out.get('if-match')).toBe('"7"');
    expect(out.get('idempotency-key')).toBe('k-1');
    expect(out.get('x-correlation-id')).toBe('corr-1');
  });

  it('never lets the API set a cookie on this app’s origin', () => {
    const upstream = new Headers({
      'content-type': 'application/json',
      etag: '"9"',
      'x-correlation-id': 'corr-2',
      'x-ratelimit-remaining': '41',
    });
    upstream.append('set-cookie', '__Host-session=stolen; Path=/; Secure');

    const out = forwardResponseHeaders(upstream);

    expect(out.get('set-cookie')).toBeNull();
    expect(out.get('etag')).toBe('"9"');
    expect(out.get('content-type')).toBe('application/json');
    expect(out.get('x-ratelimit-remaining')).toBe('41');
  });
});

describe('where an unsafe request is allowed to come from', () => {
  it('allows a same-origin write', () => {
    expect(() => assertSameOrigin('POST', new Headers({ 'sec-fetch-site': 'same-origin' }), ORIGIN)).not.toThrow();
    expect(() => assertSameOrigin('POST', new Headers({ origin: ORIGIN }), ORIGIN)).not.toThrow();
  });

  it('refuses a cross-site write even though the cookie is SameSite=Lax', () => {
    expect(() => assertSameOrigin('POST', new Headers({ 'sec-fetch-site': 'cross-site' }), ORIGIN)).toThrow(/did not come from/);
    expect(() => assertSameOrigin('DELETE', new Headers({ origin: 'https://evil.example' }), ORIGIN)).toThrow();
  });

  it('refuses a write that claims no origin at all', () => {
    // Not a browser. A non-browser client should hold its own token and talk
    // to the API, so there is nothing to lose by refusing it here.
    expect(() => assertSameOrigin('POST', new Headers(), ORIGIN)).toThrow();
  });

  it('leaves reads alone', () => {
    expect(() => assertSameOrigin('GET', new Headers({ 'sec-fetch-site': 'cross-site' }), ORIGIN)).not.toThrow();
    expect(() => assertSameOrigin('HEAD', new Headers(), ORIGIN)).not.toThrow();
  });
});

describe('methods and refusals', () => {
  it('proxies the six methods the API uses and nothing else', () => {
    for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(() => assertMethodAllowed(method)).not.toThrow();
    }
    expect(() => assertMethodAllowed('TRACE')).toThrow(/not proxied/);
    expect(() => assertMethodAllowed('OPTIONS')).toThrow(/not proxied/);
  });

  it('refuses in the same shape the API refuses in', () => {
    const body = refusalBody(new ProxyRefused(403, 'nope'), 'corr-3');
    expect(body).toMatchObject({ type: 'about:blank', title: 'Forbidden', status: 403, detail: 'nope', correlationId: 'corr-3' });
  });
});
