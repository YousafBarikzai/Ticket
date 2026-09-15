import { describe, expect, it } from 'vitest';
import { redactBody, redactHeaders, redactUrl } from '../gateway/redact.js';

/**
 * The integration log is read by support, exported with configuration, and kept
 * for as long as retention says. Anything these miss lives there for months.
 */

describe('redacting headers', () => {
  it('removes the ones that carry credentials', () => {
    expect(
      redactHeaders({
        authorization: 'Bearer sk_live_notarealkey',
        cookie: 'session=abc',
        'x-api-key': 'k',
        'content-type': 'application/json',
      }),
    ).toEqual({
      authorization: '[redacted]',
      cookie: '[redacted]',
      'x-api-key': '[redacted]',
      'content-type': 'application/json',
    });
  });

  it('matches regardless of case and of a vendor prefix', () => {
    // Vendors prefix their headers. A rule that only knows the unprefixed
    // spelling works until the first real integration.
    expect(
      redactHeaders({
        Authorization: 'x',
        'X-Acme-Api-Key': 'y',
        'X-Shopify-Access-Token': 'z',
        apiKey: 'q',
      }),
    ).toEqual({
      Authorization: '[redacted]',
      'X-Acme-Api-Key': '[redacted]',
      'X-Shopify-Access-Token': '[redacted]',
      apiKey: '[redacted]',
    });
  });

  it('keeps the idempotency key, which is not a secret and is what you need', () => {
    // And keeps fields legitimately called `key`. Phase 2 learned this from the
    // secret scanner: this platform is full of rule keys, template keys and
    // workflow keys, and redacting them protects nothing while making the log
    // useless.
    expect(redactHeaders({ 'idempotency-key': 'run-1-step-2', 'x-request-id': 'abc' })).toEqual({
      'idempotency-key': 'run-1-step-2',
      'x-request-id': 'abc',
    });
    expect(redactBody({ key: 'major-incident-p1', ruleKey: 'vip-escalation' })).toEqual({
      key: 'major-incident-p1',
      ruleKey: 'vip-escalation',
    });
  });
});

describe('redacting a body', () => {
  it('removes secrets by key name, at any depth', () => {
    // By key rather than by value: no value-based rule can tell a token from
    // any other opaque string, and one that guesses either misses tokens or
    // destroys the log.
    expect(
      redactBody({ user: 'ada', auth: { client_secret: 'shh', scope: 'read' }, items: [{ access_token: 't' }] }),
    ).toEqual({
      user: 'ada',
      auth: { client_secret: '[redacted]', scope: 'read' },
      items: [{ access_token: '[redacted]' }],
    });
  });

  it('truncates a long string rather than storing all of it', () => {
    const long = 'x'.repeat(20_000);
    const result = redactBody(long) as string;
    expect(result.length).toBeLessThan(9_000);
    expect(result).toMatch(/truncated/);
  });

  it('stops descending rather than following a deep structure for ever', () => {
    let deep: unknown = 'bottom';
    for (let i = 0; i < 20; i += 1) deep = { nested: deep };
    expect(JSON.stringify(redactBody(deep))).toContain('too deep');
  });

  it('caps a long array', () => {
    expect((redactBody(Array.from({ length: 500 }, (_, i) => i)) as unknown[]).length).toBe(50);
  });
});

describe('redacting a URL', () => {
  it('removes a token from the query string', () => {
    // Webhook URLs carry secrets as query parameters — including the Postmark
    // pattern this platform already supports — so a logged URL is a logged
    // secret unless something strips it.
    expect(redactUrl('https://hooks.test/in?token=abc&id=7')).toBe('https://hooks.test/in?token=%5Bredacted%5D&id=7');
  });

  it('removes credentials from the userinfo', () => {
    expect(redactUrl('https://user:pass@hooks.test/in')).toBe('https://hooks.test/in');
  });

  it('does not throw on something that is not a URL', () => {
    expect(redactUrl('nonsense')).toBe('[unparseable url]');
  });
});
