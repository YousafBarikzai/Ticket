import { describe, expect, it, vi } from 'vitest';
import type { Suggestion } from '@itsm/sdk';
import { evidenceFor, hrefForEvidence, renderSuggestion } from '../ai/render.js';
import { devSignIn, DevSignInFailed } from '../bff/dev-sign-in.js';
import type { BffConfig } from '../bff/config.js';

describe('rendering what each capability produced', () => {
  it('splits a reply draft into paragraphs and offers it to the composer', () => {
    const rendered = renderSuggestion('reply-draft', { text: 'Hello.\n\nTry restarting the client.' });
    expect(rendered.paragraphs).toEqual(['Hello.', 'Try restarting the client.']);
    expect(rendered.forComposer).toBe('Hello.\n\nTry restarting the client.');
  });

  it('will not offer a summary as a reply', () => {
    // A handover note is written for a colleague. Putting it one click from
    // the requester's inbox is how it ends up there.
    const rendered = renderSuggestion('ticket-summary', {
      summary: 'VPN failing for one user since Tuesday.',
      nextSteps: ['Check the certificate', 'Ask for the client log'],
    });
    expect(rendered.paragraphs).toEqual([
      'VPN failing for one user since Tuesday.',
      '• Check the certificate',
      '• Ask for the client log',
    ]);
    expect(rendered.forComposer).toBe('');
  });

  it('gives an article draft a heading and a body', () => {
    const rendered = renderSuggestion('article-draft', {
      title: 'Resetting the VPN certificate',
      summary: 'What to do when the client refuses to connect.',
      body: ['Open the client.', 'Choose reset.'],
    });
    expect(rendered.heading).toBe('Resetting the VPN certificate');
    expect(rendered.paragraphs).toEqual(['What to do when the client refuses to connect.', 'Open the client.', 'Choose reset.']);
  });

  it('renders nothing for retrieval, because the evidence is the answer', () => {
    expect(renderSuggestion('similar-work', { items: [{ id: '1' }] })).toEqual({
      paragraphs: [],
      forComposer: '',
      heading: null,
    });
  });

  it('renders nothing rather than JSON for a shape it does not know', () => {
    // A model output that does not parse is a failed job upstream. If one ever
    // arrives here, an agent seeing raw JSON in a reply box is worse than an
    // empty card.
    expect(renderSuggestion('reply-draft', {}).paragraphs).toEqual([]);
    expect(renderSuggestion('reply-draft', { text: 42 }).paragraphs).toEqual([]);
    expect(renderSuggestion('invented-capability', { text: 'hello' }).paragraphs).toEqual([]);
  });

  it('caps a body that arrived longer than the schema allows', () => {
    const body = Array.from({ length: 200 }, (_, index) => `line ${index}`);
    expect(renderSuggestion('article-draft', { title: 't', summary: 's', body }).paragraphs).toHaveLength(41);
  });
});

describe('evidence', () => {
  const suggestion = {
    evidence: [
      { kind: 'ticket', id: 'a', title: 'Similar VPN failure', ref: 'INC-900', extract: '…' },
      { kind: 'article', id: 'b', title: 'VPN troubleshooting', ref: 'KB-12', extract: '…' },
    ],
  } as Suggestion;

  it('links a ticket, because the workbench has a page for one', () => {
    expect(hrefForEvidence(suggestion.evidence[0]!)).toBe('/tickets/INC-900');
  });

  it('leaves an article as text rather than linking to a page that does not exist', () => {
    // A dead link says the reference was checkable when it was not.
    expect(hrefForEvidence(suggestion.evidence[1]!)).toBeUndefined();
  });

  it('copies rather than aliasing, so the card cannot mutate the record', () => {
    const copied = evidenceFor(suggestion);
    expect(copied[0]).not.toBe(suggestion.evidence[0]);
    expect(copied[0]).toEqual(suggestion.evidence[0]);
  });
});

describe('the development sign-in, from the BFF', () => {
  const config = { apiBaseUrl: 'http://api.test' } as BffConfig;

  function respond(status: number, body: unknown): typeof fetch {
    return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
  }

  it('returns the token set the API minted', async () => {
    const tokens = await devSignIn(
      config,
      { tenantSlug: 'acme', email: 'agent@acme.test' },
      respond(201, { accessToken: 'at', expiresInSeconds: 3600, tenantId: 't', userId: 'u', displayName: 'Agent' }),
    );
    expect(tokens).toEqual({ accessToken: 'at', expiresInSeconds: 3600, tenantId: 't', userId: 'u', displayName: 'Agent' });
  });

  it('says plainly when the API has no development sign-in at all', async () => {
    await expect(devSignIn(config, { tenantSlug: 'a', email: 'b@c.test' }, respond(404, {}))).rejects.toThrow(
      /no development sign-in/,
    );
  });

  it('gives one message for an unknown tenant and an unknown user', async () => {
    await expect(devSignIn(config, { tenantSlug: 'a', email: 'b@c.test' }, respond(401, {}))).rejects.toBeInstanceOf(
      DevSignInFailed,
    );
  });

  it('refuses a response with no tenant rather than storing an unusable session', async () => {
    await expect(
      devSignIn(config, { tenantSlug: 'a', email: 'b@c.test' }, respond(201, { accessToken: 'at' })),
    ).rejects.toThrow(/unusable token/);
  });
});
