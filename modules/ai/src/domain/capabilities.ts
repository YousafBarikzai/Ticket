/**
 * What the AI service can be asked for, and what each request is made of.
 *
 * A closed catalogue, for the same reason the workflow engine has a closed set
 * of node types (ADR-0009): a capability is not just a prompt. It is a prompt
 * *and* the evidence that may be gathered for it, *and* the shape its answer
 * has to parse into, *and* the switch that turns it off, *and* the threshold
 * its prompt must evaluate above. Adding one is a deliberate edit here, where
 * all five are visible together, rather than a row somebody inserted.
 */

export const CAPABILITIES = ['reply-draft', 'ticket-summary', 'article-draft', 'similar-work'] as const;
export type Capability = (typeof CAPABILITIES)[number];

export function isCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value);
}

/** What a capability may retrieve before its prompt is rendered. */
export type EvidenceKind = 'article' | 'ticket' | 'known-error';

export interface Evidence {
  kind: EvidenceKind;
  id: string;
  title: string;
  /** How a person opens it: an article key or a ticket number. */
  ref: string;
  /** The part that was actually put in front of the model. */
  extract: string;
}

export interface CapabilityDefinition {
  key: Capability;
  name: string;
  description: string;
  /** The prompt this capability renders, or null when it calls no model. */
  promptKey: string | null;
  /** What the retriever gathers. Order is the order it is offered in. */
  retrieves: EvidenceKind[];
  /** How many pieces of evidence, at most. A prompt is not a filing cabinet. */
  evidenceLimit: number;
  /** Whether an answer with no evidence at all is allowed to be produced. */
  evidenceRequired: boolean;
  flagKey: string;
  /** The evaluation dataset its prompt is judged against. */
  datasetKey: string | null;
}

export const CAPABILITY_CATALOGUE: Record<Capability, CapabilityDefinition> = {
  'reply-draft': {
    key: 'reply-draft',
    name: 'Draft a reply',
    description: 'A reply to the requester, grounded in the ticket and the knowledge base, for an agent to edit and send.',
    promptKey: 'reply-draft',
    retrieves: ['article', 'ticket'],
    evidenceLimit: 6,
    // A reply invented from nothing is the failure mode this whole module
    // exists to avoid: it reads as confident and cites the organisation.
    evidenceRequired: true,
    flagKey: 'ai.capability.reply-draft',
    datasetKey: 'reply-draft',
  },
  'ticket-summary': {
    key: 'ticket-summary',
    name: 'Summarise the ticket',
    description: 'A long thread condensed for a handover, an escalation or a major incident.',
    promptKey: 'ticket-summary',
    // The ticket is the evidence. Retrieving more would summarise other
    // people's tickets into this one.
    retrieves: [],
    evidenceLimit: 0,
    evidenceRequired: false,
    flagKey: 'ai.capability.ticket-summary',
    datasetKey: 'ticket-summary',
  },
  'article-draft': {
    key: 'article-draft',
    name: 'Draft an article',
    description: 'A knowledge article drafted from a resolved ticket, for review before publication.',
    promptKey: 'article-draft',
    retrieves: ['article'],
    evidenceLimit: 4,
    evidenceRequired: false,
    flagKey: 'ai.capability.article-draft',
    datasetKey: 'article-draft',
  },
  'similar-work': {
    key: 'similar-work',
    name: 'Find similar work',
    description: 'Tickets and known errors that look like this one. Retrieval only: no model is called.',
    // No prompt, so no completion, no tokens and no cost. Worth saying out
    // loud: the cheapest useful AI feature in the product is the one that is
    // not AI at all, and a budget that has run out does not take it away.
    promptKey: null,
    retrieves: ['ticket', 'known-error'],
    evidenceLimit: 8,
    evidenceRequired: false,
    flagKey: 'ai.capability.similar-work',
    datasetKey: null,
  },
};

export function definitionFor(capability: Capability): CapabilityDefinition {
  return CAPABILITY_CATALOGUE[capability];
}

/** Capabilities that call a provider, and therefore cost money. */
export function callsAModel(capability: Capability): boolean {
  return CAPABILITY_CATALOGUE[capability].promptKey !== null;
}

/**
 * The context a prompt is rendered against.
 *
 * Assembled under the requesting actor's permissions and passed through the
 * classification registry before it gets here (doc 13 §1): by the time a
 * value is in this object it is already something that person may read.
 */
export interface AssembledContext {
  ticket: Record<string, unknown>;
  requester: Record<string, unknown>;
  /** The conversation, oldest first, already filtered to what the actor sees. */
  comments: { author: string; internal: boolean; body: string; at: string }[];
  evidence: Evidence[];
  /** The tenant's own two dials. */
  tone: string;
  language: string;
}
