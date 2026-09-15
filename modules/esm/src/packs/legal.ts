import type { Pack } from '../domain/pack.js';

/**
 * Legal: contract reviews, NDAs and policy questions.
 *
 * The smallest pack, and deliberately so. A legal desk is mostly an approval
 * chain over a form, and the approval chain is the tenant's — so what ships
 * here is the intake: the questions that stop a review starting three days
 * late because nobody asked which jurisdiction it was in.
 */
export const legalPack: Pack = {
  key: 'legal',
  name: 'Legal services',
  version: 1,
  desk: 'Legal',
  description:
    'Contract reviews, NDAs and policy questions, with the intake questions that let a review start on the day it arrives.',
  nextSteps: [
    'Assign the Legal team as the fulfilment group for the Legal services service.',
    'Add an approval policy if contract reviews need a partner or a director to sign off.',
    'Restrict the contract review request to the people who negotiate, if it should not be open to everybody.',
  ],
  services: [
    {
      key: 'legal',
      name: 'Legal services',
      description: 'Contract reviews, agreements and questions about what we are allowed to do.',
    },
  ],
  forms: [
    {
      key: 'legal-contract-review',
      name: 'Contract review',
      description: 'A contract somebody wants read before it is signed.',
      document: {
        key: 'legal-contract-review',
        title: 'Ask for a contract review',
        schema: {
          type: 'object',
          properties: {
            counterparty: { type: 'string', title: 'Who is it with', minLength: 2, maxLength: 160 },
            contractType: {
              type: 'string',
              title: 'What kind of contract',
              enum: ['customer', 'supplier', 'partnership', 'employment', 'lease', 'other'],
            },
            value: { type: 'number', title: 'Contract value', minimum: 0, maximum: 100000000 },
            jurisdiction: { type: 'string', title: 'Governing law', maxLength: 80 },
            theirPaper: { type: 'boolean', title: 'Is it on their paper' },
            personalData: { type: 'boolean', title: 'Does it involve personal data' },
            signBy: { type: 'string', title: 'Needs signing by', format: 'date' },
            summary: { type: 'string', title: 'What is the deal', minLength: 20, maxLength: 4000 },
          },
          required: ['counterparty', 'contractType', 'jurisdiction', 'summary'],
        },
        ui: {
          elements: [
            { kind: 'field', field: 'counterparty', control: 'text', label: 'Who is it with' },
            {
              kind: 'field',
              field: 'contractType',
              control: 'select',
              label: 'What kind of contract',
              options: [
                { value: 'customer', label: 'Customer agreement' },
                { value: 'supplier', label: 'Supplier agreement' },
                { value: 'partnership', label: 'Partnership' },
                { value: 'employment', label: 'Employment' },
                { value: 'lease', label: 'Lease or property' },
                { value: 'other', label: 'Something else' },
              ],
            },
            { kind: 'field', field: 'value', control: 'number', label: 'Contract value' },
            { kind: 'field', field: 'jurisdiction', control: 'text', label: 'Governing law', placeholder: 'England and Wales' },
            // Their paper means a full read rather than a check against our
            // template, which is the difference between an hour and a week.
            { kind: 'field', field: 'theirPaper', control: 'checkbox', label: 'Is it on their paper' },
            { kind: 'field', field: 'personalData', control: 'checkbox', label: 'Does it involve personal data' },
            { kind: 'field', field: 'signBy', control: 'date', label: 'Needs signing by' },
            { kind: 'field', field: 'summary', control: 'longtext', label: 'What is the deal', rows: 5 },
          ],
        },
      },
    },
    {
      key: 'legal-nda',
      name: 'NDA request',
      description: 'A confidentiality agreement, ours or theirs.',
      document: {
        key: 'legal-nda',
        title: 'Request an NDA',
        schema: {
          type: 'object',
          properties: {
            counterparty: { type: 'string', title: 'Who is it with', minLength: 2, maxLength: 160 },
            direction: { type: 'string', title: 'Which way does it go', enum: ['mutual', 'we-disclose', 'they-disclose'] },
            purpose: { type: 'string', title: 'What is it for', minLength: 10, maxLength: 1000 },
            theirTemplate: { type: 'boolean', title: 'Do they want to use their own template' },
            neededBy: { type: 'string', title: 'Needed by', format: 'date' },
          },
          required: ['counterparty', 'direction', 'purpose'],
        },
        ui: {
          elements: [
            { kind: 'field', field: 'counterparty', control: 'text', label: 'Who is it with' },
            {
              kind: 'field',
              field: 'direction',
              control: 'select',
              label: 'Which way does it go',
              options: [
                { value: 'mutual', label: 'Both of us share' },
                { value: 'we-disclose', label: 'We are sharing with them' },
                { value: 'they-disclose', label: 'They are sharing with us' },
              ],
            },
            { kind: 'field', field: 'purpose', control: 'longtext', label: 'What is it for', rows: 3 },
            { kind: 'field', field: 'theirTemplate', control: 'checkbox', label: 'Do they want to use their own template' },
            { kind: 'field', field: 'neededBy', control: 'date', label: 'Needed by' },
          ],
        },
      },
    },
    {
      key: 'legal-policy-question',
      name: 'Policy question',
      description: 'Are we allowed to do this?',
      document: {
        key: 'legal-policy-question',
        title: 'Ask a policy question',
        schema: {
          type: 'object',
          properties: {
            area: {
              type: 'string',
              title: 'What is it about',
              enum: ['data-protection', 'marketing', 'employment', 'intellectual-property', 'competition', 'other'],
            },
            question: { type: 'string', title: 'Your question', minLength: 20, maxLength: 2000 },
            deadline: { type: 'string', title: 'When do you need an answer', format: 'date' },
          },
          required: ['area', 'question'],
        },
        ui: {
          elements: [
            {
              kind: 'field',
              field: 'area',
              control: 'select',
              label: 'What is it about',
              options: [
                { value: 'data-protection', label: 'Data protection' },
                { value: 'marketing', label: 'Marketing and advertising' },
                { value: 'employment', label: 'Employment' },
                { value: 'intellectual-property', label: 'Intellectual property' },
                { value: 'competition', label: 'Competition' },
                { value: 'other', label: 'Something else' },
              ],
            },
            { kind: 'field', field: 'question', control: 'longtext', label: 'Your question', rows: 5 },
            { kind: 'field', field: 'deadline', control: 'date', label: 'When do you need an answer' },
          ],
        },
      },
    },
  ],
  requestTypes: [
    {
      key: 'legal-contract-review',
      serviceKey: 'legal',
      name: 'Contract review',
      shortSummary: 'Have a contract read before it is signed.',
      formKey: 'legal-contract-review',
      priority: 'P3',
      sortOrder: 10,
    },
    {
      key: 'legal-nda',
      serviceKey: 'legal',
      name: 'NDA request',
      shortSummary: 'A confidentiality agreement, ours or theirs.',
      formKey: 'legal-nda',
      priority: 'P3',
      sortOrder: 20,
    },
    {
      key: 'legal-policy-question',
      serviceKey: 'legal',
      name: 'Policy question',
      shortSummary: 'Are we allowed to do this?',
      formKey: 'legal-policy-question',
      priority: 'P4',
      sortOrder: 30,
    },
  ],
  workflows: [
    {
      key: 'legal-contract-review',
      name: 'Contract review checklist',
      description: 'The three passes a contract gets, as tasks on the request.',
      graph: {
        schemaVersion: 1,
        trigger: {
          kind: 'event',
          event: 'request.submitted',
          when: { eq: [{ var: 'requestTypeKey' }, 'legal-contract-review'] },
        },
        start: 'triage',
        nodes: [
          { key: 'triage', type: 'createTask', taskKey: 'triage', title: 'Triage: whose paper, what value, which law' },
          { key: 'review', type: 'createTask', taskKey: 'review', title: 'Read the contract and mark it up' },
          { key: 'negotiate', type: 'createTask', taskKey: 'negotiate', title: 'Agree the changes with the counterparty' },
          { key: 'reviewed', type: 'end' },
        ],
        edges: [
          { from: 'triage', to: 'review' },
          { from: 'review', to: 'negotiate' },
          { from: 'negotiate', to: 'reviewed' },
        ],
      },
    },
  ],
  slaPolicies: [
    {
      key: 'legal-standard',
      name: 'Legal standard',
      match: { eq: [{ var: 'ticket.serviceKey' }, 'legal'] },
      specificity: 50,
      calendarMode: 'group',
      targets: [
        { priority: 'P2', targetType: 'response', minutes: 480, warningThresholds: [50, 75, 90] },
        { priority: 'P3', targetType: 'response', minutes: 960, warningThresholds: [50, 75, 90] },
        { priority: 'P4', targetType: 'response', minutes: 2400, warningThresholds: [50, 75, 90] },
        { priority: 'P3', targetType: 'fulfilment', minutes: 7200, warningThresholds: [50, 75, 90] },
      ],
    },
  ],
  articles: [
    {
      key: 'legal-when-to-ask',
      title: 'When to involve legal, and what to bring',
      summary: 'The four moments worth a review, and the questions you will be asked.',
      audience: 'internal',
      keywords: ['legal', 'contract', 'nda', 'review', 'signing'],
      body: [
        {
          type: 'paragraph',
          content: [{ text: 'Bring legal in before you agree to something, not after. A review after signature is an explanation, not a review.' }],
        },
        {
          type: 'list',
          items: [
            [{ text: 'Anything on somebody else’s paper, whatever its value.' }],
            [{ text: 'Anything involving personal data leaving the organisation.' }],
            [{ text: 'Anything that renews automatically, or that is hard to leave.' }],
            [{ text: 'Anything where the governing law is not one we usually work under.' }],
          ],
        },
        {
          type: 'paragraph',
          content: [{ text: 'Raise it through the portal with the deal summary filled in. A review that starts with a document and no context takes twice as long.' }],
        },
      ],
    },
  ],
};
