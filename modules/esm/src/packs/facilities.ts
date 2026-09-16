import type { Pack } from '../domain/pack.js';

/**
 * Workplace and facilities: desks, access cards and things that are broken.
 *
 * The one pack where *where* matters more than *who*, so every form asks for a
 * building and a floor rather than assuming the desk can work it out. A
 * tenant with Locations configured will want to replace those text fields with
 * a select; that is in the next steps rather than guessed at here, because a
 * pack that shipped a list of buildings would ship the wrong ones.
 */
export const facilitiesPack: Pack = {
  key: 'facilities',
  name: 'Workplace and facilities',
  version: 1,
  desk: 'Facilities',
  description:
    'Desk moves, access cards, and anything broken in a building, with a move checklist and an SLA that separates a faulty door from a wobbly chair.',
  nextSteps: [
    'Assign the Facilities team as the fulfilment group for the Workplace service.',
    'Replace the free-text building field with a select once your Locations are configured.',
    'Point the building fault request at your out-of-hours rota if the desk has one.',
  ],
  services: [
    {
      key: 'facilities',
      name: 'Workplace',
      description: 'The buildings, the desks in them, and getting into both.',
    },
  ],
  forms: [
    {
      key: 'facilities-desk-move',
      name: 'Desk move',
      description: 'Moving one person, or a team, from one place to another.',
      document: {
        key: 'facilities-desk-move',
        title: 'Move a desk',
        schema: {
          type: 'object',
          properties: {
            who: { type: 'string', title: 'Who is moving', maxLength: 200 },
            headcount: { type: 'integer', title: 'How many people', minimum: 1, maximum: 200 },
            fromLocation: { type: 'string', title: 'From', maxLength: 120 },
            toLocation: { type: 'string', title: 'To', maxLength: 120 },
            moveOn: { type: 'string', title: 'Move on', format: 'date' },
            needsCabling: { type: 'boolean', title: 'Needs network cabling' },
            notes: { type: 'string', title: 'Anything else', maxLength: 1000 },
          },
          required: ['who', 'headcount', 'fromLocation', 'toLocation', 'moveOn'],
        },
        ui: {
          elements: [
            { kind: 'field', field: 'who', control: 'text', label: 'Who is moving' },
            { kind: 'field', field: 'headcount', control: 'number', label: 'How many people' },
            { kind: 'field', field: 'fromLocation', control: 'text', label: 'From', placeholder: 'Building, floor' },
            { kind: 'field', field: 'toLocation', control: 'text', label: 'To', placeholder: 'Building, floor' },
            { kind: 'field', field: 'moveOn', control: 'date', label: 'Move on' },
            { kind: 'field', field: 'needsCabling', control: 'checkbox', label: 'Needs network cabling' },
            { kind: 'field', field: 'notes', control: 'longtext', label: 'Anything else', rows: 3 },
          ],
        },
      },
    },
    {
      key: 'facilities-access-card',
      name: 'Access card',
      description: 'A new card, a replacement, or access to somewhere new.',
      document: {
        key: 'facilities-access-card',
        title: 'Access card',
        schema: {
          type: 'object',
          properties: {
            request: { type: 'string', title: 'What do you need', enum: ['new', 'replacement', 'extra-access'] },
            lostOrStolen: { type: 'boolean', title: 'Was the old card lost or stolen' },
            building: { type: 'string', title: 'Building', maxLength: 120 },
            areas: { type: 'string', title: 'Which areas', maxLength: 500 },
            neededBy: { type: 'string', title: 'Needed by', format: 'date' },
          },
          required: ['request', 'building'],
        },
        ui: {
          elements: [
            {
              kind: 'field',
              field: 'request',
              control: 'select',
              label: 'What do you need',
              options: [
                { value: 'new', label: 'A card for the first time' },
                { value: 'replacement', label: 'A replacement card' },
                { value: 'extra-access', label: 'Access to somewhere new' },
              ],
            },
            // A lost card is a security question as well as a facilities one,
            // and the desk cannot tell the difference unless it is asked.
            {
              kind: 'field',
              field: 'lostOrStolen',
              control: 'checkbox',
              label: 'Was the old card lost or stolen',
              visibleWhen: { eq: [{ var: 'form.request' }, 'replacement'] },
            },
            { kind: 'field', field: 'building', control: 'text', label: 'Building' },
            {
              kind: 'field',
              field: 'areas',
              control: 'longtext',
              label: 'Which areas',
              rows: 2,
              visibleWhen: { eq: [{ var: 'form.request' }, 'extra-access'] },
              requiredWhen: { eq: [{ var: 'form.request' }, 'extra-access'] },
            },
            { kind: 'field', field: 'neededBy', control: 'date', label: 'Needed by' },
          ],
        },
      },
    },
    {
      key: 'facilities-building-fault',
      name: 'Building fault',
      description: 'Something broken, leaking, too hot or too cold.',
      document: {
        key: 'facilities-building-fault',
        title: 'Report a building fault',
        schema: {
          type: 'object',
          properties: {
            building: { type: 'string', title: 'Building', maxLength: 120 },
            whereExactly: { type: 'string', title: 'Where exactly', maxLength: 200 },
            fault: {
              type: 'string',
              title: 'What is wrong',
              enum: ['heating', 'lighting', 'water', 'door', 'lift', 'furniture', 'cleaning', 'other'],
            },
            unsafe: { type: 'boolean', title: 'Is anybody unsafe or unable to work' },
            detail: { type: 'string', title: 'Describe it', minLength: 10, maxLength: 2000 },
          },
          required: ['building', 'whereExactly', 'fault', 'detail'],
        },
        ui: {
          elements: [
            { kind: 'field', field: 'building', control: 'text', label: 'Building' },
            { kind: 'field', field: 'whereExactly', control: 'text', label: 'Where exactly', placeholder: 'Floor 2, north stairwell' },
            {
              kind: 'field',
              field: 'fault',
              control: 'select',
              label: 'What is wrong',
              options: [
                { value: 'heating', label: 'Heating or air conditioning' },
                { value: 'lighting', label: 'Lighting' },
                { value: 'water', label: 'Water or a leak' },
                { value: 'door', label: 'A door or a lock' },
                { value: 'lift', label: 'A lift' },
                { value: 'furniture', label: 'Furniture' },
                { value: 'cleaning', label: 'Cleaning' },
                { value: 'other', label: 'Something else' },
              ],
            },
            { kind: 'field', field: 'unsafe', control: 'checkbox', label: 'Is anybody unsafe or unable to work' },
            { kind: 'field', field: 'detail', control: 'longtext', label: 'Describe it', rows: 4 },
          ],
        },
      },
    },
  ],
  requestTypes: [
    {
      key: 'facilities-desk-move',
      serviceKey: 'facilities',
      name: 'Move a desk or a team',
      shortSummary: 'Move one person or a whole team to a new place.',
      formKey: 'facilities-desk-move',
      priority: 'P3',
      sortOrder: 10,
    },
    {
      key: 'facilities-access-card',
      serviceKey: 'facilities',
      name: 'Access card',
      shortSummary: 'A new card, a replacement, or access to somewhere new.',
      formKey: 'facilities-access-card',
      priority: 'P3',
      sortOrder: 20,
    },
    {
      key: 'facilities-building-fault',
      serviceKey: 'facilities',
      name: 'Report a building fault',
      shortSummary: 'Something broken, leaking, too hot or too cold.',
      formKey: 'facilities-building-fault',
      priority: 'P2',
      sortOrder: 30,
    },
  ],
  workflows: [
    {
      key: 'facilities-desk-move',
      name: 'Desk move checklist',
      description: 'The three trades a move needs, as tasks on the request.',
      graph: {
        schemaVersion: 1,
        trigger: {
          kind: 'event',
          event: 'request.submitted',
          when: { eq: [{ var: 'requestTypeKey' }, 'facilities-desk-move'] },
        },
        start: 'survey',
        nodes: [
          { key: 'survey', type: 'createTask', taskKey: 'survey', title: 'Survey the destination and confirm it fits' },
          { key: 'cabling', type: 'createTask', taskKey: 'cabling', title: 'Arrange network and power' },
          { key: 'removals', type: 'createTask', taskKey: 'removals', title: 'Book the removals slot' },
          { key: 'access', type: 'createTask', taskKey: 'access', title: 'Update building access for the new floor' },
          { key: 'moved', type: 'end' },
        ],
        edges: [
          { from: 'survey', to: 'cabling' },
          { from: 'cabling', to: 'removals' },
          { from: 'removals', to: 'access' },
          { from: 'access', to: 'moved' },
        ],
      },
    },
  ],
  slaPolicies: [
    {
      key: 'facilities-standard',
      name: 'Facilities standard',
      match: { eq: [{ var: 'ticket.serviceKey' }, 'facilities'] },
      specificity: 50,
      calendarMode: 'group',
      targets: [
        { priority: 'P1', targetType: 'response', minutes: 30, warningThresholds: [50, 75, 90] },
        { priority: 'P2', targetType: 'response', minutes: 120, warningThresholds: [50, 75, 90] },
        { priority: 'P3', targetType: 'response', minutes: 480, warningThresholds: [50, 75, 90] },
        { priority: 'P4', targetType: 'response', minutes: 1440, warningThresholds: [50, 75, 90] },
        { priority: 'P2', targetType: 'resolution', minutes: 960, warningThresholds: [50, 75, 90] },
        { priority: 'P3', targetType: 'fulfilment', minutes: 4800, warningThresholds: [50, 75, 90] },
      ],
    },
  ],
  articles: [
    {
      key: 'facilities-building-access',
      title: 'Getting into the building',
      summary: 'Cards, visitors and what to do when your card stops working.',
      audience: 'internal',
      keywords: ['access card', 'door', 'building', 'visitor', 'pass'],
      body: [
        {
          type: 'paragraph',
          content: [{ text: 'Your card opens the buildings and areas your role needs, and nothing else. Ask for more through the portal.' }],
        },
        {
          type: 'list',
          items: [
            [{ text: 'Card not working: try a second door before raising anything — one faulty reader is not a faulty card.' }],
            [{ text: 'Lost or stolen: say so on the form. The old card is cancelled the same day.' }],
            [{ text: 'Visitors: book them in at reception the day before, with a host named.' }],
            [{ text: 'Never let somebody in behind you, however well you know them.' }],
          ],
        },
      ],
    },
  ],
};
