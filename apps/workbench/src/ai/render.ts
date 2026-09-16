import type { Suggestion, SuggestionEvidence } from '@itsm/sdk';

/**
 * Turning a suggestion's payload into something readable.
 *
 * Each capability answers in its own shape (MOD-09's output schemas), and a
 * component that reached into `content.text` for one and `content.summary` for
 * another would be four components in a trench coat. This is the one place
 * that knows the four shapes, and it is a pure function, so the test is a
 * table rather than a render.
 *
 * Unknown shapes are rendered as nothing rather than as JSON. A model output
 * that does not parse is a failed job upstream; if one ever reaches here, an
 * agent seeing `{"text":...}` in a reply box is worse than seeing an empty
 * card that says the answer could not be read.
 */

export interface RenderedSuggestion {
  /** Paragraphs, in order. */
  readonly paragraphs: readonly string[];
  /** What "Use it" puts in the composer. Empty where there is nothing to copy. */
  readonly forComposer: string;
  /** A heading the card shows, where the capability produces one. */
  readonly heading: string | null;
}

const EMPTY: RenderedSuggestion = { paragraphs: [], forComposer: '', heading: null };

function strings(value: unknown, limit = 50): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0).slice(0, limit);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function renderSuggestion(capability: string, content: Record<string, unknown>): RenderedSuggestion {
  switch (capability) {
    case 'reply-draft': {
      const body = text(content.text);
      return body ? { paragraphs: body.split(/\n{2,}/), forComposer: body, heading: null } : EMPTY;
    }
    case 'ticket-summary': {
      const summary = text(content.summary);
      const steps = strings(content.nextSteps, 10);
      if (!summary) return EMPTY;
      return {
        paragraphs: [summary, ...steps.map((step) => `• ${step}`)],
        // A summary is for reading, not for sending to a requester. Offering
        // it as a reply is how a handover note ends up in somebody's inbox.
        forComposer: '',
        heading: null,
      };
    }
    case 'article-draft': {
      const title = text(content.title);
      const summary = text(content.summary);
      const body = strings(content.body, 40);
      if (!title && !summary && body.length === 0) return EMPTY;
      return {
        paragraphs: [summary, ...body].filter(Boolean),
        forComposer: '',
        heading: title || null,
      };
    }
    case 'similar-work':
      // Everything it found is already evidence; there is no prose to show,
      // and inventing some would be the one thing this capability avoids.
      return { paragraphs: [], forComposer: '', heading: null };
    default:
      return EMPTY;
  }
}

/** The card's evidence list, from the suggestion's own, with links where the workbench has a page. */
export function evidenceFor(suggestion: Suggestion): SuggestionEvidence[] {
  return suggestion.evidence.map((item) => ({ ...item }));
}

export function hrefForEvidence(item: SuggestionEvidence): string | undefined {
  // Only tickets have a page in the workbench today. An article link would go
  // to a knowledge screen that does not exist yet, and a dead link is worse
  // than plain text: it says the reference was checkable when it was not.
  return item.kind === 'ticket' ? `/tickets/${encodeURIComponent(item.ref)}` : undefined;
}
