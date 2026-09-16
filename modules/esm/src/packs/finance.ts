import type { Pack } from '../domain/pack.js';

/**
 * Finance: buying things, paying for them, and arguing about invoices.
 *
 * The pack that leans hardest on approvals, and the one place a pack has to
 * be careful not to pretend: the purchase request carries a threshold field
 * and an article that explains the thresholds, but the approval policy itself
 * is MOD-17's and belongs to the tenant's authority matrix. Shipping a policy
 * that approved everything under a number this pack invented would be worse
 * than shipping none.
 */
export const financePack: Pack = {
  key: 'finance',
  name: 'Finance services',
  version: 1,
  desk: 'Finance',
  description:
    'Purchase requests, invoice disputes, new suppliers and expense questions, with a supplier onboarding checklist and an SLA that treats a disputed invoice as urgent.',
  nextSteps: [
    'Assign the Finance team as the fulfilment group for the Finance services service.',
    'Add an approval policy for the purchase request: the pack ships the form, not the authority matrix.',
    'Set your own thresholds in the purchase thresholds article and in the form options.',
  ],
  services: [
    {
      key: 'finance',
      name: 'Finance services',
      description: 'Buying, paying, and the questions that come with both.',
    },
  ],
  forms: [
    {
      key: 'finance-purchase-request',
      name: 'Purchase request',
      description: 'Asking to buy something, with what finance needs to approve it.',
      document: {
        key: 'finance-purchase-request',
        title: 'Request a purchase',
        schema: {
          type: 'object',
          properties: {
            whatFor: { type: 'string', title: 'What are you buying', minLength: 5, maxLength: 200 },
            supplier: { type: 'string', title: 'Supplier', maxLength: 120 },
            amount: { type: 'number', title: 'Amount', minimum: 0, maximum: 10000000 },
            currency: { type: 'string', title: 'Currency', enum: ['GBP', 'EUR', 'USD'], default: 'GBP' },
            recurring: { type: 'boolean', title: 'Is this a recurring cost' },
            costCentre: { type: 'string', title: 'Cost centre', maxLength: 40 },
            businessCase: { type: 'string', title: 'Why we need it', maxLength: 4000 },
            neededBy: { type: 'string', title: 'Needed by', format: 'date' },
          },
          required: ['whatFor', 'amount', 'currency', 'costCentre'],
        },
        ui: {
          elements: [
            { kind: 'field', field: 'whatFor', control: 'text', label: 'What are you buying' },
            { kind: 'field', field: 'supplier', control: 'text', label: 'Supplier' },
            { kind: 'field', field: 'amount', control: 'number', label: 'Amount' },
            {
              kind: 'field',
              field: 'currency',
              control: 'select',
              label: 'Currency',
              options: [
                { value: 'GBP', label: 'Pounds' },
                { value: 'EUR', label: 'Euros' },
                { value: 'USD', label: 'Dollars' },
              ],
            },
            { kind: 'field', field: 'recurring', control: 'checkbox', label: 'Is this a recurring cost' },
            { kind: 'field', field: 'costCentre', control: 'text', label: 'Cost centre' },
            // Above the threshold finance needs the argument written down, and
            // below it asking for one wastes everybody's afternoon.
            {
              kind: 'field',
              field: 'businessCase',
              control: 'longtext',
              label: 'Why we need it',
              rows: 5,
              help: 'Required above 5,000. Change the figure to match your own thresholds.',
              visibleWhen: { gt: [{ var: 'form.amount' }, 1000] },
              requiredWhen: { gt: [{ var: 'form.amount' }, 5000] },
            },
            { kind: 'field', field: 'neededBy', control: 'date', label: 'Needed by' },
          ],
        },
      },
    },
    {
      key: 'finance-invoice-dispute',
      name: 'Invoice dispute',
      description: 'An invoice that is wrong, duplicated or unexpected.',
      document: {
        key: 'finance-invoice-dispute',
        title: 'Dispute an invoice',
        schema: {
          type: 'object',
          properties: {
            supplier: { type: 'string', title: 'Supplier', maxLength: 120 },
            invoiceNumber: { type: 'string', title: 'Invoice number', maxLength: 60 },
            amount: { type: 'number', title: 'Amount on the invoice', minimum: 0, maximum: 10000000 },
            problem: {
              type: 'string',
              title: 'What is wrong',
              enum: ['never-ordered', 'already-paid', 'wrong-amount', 'wrong-goods', 'other'],
            },
            detail: { type: 'string', title: 'Tell us more', minLength: 10, maxLength: 2000 },
            dueDate: { type: 'string', title: 'Payment due', format: 'date' },
          },
          required: ['supplier', 'invoiceNumber', 'problem', 'detail'],
        },
        ui: {
          elements: [
            { kind: 'field', field: 'supplier', control: 'text', label: 'Supplier' },
            { kind: 'field', field: 'invoiceNumber', control: 'text', label: 'Invoice number' },
            { kind: 'field', field: 'amount', control: 'number', label: 'Amount on the invoice' },
            {
              kind: 'field',
              field: 'problem',
              control: 'select',
              label: 'What is wrong',
              options: [
                { value: 'never-ordered', label: 'We never ordered it' },
                { value: 'already-paid', label: 'We have already paid it' },
                { value: 'wrong-amount', label: 'The amount is wrong' },
                { value: 'wrong-goods', label: 'The goods or service were not what we agreed' },
                { value: 'other', label: 'Something else' },
              ],
            },
            { kind: 'field', field: 'detail', control: 'longtext', label: 'Tell us more', rows: 4 },
            { kind: 'field', field: 'dueDate', control: 'date', label: 'Payment due', help: 'So we know how long we have.' },
          ],
        },
      },
    },
    {
      key: 'finance-new-supplier',
      name: 'New supplier',
      description: 'Onboarding a supplier we have not bought from before.',
      document: {
        key: 'finance-new-supplier',
        title: 'Set up a new supplier',
        schema: {
          type: 'object',
          properties: {
            supplierName: { type: 'string', title: 'Supplier name', minLength: 2, maxLength: 120 },
            contactEmail: { type: 'string', title: 'Their contact', format: 'email' },
            country: { type: 'string', title: 'Country', maxLength: 80 },
            whatTheySupply: { type: 'string', title: 'What they supply', maxLength: 500 },
            handlesPersonalData: { type: 'boolean', title: 'Will they handle personal data' },
            expectedAnnualSpend: { type: 'number', title: 'Expected spend a year', minimum: 0, maximum: 10000000 },
          },
          required: ['supplierName', 'contactEmail', 'whatTheySupply'],
        },
        ui: {
          elements: [
            { kind: 'field', field: 'supplierName', control: 'text', label: 'Supplier name' },
            { kind: 'field', field: 'contactEmail', control: 'text', label: 'Their contact' },
            { kind: 'field', field: 'country', control: 'text', label: 'Country' },
            { kind: 'field', field: 'whatTheySupply', control: 'longtext', label: 'What they supply', rows: 3 },
            {
              kind: 'field',
              field: 'handlesPersonalData',
              control: 'checkbox',
              label: 'Will they handle personal data',
              help: 'If so, this needs a data protection review before anything is signed.',
            },
            { kind: 'field', field: 'expectedAnnualSpend', control: 'number', label: 'Expected spend a year' },
          ],
        },
      },
    },
    {
      key: 'finance-expense-query',
      name: 'Expense query',
      description: 'A question about an expense claim.',
      document: {
        key: 'finance-expense-query',
        title: 'Expense query',
        schema: {
          type: 'object',
          properties: {
            claimReference: { type: 'string', title: 'Claim reference', maxLength: 60 },
            about: { type: 'string', title: 'What is it about', enum: ['rejected', 'not-paid', 'policy', 'other'] },
            detail: { type: 'string', title: 'Tell us more', minLength: 10, maxLength: 2000 },
          },
          required: ['about', 'detail'],
        },
        ui: {
          elements: [
            { kind: 'field', field: 'claimReference', control: 'text', label: 'Claim reference' },
            {
              kind: 'field',
              field: 'about',
              control: 'select',
              label: 'What is it about',
              options: [
                { value: 'rejected', label: 'A claim was rejected' },
                { value: 'not-paid', label: 'An approved claim has not been paid' },
                { value: 'policy', label: 'What I can claim for' },
                { value: 'other', label: 'Something else' },
              ],
            },
            { kind: 'field', field: 'detail', control: 'longtext', label: 'Tell us more', rows: 4 },
          ],
        },
      },
    },
  ],
  requestTypes: [
    {
      key: 'finance-purchase-request',
      serviceKey: 'finance',
      name: 'Request a purchase',
      shortSummary: 'Ask to buy something, with the numbers finance needs.',
      formKey: 'finance-purchase-request',
      priority: 'P3',
      sortOrder: 10,
    },
    {
      key: 'finance-invoice-dispute',
      serviceKey: 'finance',
      name: 'Dispute an invoice',
      shortSummary: 'An invoice that is wrong, duplicated or unexpected.',
      formKey: 'finance-invoice-dispute',
      priority: 'P2',
      sortOrder: 20,
    },
    {
      key: 'finance-new-supplier',
      serviceKey: 'finance',
      name: 'Set up a new supplier',
      shortSummary: 'Onboard a supplier we have not bought from before.',
      formKey: 'finance-new-supplier',
      priority: 'P3',
      sortOrder: 30,
    },
    {
      key: 'finance-expense-query',
      serviceKey: 'finance',
      name: 'Expense query',
      shortSummary: 'A question about a claim.',
      formKey: 'finance-expense-query',
      priority: 'P4',
      sortOrder: 40,
    },
  ],
  workflows: [
    {
      key: 'finance-new-supplier',
      name: 'Supplier onboarding checks',
      description: 'The checks a new supplier goes through before anybody raises a purchase order.',
      graph: {
        schemaVersion: 1,
        trigger: {
          kind: 'event',
          event: 'request.submitted',
          when: { eq: [{ var: 'requestTypeKey' }, 'finance-new-supplier'] },
        },
        start: 'due-diligence',
        nodes: [
          { key: 'due-diligence', type: 'createTask', taskKey: 'due-diligence', title: 'Run due diligence on the supplier' },
          { key: 'bank-details', type: 'createTask', taskKey: 'bank-details', title: 'Verify bank details by a second channel' },
          { key: 'data-review', type: 'createTask', taskKey: 'data-review', title: 'Data protection review, if they handle personal data' },
          { key: 'ledger', type: 'createTask', taskKey: 'ledger', title: 'Create the supplier in the ledger' },
          { key: 'onboarded', type: 'end' },
        ],
        edges: [
          { from: 'due-diligence', to: 'bank-details' },
          { from: 'bank-details', to: 'data-review' },
          { from: 'data-review', to: 'ledger' },
          { from: 'ledger', to: 'onboarded' },
        ],
      },
    },
  ],
  slaPolicies: [
    {
      key: 'finance-standard',
      name: 'Finance standard',
      match: { eq: [{ var: 'ticket.serviceKey' }, 'finance'] },
      specificity: 50,
      calendarMode: 'group',
      targets: [
        { priority: 'P1', targetType: 'response', minutes: 60, warningThresholds: [50, 75, 90] },
        { priority: 'P2', targetType: 'response', minutes: 240, warningThresholds: [50, 75, 90] },
        { priority: 'P3', targetType: 'response', minutes: 960, warningThresholds: [50, 75, 90] },
        { priority: 'P4', targetType: 'response', minutes: 1920, warningThresholds: [50, 75, 90] },
        { priority: 'P2', targetType: 'resolution', minutes: 2400, warningThresholds: [50, 75, 90] },
        { priority: 'P3', targetType: 'fulfilment', minutes: 4800, warningThresholds: [50, 75, 90] },
      ],
    },
  ],
  articles: [
    {
      key: 'finance-purchase-thresholds',
      title: 'What you need before you buy something',
      summary: 'Who has to agree, at what size, and what finance will ask you for.',
      audience: 'internal',
      keywords: ['purchase', 'approval', 'threshold', 'purchase order', 'spend'],
      body: [
        {
          type: 'paragraph',
          content: [
            { text: 'These thresholds are the pack defaults. ', bold: true },
            { text: 'Replace them with your own before pointing anybody at this article.' },
          ],
        },
        {
          type: 'list',
          ordered: true,
          items: [
            [{ text: 'Under 1,000: your manager agrees, and finance records it.' }],
            [{ text: '1,000 to 5,000: a written reason, and your budget holder agrees.' }],
            [{ text: 'Over 5,000: a business case, the budget holder, and finance.' }],
            [{ text: 'Any recurring cost: treated at its annual value, not its monthly one.' }],
          ],
        },
        {
          type: 'paragraph',
          content: [
            { text: 'Never commit to a supplier before the request is approved. A purchase order raised afterwards does not make a commitment retrospective.' },
          ],
        },
      ],
    },
  ],
};
