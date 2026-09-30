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
  /** What "Insert into reply" puts in the composer. Empty where there is nothing to send a requester. */
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

/**
 * What "Add as internal note" puts in the note: a summary and its next steps,
 * for colleagues. Only a summary has one — a reply draft goes to the reply,
 * and an article draft is copied, not posted on a ticket.
 */
export function noteFor(capability: string, content: Record<string, unknown>): string {
  if (capability !== 'ticket-summary') return '';
  const summary = text(content.summary);
  if (!summary) return '';
  const steps = strings(content.nextSteps, 10);
  return steps.length > 0 ? `${summary}\n\nNext steps:\n${steps.map((step) => `- ${step}`).join('\n')}` : summary;
}

/** An article draft as plain text for the clipboard: title, summary, then each paragraph. */
export function copyTextFor(capability: string, content: Record<string, unknown>): string {
  if (capability !== 'article-draft') return '';
  const title = text(content.title);
  const summary = text(content.summary);
  const body = strings(content.body, 40);
  return [title, summary, ...body].filter(Boolean).join('\n\n');
}

/** The card's heading when the capability produces none of its own. */
export function titleFor(capability: string): string {
  switch (capability) {
    case 'reply-draft':
      return 'Suggested reply';
    case 'ticket-summary':
      return 'Summary';
    case 'article-draft':
      return 'Suggested article';
    case 'similar-work':
      return 'Similar work';
    default:
      return 'Suggestion';
  }
}

/** The card's evidence list, from the suggestion's own, with links where the workbench has a page. */
export function evidenceFor(suggestion: Suggestion): SuggestionEvidence[] {
  return suggestion.evidence.map((item) => ({ ...item }));
}

/** The query parameter a drawer lives in, and the kind that names an article (SPEC §4.10: `?open=article:<key>`). */
export const OPEN_PARAM = 'open';
export const ARTICLE_KIND = 'article';

/** Where the evidence was listed: its URL, so an article opens over it rather than replacing it. */
export interface Here {
  readonly pathname: string;
  /** The query string without its `?`. */
  readonly search: string;
}

/** The same page with the article sheet open on `key`, every other parameter (the open ticket, the filters) kept. */
export function articleHref(key: string, here: Here = { pathname: '', search: '' }): string {
  const params = new URLSearchParams(here.search);
  params.delete(OPEN_PARAM);
  const rest = params.toString();
  // Written out rather than through `URLSearchParams`, which would spell the colon `%3A`: the
  // link reads `?open=article:vpn-reset` wherever it is pasted, as every drawer's does.
  return `${here.pathname}?${rest ? `${rest}&` : ''}${OPEN_PARAM}=${ARTICLE_KIND}:${encodeURIComponent(key)}`;
}

/**
 * Where a piece of evidence opens. A ticket has its own page; an article
 * opens in the read-only article sheet over the page the person is on. A
 * known error has nowhere to go in the workbench, and a dead link is worse
 * than plain text: it says the reference was checkable when it was not.
 */
export function hrefForEvidence(item: SuggestionEvidence, here?: Here): string | undefined {
  if (item.kind === 'ticket') return `/tickets/${encodeURIComponent(item.ref)}`;
  if (item.kind === 'article') return articleHref(item.ref, here);
  return undefined;
}

/** The article an href opens in the sheet, or `null` for any other link. */
export function articleKeyOf(href: string): string | null {
  const at = href.indexOf('?');
  if (at < 0) return null;
  const value = new URLSearchParams(href.slice(at + 1)).get(OPEN_PARAM);
  if (!value?.startsWith(`${ARTICLE_KIND}:`)) return null;
  const key = value.slice(ARTICLE_KIND.length + 1);
  return key || null;
}

/** The ticket number an href opens, for opening it in the pane instead; `null` for any other link. */
export function ticketNumberOf(href: string): string | null {
  const match = /^\/tickets\/([^/?#]+)$/.exec(href);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return null;
  }
}
