import { describe, expect, it } from 'vitest';
import { httpConfigSchema, mapResponse, transformConfigSchema } from '../service/action-service.js';

/**
 * Response mapping is what makes an action's result usable by the step after
 * it, so getting "the path found nothing" wrong is how a workflow carries an
 * `undefined` into an email somebody reads.
 */

describe('mapping a response into the run context', () => {
  const response = {
    status: 201,
    headers: { location: 'https://api.test/users/42', 'content-type': 'application/json' },
    body: { data: { id: '42', profile: { email: 'ada@acme.test' } }, warnings: ['quota low'] },
  };

  it('reads nested values by dotted path', () => {
    expect(
      mapResponse({ accountId: 'body.data.id', email: 'body.data.profile.email', code: 'status' }, response),
    ).toEqual({ accountId: '42', email: 'ada@acme.test', code: 201 });
  });

  it('reads a header, which is where some APIs put the thing you need', () => {
    expect(mapResponse({ created: 'headers.location' }, response)).toEqual({
      created: 'https://api.test/users/42',
    });
  });

  it('maps a path that finds nothing to null rather than omitting it', () => {
    // So a later condition can tell "the endpoint did not return it" from
    // "nobody asked for it". Omitting the key makes those indistinguishable.
    expect(mapResponse({ missing: 'body.data.nope' }, response)).toEqual({ missing: null });
    expect('missing' in mapResponse({ missing: 'body.data.nope' }, response)).toBe(true);
  });

  it('returns an array whole rather than flattening it', () => {
    expect(mapResponse({ warnings: 'body.warnings' }, response)).toEqual({ warnings: ['quota low'] });
  });

  it('maps nothing when nothing is asked for', () => {
    expect(mapResponse({}, response)).toEqual({});
  });
});

describe('the action configuration schema', () => {
  it('accepts an ordinary HTTP action', () => {
    expect(() =>
      httpConfigSchema.parse({
        method: 'POST',
        url: 'https://graph.microsoft.test/v1.0/users',
        headers: { 'content-type': 'application/json' },
        body: { displayName: '{{input.name}}' },
      }),
    ).not.toThrow();
  });

  it('refuses a field it does not know, rather than ignoring it', () => {
    // A typo in an action's config that is silently dropped is a call that
    // does not do what the author wrote.
    expect(() => httpConfigSchema.parse({ url: 'https://api.test', retries: 3 })).toThrow();
  });

  it('refuses something that is not a URL', () => {
    expect(() => httpConfigSchema.parse({ url: 'api.test/users' })).toThrow();
  });

  it('accepts a transform, which does no I/O at all', () => {
    // Reshaping the run context is a legitimate step and should not need a
    // round trip to anywhere.
    expect(() => transformConfigSchema.parse({ map: { id: 'ticket.id' } })).not.toThrow();
  });
});
