/**
 * The prompts this deployment ships.
 *
 * Written here, reviewed and released like any other change, and mirrored into
 * the database at boot — the same bargain as MOD-22's packs and MOD-21's
 * plans. A tenant cannot edit one: a prompt that a tenant could rewrite is a
 * prompt that has not been evaluated, and the release gate depends on the
 * evaluation. What a tenant may change is tone and language, which are
 * settings, and which the templates read.
 *
 * Every template renders a `Title:` line and an `Evidence:` list, in that
 * shape, because the assembled context arrives as paths and the template
 * language has no loops (deliberately — ADR-0021's reasoning: a second
 * half-language inside a string becomes a programming language nobody meant to
 * write). The lists are rendered into strings by the assembler.
 */

export interface ShippedPrompt {
  key: string;
  capability: string;
  name: string;
  description: string;
  systemPrompt: string;
  template: string;
}

const GROUNDING =
  'Answer only from the material you are given. If it does not contain the answer, ' +
  'say what is known and what is still needed; never invent a cause, a name, a ' +
  'reference number or a date. You are drafting for a support agent who will read ' +
  'and edit before anything is sent, so being plainly incomplete is better than ' +
  'being confidently wrong.';

const JSON_ONLY = 'Reply with JSON and nothing else.';

export const SHIPPED_PROMPTS: ShippedPrompt[] = [
  {
    key: 'reply-draft',
    capability: 'reply-draft',
    name: 'Draft a reply',
    description: 'Drafts a reply to the requester from the ticket and the retrieved evidence.',
    systemPrompt: `You draft replies for an IT service desk. ${GROUNDING}`,
    template: [
      'Title: {{ticket.title}}',
      'Type: {{ticket.type}}  Status: {{ticket.status}}  Priority: {{ticket.priority}}',
      'Requester: {{requester.displayName}}',
      '',
      'Description:',
      '{{ticket.description}}',
      '',
      'Conversation:',
      '{{conversation}}',
      '',
      'Evidence:',
      '{{evidenceList}}',
      '',
      'Write a reply to the requester in {{language}}, in a {{tone}} tone.',
      'Address what they actually asked. Do not restate the whole ticket back to them.',
      `${JSON_ONLY} { "text": string, "reason": string, "confidence": number between 0 and 1 }`,
    ].join('\n'),
  },
  {
    key: 'ticket-summary',
    capability: 'ticket-summary',
    name: 'Summarise the ticket',
    description: 'Condenses a ticket and its conversation for a handover or an escalation.',
    systemPrompt: `You summarise IT service desk tickets for the person picking one up. ${GROUNDING}`,
    template: [
      'Title: {{ticket.title}}',
      'Type: {{ticket.type}}  Status: {{ticket.status}}  Priority: {{ticket.priority}}  Opened: {{ticket.createdAt}}',
      'Requester: {{requester.displayName}}',
      '',
      'Description:',
      '{{ticket.description}}',
      '',
      'Conversation:',
      '{{conversation}}',
      '',
      'Summarise this in {{language}} for somebody taking it over: what was reported,',
      'what has been tried, and where it stands now. Then list what should happen next.',
      `${JSON_ONLY} { "summary": string, "nextSteps": string[], "reason": string, "confidence": number between 0 and 1 }`,
    ].join('\n'),
  },
  {
    key: 'article-draft',
    capability: 'article-draft',
    name: 'Draft an article',
    description: 'Drafts a knowledge article from a resolved ticket, for review before publication.',
    systemPrompt: `You turn resolved IT service desk tickets into knowledge articles. ${GROUNDING}`,
    template: [
      'Title: {{ticket.title}}',
      'Type: {{ticket.type}}  Status: {{ticket.status}}  Priority: {{ticket.priority}}',
      '',
      'Description:',
      '{{ticket.description}}',
      '',
      'Conversation:',
      '{{conversation}}',
      '',
      'Existing articles on this subject:',
      '{{evidenceList}}',
      '',
      'Draft an article in {{language}} that would let the next person resolve this',
      'without opening a ticket. Write for the person with the problem, not for the',
      'person who fixed it. If an existing article above already covers this, say so',
      'in the reason and draft an improvement to it rather than a duplicate.',
      `${JSON_ONLY} { "title": string, "summary": string, "body": string[], "reason": string, "confidence": number between 0 and 1 }`,
    ].join('\n'),
  },
];

/**
 * The evaluation datasets the shipped prompts are judged against.
 *
 * A case is a context and a set of expectations, not a golden answer: two good
 * replies to the same ticket differ, and pinning one of them would score
 * fluency rather than usefulness. What is checked is that the answer parses,
 * mentions what it must, avoids what it must not, and stays within length.
 */
export interface ShippedCase {
  key: string;
  context: Record<string, unknown>;
  expect: { mustMention?: string[]; mustNotMention?: string[]; maxWords?: number };
}

export interface ShippedDataset {
  key: string;
  capability: string;
  name: string;
  threshold: number;
  cases: ShippedCase[];
}

function ticketContext(title: string, description: string, evidence: string[]): Record<string, unknown> {
  return {
    ticket: { title, description, type: 'incident', status: 'in_progress', priority: 'P3', createdAt: '2026-09-01T09:00:00Z' },
    requester: { displayName: 'Ada Requester' },
    conversation: '- Ada Requester: ' + description,
    evidenceList: evidence.length > 0 ? evidence.map((line) => `- ${line}`).join('\n') : '- (nothing found)',
    tone: 'plain',
    language: 'English',
  };
}

export const SHIPPED_DATASETS: ShippedDataset[] = [
  {
    key: 'reply-draft',
    capability: 'reply-draft',
    name: 'Reply drafting',
    threshold: 0.8,
    cases: [
      {
        key: 'grounded',
        context: ticketContext(
          'Cannot sign in to the expenses system',
          'I get "account locked" every time I try to sign in to expenses.',
          ['Unlocking an expenses account (KB-0012)'],
        ),
        // The subject has to survive into the reply, and the draft must not
        // promise a timescale nobody agreed to — the most common way a
        // generated reply creates work rather than saving it.
        expect: { mustMention: ['expenses'], mustNotMention: ['within 24 hours', 'guarantee'], maxWords: 400 },
      },
      {
        key: 'ungrounded',
        context: ticketContext('Printer on floor 3 is jamming', 'The big printer by the kitchen keeps jamming.', []),
        expect: { mustMention: ['printer'], maxWords: 400 },
      },
    ],
  },
  {
    key: 'ticket-summary',
    capability: 'ticket-summary',
    name: 'Ticket summarising',
    threshold: 0.8,
    cases: [
      {
        key: 'handover',
        context: ticketContext('Laptop will not charge', 'It stopped charging on Friday. Tried a second cable.', []),
        expect: { mustMention: ['charg'], maxWords: 300 },
      },
    ],
  },
  {
    key: 'article-draft',
    capability: 'article-draft',
    name: 'Article drafting',
    threshold: 0.8,
    cases: [
      {
        key: 'from-resolution',
        context: ticketContext(
          'VPN disconnects every few minutes',
          'The VPN drops about every five minutes. Reinstalling the client fixed it.',
          ['Installing the VPN client (KB-0003)'],
        ),
        expect: { mustMention: ['VPN'], maxWords: 800 },
      },
    ],
  },
];
