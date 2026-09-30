import { describe, expect, it } from 'vitest';
import type { Suggestion } from '@itsm/sdk';
import {
  articleHref,
  articleKeyOf,
  copyTextFor,
  evidenceFor,
  hrefForEvidence,
  noteFor,
  renderSuggestion,
  ticketNumberOf,
  titleFor,
} from '../ai/render.js';

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

  it('opens an article in the article sheet over the page (SPEC §3.8: ?open=article:<key>)', () => {
    expect(hrefForEvidence(suggestion.evidence[1]!)).toBe('?open=article:KB-12');
  });

  it('keeps the open ticket and the filters when it opens an article, replacing any other drawer', () => {
    const here = { pathname: '/inbox/mine', search: 't=INC-000123&q=vpn&open=article:KB-1' };
    expect(hrefForEvidence(suggestion.evidence[1]!, here)).toBe('/inbox/mine?t=INC-000123&q=vpn&open=article:KB-12');
    expect(articleHref('reset the vpn', { pathname: '/tickets/INC-1', search: '' })).toBe('/tickets/INC-1?open=article:reset%20the%20vpn');
  });

  it('leaves a known error as text: the workbench has no page for one, and a dead link says it was checkable', () => {
    expect(hrefForEvidence({ kind: 'known-error', id: 'k', title: 'Certificate expiry', ref: 'KE-3', extract: '' })).toBeUndefined();
  });

  it('reads back which article or ticket a link opens, so the panel can open it in place', () => {
    expect(articleKeyOf('/inbox/mine?t=INC-1&open=article:KB-12')).toBe('KB-12');
    expect(articleKeyOf('?open=article%3AKB-12')).toBe('KB-12');
    expect(articleKeyOf('/inbox/mine?open=rule:x')).toBeNull();
    expect(articleKeyOf('/tickets/INC-900')).toBeNull();
    expect(ticketNumberOf('/tickets/INC-900')).toBe('INC-900');
    expect(ticketNumberOf('/tickets/INC-900/edit')).toBeNull();
    expect(ticketNumberOf('?open=article:KB-12')).toBeNull();
  });

  it('copies rather than aliasing, so the card cannot mutate the record', () => {
    const copied = evidenceFor(suggestion);
    expect(copied[0]).not.toBe(suggestion.evidence[0]);
    expect(copied[0]).toEqual(suggestion.evidence[0]);
  });
});

describe('what each card offers', () => {
  it('turns a summary into an internal note, with its next steps as a list', () => {
    expect(noteFor('ticket-summary', { summary: 'VPN failing since Tuesday.', nextSteps: ['Check the certificate'] })).toBe(
      'VPN failing since Tuesday.\n\nNext steps:\n- Check the certificate',
    );
    expect(noteFor('ticket-summary', { summary: 'Just this.' })).toBe('Just this.');
  });

  it('offers nothing to note from a reply draft or an unreadable summary', () => {
    expect(noteFor('reply-draft', { text: 'Hello' })).toBe('');
    expect(noteFor('ticket-summary', { summary: 7 })).toBe('');
  });

  it('copies an article draft as plain text, title first', () => {
    expect(copyTextFor('article-draft', { title: 'Reset', summary: 'When it fails.', body: ['Open it.', 'Reset it.'] })).toBe(
      'Reset\n\nWhen it fails.\n\nOpen it.\n\nReset it.',
    );
    expect(copyTextFor('reply-draft', { text: 'Hello' })).toBe('');
  });

  it('names each card in the desk’s words', () => {
    expect(titleFor('reply-draft')).toBe('Suggested reply');
    expect(titleFor('similar-work')).toBe('Similar work');
    expect(titleFor('something-new')).toBe('Suggestion');
  });
});
