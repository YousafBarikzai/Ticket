import type { Pack } from '../domain/pack.js';

/**
 * People services: joiners, leavers, leave and payroll questions.
 *
 * The one pack whose content is genuinely sensitive. Every request type here
 * is entitled to everybody in the tenant — a leaver has to be able to raise
 * their own offboarding — but what those requests carry is personal and
 * sometimes more than personal, so who holds an agent role on this desk is a
 * decision to make before it goes live. A pack cannot make it, so it is the
 * first of the next steps below. The classification registry (doc 09) is per
 * entity and field rather than per request type, so it cannot express "HR
 * requests are restricted" either; that gap is recorded there.
 */
export const hrPack: Pack = {
  key: 'hr',
  name: 'People services',
  version: 1,
  desk: 'HR',
  description:
    'Joiners, leavers, leave and payroll questions, with the onboarding checklist that goes with a new starter and an SLA that answers within a working day.',
  nextSteps: [
    'Assign the People team as the fulfilment group for the People services service.',
    'Check who holds an agent role before this goes live: these requests carry personal, and sometimes sensitive, data.',
    'Add escalations to the HR standard SLA policy once the desk has a rota.',
    'Replace the placeholder allowances in the leave article with your own.',
  ],
  services: [
    {
      key: 'hr',
      name: 'People services',
      description: 'Everything the people team does for an employee, from their first day to their last.',
    },
  ],
  forms: [
    {
      key: 'hr-onboarding',
      name: 'New joiner',
      description: 'Everything the desk needs before somebody starts.',
      document: {
        key: 'hr-onboarding',
        title: 'New joiner',
        description: 'Tell us about the person starting, and we will get them ready.',
        schema: {
          type: 'object',
          properties: {
            fullName: { type: 'string', title: 'Their full name', minLength: 2, maxLength: 120 },
            startDate: { type: 'string', title: 'First day', format: 'date' },
            jobTitle: { type: 'string', title: 'Job title', maxLength: 120 },
            employmentType: {
              type: 'string',
              title: 'Employment type',
              enum: ['permanent', 'fixed-term', 'contractor'],
            },
            endDate: { type: 'string', title: 'Last day', format: 'date' },
            equipment: {
              type: 'array',
              title: 'Equipment they need',
              items: { type: 'string', enum: ['laptop', 'phone', 'monitor', 'headset'] },
            },
            notes: { type: 'string', title: 'Anything else we should know', maxLength: 2000 },
          },
          required: ['fullName', 'startDate', 'jobTitle', 'employmentType'],
        },
        ui: {
          elements: [
            { kind: 'field', field: 'fullName', control: 'text', label: 'Their full name' },
            { kind: 'field', field: 'startDate', control: 'date', label: 'First day' },
            { kind: 'field', field: 'jobTitle', control: 'text', label: 'Job title' },
            {
              kind: 'field',
              field: 'employmentType',
              control: 'select',
              label: 'Employment type',
              options: [
                { value: 'permanent', label: 'Permanent' },
                { value: 'fixed-term', label: 'Fixed term' },
                { value: 'contractor', label: 'Contractor' },
              ],
            },
            // A fixed term with no end date is the mistake this form exists to
            // stop: it is the field everyone forgets and the one payroll needs.
            {
              kind: 'field',
              field: 'endDate',
              control: 'date',
              label: 'Last day',
              visibleWhen: { ne: [{ var: 'form.employmentType' }, 'permanent'] },
              requiredWhen: { ne: [{ var: 'form.employmentType' }, 'permanent'] },
            },
            {
              kind: 'field',
              field: 'equipment',
              control: 'multiselect',
              label: 'Equipment they need',
              options: [
                { value: 'laptop', label: 'Laptop' },
                { value: 'phone', label: 'Phone' },
                { value: 'monitor', label: 'Monitor' },
                { value: 'headset', label: 'Headset' },
              ],
            },
            { kind: 'field', field: 'notes', control: 'longtext', label: 'Anything else we should know', rows: 4 },
          ],
        },
      },
    },
    {
      key: 'hr-offboarding',
      name: 'Leaver',
      description: 'Notice of somebody leaving, and what has to happen on their last day.',
      document: {
        key: 'hr-offboarding',
        title: 'Leaver',
        schema: {
          type: 'object',
          properties: {
            fullName: { type: 'string', title: 'Who is leaving', minLength: 2, maxLength: 120 },
            lastDay: { type: 'string', title: 'Last working day', format: 'date' },
            reason: {
              type: 'string',
              title: 'Reason',
              enum: ['resignation', 'end-of-contract', 'retirement', 'other'],
            },
            handoverTo: { type: 'string', title: 'Who is taking over their work' },
            notes: { type: 'string', title: 'Anything else', maxLength: 2000 },
          },
          required: ['fullName', 'lastDay', 'reason'],
        },
        ui: {
          elements: [
            { kind: 'field', field: 'fullName', control: 'text', label: 'Who is leaving' },
            { kind: 'field', field: 'lastDay', control: 'date', label: 'Last working day' },
            {
              kind: 'field',
              field: 'reason',
              control: 'select',
              label: 'Reason',
              options: [
                { value: 'resignation', label: 'Resignation' },
                { value: 'end-of-contract', label: 'End of contract' },
                { value: 'retirement', label: 'Retirement' },
                { value: 'other', label: 'Other' },
              ],
            },
            { kind: 'field', field: 'handoverTo', control: 'user', label: 'Who is taking over their work' },
            { kind: 'field', field: 'notes', control: 'longtext', label: 'Anything else', rows: 3 },
          ],
        },
      },
    },
    {
      key: 'hr-leave',
      name: 'Leave request',
      description: 'Booking time off.',
      document: {
        key: 'hr-leave',
        title: 'Request leave',
        schema: {
          type: 'object',
          properties: {
            leaveType: {
              type: 'string',
              title: 'Type of leave',
              enum: ['annual', 'unpaid', 'parental', 'compassionate', 'study'],
            },
            from: { type: 'string', title: 'From', format: 'date' },
            to: { type: 'string', title: 'To', format: 'date' },
            reason: { type: 'string', title: 'Reason', maxLength: 1000 },
          },
          required: ['leaveType', 'from', 'to'],
        },
        ui: {
          elements: [
            {
              kind: 'field',
              field: 'leaveType',
              control: 'select',
              label: 'Type of leave',
              options: [
                { value: 'annual', label: 'Annual leave' },
                { value: 'unpaid', label: 'Unpaid leave' },
                { value: 'parental', label: 'Parental leave' },
                { value: 'compassionate', label: 'Compassionate leave' },
                { value: 'study', label: 'Study leave' },
              ],
            },
            { kind: 'field', field: 'from', control: 'date', label: 'From' },
            { kind: 'field', field: 'to', control: 'date', label: 'To' },
            // Annual leave needs no explanation; everything else does, and
            // asking everybody would be the wrong way round.
            {
              kind: 'field',
              field: 'reason',
              control: 'longtext',
              label: 'Reason',
              rows: 3,
              visibleWhen: { ne: [{ var: 'form.leaveType' }, 'annual'] },
              requiredWhen: { ne: [{ var: 'form.leaveType' }, 'annual'] },
            },
          ],
        },
      },
    },
    {
      key: 'hr-payroll-query',
      name: 'Payroll query',
      description: 'A question about pay, expenses or a payslip.',
      document: {
        key: 'hr-payroll-query',
        title: 'Payroll query',
        schema: {
          type: 'object',
          properties: {
            about: {
              type: 'string',
              title: 'What is it about',
              enum: ['payslip', 'missing-payment', 'expenses', 'tax-code', 'pension', 'other'],
            },
            period: { type: 'string', title: 'Which pay period', maxLength: 60 },
            detail: { type: 'string', title: 'What is wrong', minLength: 10, maxLength: 2000 },
          },
          required: ['about', 'detail'],
        },
        ui: {
          elements: [
            {
              kind: 'field',
              field: 'about',
              control: 'select',
              label: 'What is it about',
              options: [
                { value: 'payslip', label: 'My payslip' },
                { value: 'missing-payment', label: 'A payment I did not receive' },
                { value: 'expenses', label: 'Expenses' },
                { value: 'tax-code', label: 'My tax code' },
                { value: 'pension', label: 'Pension' },
                { value: 'other', label: 'Something else' },
              ],
            },
            { kind: 'field', field: 'period', control: 'text', label: 'Which pay period', placeholder: 'September 2026' },
            { kind: 'field', field: 'detail', control: 'longtext', label: 'What is wrong', rows: 5 },
          ],
        },
      },
    },
  ],
  requestTypes: [
    {
      key: 'hr-onboarding',
      serviceKey: 'hr',
      name: 'Onboard a new joiner',
      shortSummary: 'Everything a new starter needs before their first day.',
      description: 'Raises the joiner checklist: payroll, workplace, equipment and induction.',
      formKey: 'hr-onboarding',
      priority: 'P3',
      sortOrder: 10,
    },
    {
      key: 'hr-offboarding',
      serviceKey: 'hr',
      name: 'Offboard a leaver',
      shortSummary: 'Tell us somebody is leaving.',
      formKey: 'hr-offboarding',
      priority: 'P3',
      sortOrder: 20,
    },
    {
      key: 'hr-leave',
      serviceKey: 'hr',
      name: 'Request leave',
      shortSummary: 'Book annual, parental, study or unpaid leave.',
      formKey: 'hr-leave',
      priority: 'P4',
      sortOrder: 30,
    },
    {
      key: 'hr-payroll-query',
      serviceKey: 'hr',
      name: 'Payroll query',
      shortSummary: 'Ask about pay, a payslip, expenses or your tax code.',
      formKey: 'hr-payroll-query',
      priority: 'P3',
      sortOrder: 40,
    },
  ],
  workflows: [
    {
      key: 'hr-onboarding',
      name: 'New joiner checklist',
      description: 'The four things that have to happen before somebody starts, as tasks on the request.',
      graph: {
        schemaVersion: 1,
        trigger: {
          kind: 'event',
          event: 'request.submitted',
          when: { eq: [{ var: 'requestTypeKey' }, 'hr-onboarding'] },
        },
        start: 'payroll',
        nodes: [
          { key: 'payroll', type: 'createTask', taskKey: 'payroll', title: 'Add the joiner to payroll' },
          { key: 'workplace', type: 'createTask', taskKey: 'workplace', title: 'Prepare a desk and building access' },
          { key: 'equipment', type: 'createTask', taskKey: 'equipment', title: 'Order the equipment they asked for' },
          { key: 'induction', type: 'createTask', taskKey: 'induction', title: 'Book the induction session' },
          { key: 'ready', type: 'end' },
        ],
        edges: [
          { from: 'payroll', to: 'workplace' },
          { from: 'workplace', to: 'equipment' },
          { from: 'equipment', to: 'induction' },
          { from: 'induction', to: 'ready' },
        ],
      },
    },
  ],
  slaPolicies: [
    {
      key: 'hr-standard',
      name: 'HR standard',
      match: { eq: [{ var: 'ticket.serviceKey' }, 'hr'] },
      specificity: 50,
      calendarMode: 'group',
      targets: [
        { priority: 'P1', targetType: 'response', minutes: 60, warningThresholds: [50, 75, 90] },
        { priority: 'P2', targetType: 'response', minutes: 240, warningThresholds: [50, 75, 90] },
        { priority: 'P3', targetType: 'response', minutes: 480, warningThresholds: [50, 75, 90] },
        { priority: 'P4', targetType: 'response', minutes: 960, warningThresholds: [50, 75, 90] },
        { priority: 'P3', targetType: 'fulfilment', minutes: 2400, warningThresholds: [50, 75, 90] },
        { priority: 'P4', targetType: 'fulfilment', minutes: 4800, warningThresholds: [50, 75, 90] },
      ],
    },
  ],
  articles: [
    {
      key: 'hr-leave-policy',
      title: 'How leave works',
      summary: 'What you are entitled to, how far ahead to ask, and who approves it.',
      audience: 'internal',
      keywords: ['leave', 'holiday', 'annual leave', 'time off'],
      body: [
        {
          type: 'paragraph',
          content: [
            {
              text: 'These figures are the ones the pack ships with. Replace them with your own before you tell anybody this article exists.',
              bold: true,
            },
          ],
        },
        {
          type: 'list',
          items: [
            [{ text: 'Annual leave: 25 days a year, plus public holidays.' }],
            [{ text: 'Ask at least two weeks ahead for anything longer than three days.' }],
            [{ text: 'Your manager approves leave; the people team records it.' }],
            [{ text: 'Unused leave does not carry into the next year unless your manager agrees in writing.' }],
          ],
        },
        {
          type: 'paragraph',
          content: [{ text: 'Raise leave through the portal so it reaches payroll as well as your manager.' }],
        },
      ],
    },
  ],
};
