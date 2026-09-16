import { describe, expect, it } from 'vitest';
import { UnparseableCompletion, approximateTokens, bandOf, parseCompletion } from '../domain/output.js';

/**
 * Turning what a model said into something the platform will store.
 *
 * The important assertions here are the refusals. A parser that salvages what
 * it can produces a suggestion that looks complete and is not — a summary whose
 * next steps quietly vanished, or a reply that stops mid-sentence — and an
 * agent has no way to tell. Failing is cheap; a suggestion that is subtly
 * wrong is not.
 */
describe('parsing a completion', () => {
  const reply = { text: 'Hello, we have looked into it.', reason: 'Drafted from the ticket.', confidence: 0.9 };

  it('reads the capability’s own shape', () => {
    const parsed = parseCompletion('reply-draft', JSON.stringify(reply));
    expect(parsed.content).toEqual({ text: reply.text });
    expect(parsed.reason).toBe(reply.reason);
    expect(parsed.confidence).toBe('high');
  });

  it('tolerates the fenced code block every model produces sometimes', () => {
    const fenced = '```json\n' + JSON.stringify(reply) + '\n```';
    expect(parseCompletion('reply-draft', fenced).content).toEqual({ text: reply.text });
  });

  it('refuses something that is not JSON at all', () => {
    expect(() => parseCompletion('reply-draft', 'Sure! Here is a reply for you.')).toThrow(UnparseableCompletion);
  });

  it('refuses an answer missing the field the capability is for, and names it', () => {
    const missing = JSON.stringify({ reason: 'Drafted.', confidence: 0.9 });
    expect(() => parseCompletion('reply-draft', missing)).toThrow(/text/);
  });

  it('refuses a confidence outside nought to one rather than clamping it', () => {
    const wild = JSON.stringify({ ...reply, confidence: 12 });
    expect(() => parseCompletion('reply-draft', wild)).toThrow(UnparseableCompletion);
  });

  it('defaults a summary’s next steps to an empty list rather than refusing', () => {
    const summary = JSON.stringify({ summary: 'It is a printer.', reason: 'From the thread.', confidence: 0.6 });
    expect(parseCompletion('ticket-summary', summary).content).toEqual({ summary: 'It is a printer.', nextSteps: [] });
  });

  it('requires an article to have a body, because a title is not an article', () => {
    const empty = JSON.stringify({ title: 'A title', summary: 'A summary', body: [], reason: 'x', confidence: 0.9 });
    expect(() => parseCompletion('article-draft', empty)).toThrow(UnparseableCompletion);
  });
});

describe('confidence', () => {
  it('is three words, not a figure nobody calibrated', () => {
    expect(bandOf(0)).toBe('low');
    expect(bandOf(0.49)).toBe('low');
    expect(bandOf(0.5)).toBe('medium');
    expect(bandOf(0.79)).toBe('medium');
    expect(bandOf(0.8)).toBe('high');
    expect(bandOf(1)).toBe('high');
  });
});

describe('estimating tokens', () => {
  it('is never nought, so a cost is never silently free', () => {
    expect(approximateTokens('')).toBe(1);
    expect(approximateTokens('a'.repeat(400))).toBe(100);
  });
});
