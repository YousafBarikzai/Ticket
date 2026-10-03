import type {
  BankHoliday,
  CastMember,
  ChangeContent,
  CsatLibrary,
  DemoContent,
  HeroContent,
  KnowledgeArticleContent,
  KnowledgeCategoryKey,
  PeopleLibrary,
  ProblemContent,
  ReplyLibrary,
  SlotBank,
  SubcategoryText,
  TitleLibrary,
} from '../content-types.js';
import { KNOWLEDGE_KEYS, REPLY_KINDS, SUBCATEGORY_KEYS } from '../content-types.js';

/**
 * A complete content library for the planner's tests, written to the shapes
 * in `content-types.ts` and nothing else (SPEC §15.0 rule 8): the planner is
 * tested against the interface, not against the real library, which another
 * package writes. Its words are plain on purpose; its facts — who leads which
 * team, which hero is where, the changes and problems — follow A4 §1, because
 * the story's checks read them.
 */

const titles = Object.fromEntries(
  SUBCATEGORY_KEYS.map((key): [string, SubcategoryText] => [
    key,
    {
      titles: Array.from({ length: 12 }, (_, i) => (i % 3 === 0 ? `Problem ${i + 1} with ${key} {since}` : `Problem ${i + 1} with ${key}`)),
      descriptions: [
        'It stopped working {since} on {device}. I am at {site}.',
        'Could someone look at this? It has happened twice today.',
        'Happens on the {floor} floor and in the {room} room.',
        'The message says "{error}" when I open {app}.',
      ],
      phoned: ['Called in: {colleague} reports it is broken {since}.'],
    },
  ]),
) as unknown as TitleLibrary;

const slots: SlotBank = {
  site: ['London HQ', 'Leeds DC', 'Bristol hub'],
  floor: ['3rd', '4th'],
  app: ['Outlook', 'Teams', 'Excel'],
  error: ['Something went wrong', 'Access denied'],
  since: ['since this morning', 'since Monday'],
  room: ['Thames', 'Severn', 'Aire', 'Avon'],
};

const replies = Object.fromEntries(
  REPLY_KINDS.map((kind) => [kind, [`Hi {first}, ${kind} one from {agent}.`, `Thanks {first}, ${kind} two.`, `${kind} three.`]]),
) as unknown as ReplyLibrary;

const knowledgeCategory = (key: string): KnowledgeCategoryKey =>
  key.startsWith('rb-')
    ? 'runbooks'
    : ['password-policy', 'travel-devices', 'acceptable-use'].includes(key)
      ? 'policies'
      : ['outlook-password-prompt', 'printer-offline', 'mapped-drive-missing', 'vpn-authentication-failed', 'dock-black-screen', 'teams-camera', 'onedrive-sync-paused'].includes(key)
        ? 'troubleshooting'
        : 'how-to';

const knowledge: KnowledgeArticleContent[] = KNOWLEDGE_KEYS.map((key, index) => {
  const unpublished = key === 'ricoh-printers' || key === 'expenses-sage';
  return {
    key,
    title: `Article ${key}`,
    summary: `What to do about ${key}.`,
    category: knowledgeCategory(key),
    audience: key.startsWith('rb-') ? 'internal' : 'all',
    state: key === 'ricoh-printers' ? 'draft' : key === 'expenses-sage' ? 'in_review' : 'published',
    views: key === 'vpn-authentication-failed' ? { day: 37, night: 84 } : unpublished ? 0 : 20 + ((index * 97) % 900),
    helpfulPercent: unpublished ? 0 : 78 + (index % 16),
    publishedDaysAgo: 10 + index * 9,
    keywords: [key],
    body: [{ type: 'paragraph', content: [{ text: `How to deal with ${key}.` }] }, { type: 'list', ordered: true, items: [[{ text: 'First step.' }], [{ text: 'Second step.' }]] }],
  };
});

const member = (
  key: string,
  fn: CastMember['function'],
  site: CastMember['site'],
  managerKey: string | null,
  extra: Partial<CastMember> = {},
): CastMember => {
  const [first, last] = key.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)) as [string, string];
  return { key, firstName: first, lastName: last, email: `${first.toLowerCase()}.${last.toLowerCase()}@northwind.example`, function: fn, site, managerKey, ...extra };
};
const agent = (key: string, team: NonNullable<CastMember['team']>['key'], lead: boolean, manager: string): CastMember =>
  member(key, 'it', 'london', manager, { roles: lead ? ['agent', 'team_lead'] : ['agent'], team: { key: team, lead }, skills: [{ key: 'windows', level: 2 }] });

const cast: CastMember[] = [
  member('victoria-lane', 'executive', 'london', null),
  member('richard-hale', 'finance', 'london', 'victoria-lane'),
  member('mark-ellison', 'sales', 'london', 'victoria-lane'),
  member('gareth-pryce', 'warehouse', 'leeds', 'victoria-lane'),
  member('nadia-begum', 'customer-service', 'bristol', 'victoria-lane'),
  member('claire-donovan', 'hr', 'london', 'victoria-lane'),
  member('jordan-lee', 'it', 'london', 'richard-hale', { roles: ['administrator', 'service_owner'] }),
  member('emma-clarke', 'finance', 'london', 'richard-hale'),
  member('marcus-chen', 'finance', 'london', 'emma-clarke'),
  member('olivia-bennett', 'finance', 'london', 'emma-clarke'),
  member('ravi-patel', 'finance', 'london', 'emma-clarke'),
  member('kwame-mensah', 'finance', 'london', 'emma-clarke'),
  member('lucy-turner', 'finance', 'london', 'emma-clarke'),
  member('hamza-ali', 'finance', 'london', 'emma-clarke'),
  agent('alex-morgan', 'service-desk', true, 'jordan-lee'),
  agent('priya-shah', 'service-desk', false, 'alex-morgan'),
  agent('tom-fletcher', 'service-desk', false, 'alex-morgan'),
  agent('grace-okafor', 'service-desk', false, 'alex-morgan'),
  agent('ben-carter', 'euc', true, 'jordan-lee'),
  agent('sofia-rossi', 'euc', false, 'ben-carter'),
  agent('daniel-hughes', 'network', true, 'jordan-lee'),
  agent('aisha-rahman', 'network', false, 'daniel-hughes'),
  agent('liam-walsh', 'bizapps', true, 'jordan-lee'),
  agent('hannah-becker', 'bizapps', false, 'liam-walsh'),
  agent('chloe-nguyen', 'identity', true, 'jordan-lee'),
  agent('ryan-webb', 'identity', false, 'chloe-nguyen'),
  member('elena-kovacs', 'sales', 'london', 'mark-ellison'),
  member('james-whitfield', 'sales', 'london', 'mark-ellison'),
  member('fatima-khan', 'sales', 'london', 'mark-ellison'),
  member('sam-doyle', 'marketing', 'london', 'mark-ellison'),
  member('oliver-grant', 'warehouse', 'leeds', 'gareth-pryce'),
  member('megan-price', 'customer-service', 'bristol', 'nadia-begum'),
  member('zara-hussain', 'hr', 'london', 'claire-donovan'),
  member('sarah-ahmed', 'field-sales', 'field', 'mark-ellison'),
  member('daniel-price', 'field-sales', 'field', 'mark-ellison'),
  member('peter-shaw', 'legal', 'london', 'claire-donovan'),
  member('anna-hughes', 'transport', 'leeds', 'gareth-pryce'),
  member('george-wood', 'facilities', 'leeds', 'gareth-pryce'),
  member('ruth-cole', 'quality', 'bristol', 'nadia-begum'),
  member('joe-baker', 'warehouse', 'leeds', 'gareth-pryce'),
  member('ella-ward', 'customer-service', 'bristol', 'nadia-begum'),
  member('max-reid', 'marketing', 'london', 'mark-ellison'),
  member('ivy-shah', 'legal', 'london', 'claire-donovan'),
];

const people: PeopleLibrary = {
  cast,
  firstNames: Array.from({ length: 60 }, (_, i) => `First${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`),
  surnames: Array.from({ length: 60 }, (_, i) => `Surname${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`),
  monitoring: { firstName: 'Northwind', lastName: 'Monitoring', email: 'monitoring@northwind.example' },
};

const holidays: BankHoliday[] = [
  '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04', '2026-05-25', '2026-08-31', '2026-12-25', '2026-12-28',
  '2027-01-01', '2027-03-26', '2027-03-29', '2027-05-03', '2027-05-31', '2027-08-30', '2027-12-27', '2027-12-28',
  '2028-01-03', '2028-04-14', '2028-04-17', '2028-05-01', '2028-05-29', '2028-08-28', '2028-12-25', '2028-12-26',
].map((date) => ({ date, name: `Bank holiday ${date}` }));

const csat: CsatLibrary = {
  positive: ['{agent} sorted it quickly.', 'Thank you.', 'Quick and friendly.'],
  neutral: ['Fixed in the end.', 'Fine.'],
  negative: ['Took too long.', 'Had to chase.'],
};

const hero = (value: Omit<HeroContent, 'name' | 'thread' | 'title' | 'description'> & Partial<HeroContent>): HeroContent => ({
  name: value.key.toLowerCase(),
  title: `Hero ${value.key}`,
  description: `The story of ${value.key}.`,
  thread: [],
  ...value,
});

const heroes: HeroContent[] = [
  hero({ key: 'H1', requester: 'marcus-chen', channel: 'email', type: 'incident', priority: 'P3', subcategory: 'outlook', team: 'service-desk', assignee: 'alex-morgan', status: 'in_progress', thread: [{ author: 'assignee', visibility: 'public', body: 'Hi {first}, could you clear the saved credentials?' }, { author: 'requester', visibility: 'public', body: 'It only happens on the dock.' }] }),
  hero({ key: 'H2', requester: 'elena-kovacs', channel: 'teams', type: 'incident', priority: 'P2', subcategory: 'teams', team: 'service-desk', assignee: 'alex-morgan', status: 'in_progress', problem: 415 }),
  hero({ key: 'H3', requester: 'james-whitfield', channel: 'portal', type: 'incident', priority: 'P3', subcategory: 'onedrive-sharepoint', team: 'service-desk', assignee: 'alex-morgan', status: 'pending_requester' }),
  hero({ key: 'H4', requester: 'fatima-khan', channel: 'portal', type: 'request', priority: 'P4', subcategory: 'app-access', team: 'service-desk', assignee: 'alex-morgan', status: 'pending_approval', approver: 'mark-ellison' }),
  hero({ key: 'H5', requester: 'sam-doyle', channel: 'portal', type: 'incident', priority: 'P4', subcategory: 'monitor-dock', team: 'service-desk', assignee: 'alex-morgan', assignedBy: 'priya-shah', status: 'new', problem: 412, aiSuggestion: 'Known error PRB-0412: update the dock firmware.' }),
  hero({ key: 'H6', requester: 'kwame-mensah', channel: 'voice', type: 'incident', priority: 'P2', subcategory: 'sage-intacct', team: 'bizapps', assignee: 'liam-walsh', status: 'in_progress' }),
  hero({ key: 'H7', requester: 'oliver-grant', channel: 'teams', type: 'incident', priority: 'P2', subcategory: 'wifi', team: 'network', assignee: 'aisha-rahman', status: 'in_progress', problem: 413 }),
  hero({ key: 'H8', requester: 'megan-price', channel: 'email', type: 'incident', priority: 'P4', subcategory: 'printer', team: 'service-desk', assignee: null, status: 'new', aiSuggestion: 'Printer offline: re-add it from Settings.' }),
  hero({ key: 'H9', requester: 'zara-hussain', channel: 'portal', type: 'incident', priority: 'P3', subcategory: 'password-sign-in', team: 'service-desk', assignee: null, status: 'new' }),
  hero({ key: 'H10', requester: 'fatima-khan', channel: 'portal', type: 'request', priority: 'P4', subcategory: 'install-request', team: 'service-desk', assignee: null, status: 'new' }),
  hero({ key: 'H11', requester: 'emma-clarke', channel: 'portal', type: 'request', priority: 'P4', subcategory: 'joiners-leavers', team: 'service-desk', assignee: 'tom-fletcher', status: 'in_progress', requestItem: 'new-starter', tasks: [{ title: 'Account', team: 'identity', done: true }, { title: 'Licences', team: 'identity', done: true }, { title: 'Laptop', team: 'euc', done: false }, { title: 'Hand over', team: 'euc', done: false }] }),
  hero({ key: 'H12', requester: 'marcus-chen', channel: 'portal', type: 'incident', priority: 'P4', subcategory: 'monitor-dock', team: 'service-desk', assignee: 'alex-morgan', status: 'resolved', resolutionNote: 'Replaced the DisplayPort cable; no flicker since.' }),
  hero({ key: 'H13', requester: 'elena-kovacs', channel: 'email', type: 'incident', priority: 'P3', subcategory: 'mfa', team: 'network', assignee: 'aisha-rahman', status: 'resolved' }),
  hero({ key: 'A1', requester: 'ravi-patel', channel: 'portal', type: 'incident', priority: 'P3', subcategory: 'mailbox-drive-access', team: 'service-desk', assignee: 'alex-morgan', status: 'in_progress' }),
  hero({ key: 'A2', requester: 'fatima-khan', channel: 'portal', type: 'incident', priority: 'P3', subcategory: 'teams', team: 'service-desk', assignee: 'alex-morgan', status: 'in_progress' }),
  hero({ key: 'A3', requester: 'zara-hussain', channel: 'email', type: 'incident', priority: 'P2', subcategory: 'bamboohr', team: 'service-desk', assignee: 'alex-morgan', status: 'new' }),
  hero({ key: 'A4', requester: 'megan-price', channel: 'voice', type: 'incident', priority: 'P4', subcategory: 'mobile', team: 'service-desk', assignee: 'alex-morgan', status: 'pending_third_party' }),
  hero({ key: 'E1', requester: 'emma-clarke', channel: 'portal', type: 'incident', priority: 'P3', subcategory: 'onedrive-sharepoint', team: 'service-desk', assignee: 'grace-okafor', status: 'pending_requester' }),
  hero({ key: 'E2', requester: 'emma-clarke', channel: 'portal', type: 'request', priority: 'P4', subcategory: 'laptop', team: 'euc', assignee: 'ben-carter', status: 'in_progress', requestItem: 'laptop', approver: 'richard-hale' }),
  hero({ key: 'E3', requester: 'emma-clarke', channel: 'portal', type: 'request', priority: 'P4', subcategory: 'monitor-dock', team: 'service-desk', assignee: 'grace-okafor', status: 'new', requestItem: 'desk-equipment', tasks: [{ title: 'Deliver the monitor and dock', team: 'euc', done: false }] }),
  hero({ key: 'E4', requester: 'emma-clarke', channel: 'portal', type: 'incident', priority: 'P3', subcategory: 'office-apps', team: 'service-desk', assignee: 'grace-okafor', status: 'resolved' }),
];

const change = (number: number, value: Partial<ChangeContent> & Pick<ChangeContent, 'state' | 'when' | 'kind'>): ChangeContent => ({
  number,
  title: `Change ${number}`,
  description: `What change ${number} does.`,
  risk: 'low',
  impact: 'low',
  team: 'network',
  owner: 'daniel-hughes',
  service: 'network-vpn',
  ...value,
});

const changes: ChangeContent[] = [
  // 30 closed in the window: 18 standard, 10 normal (one backed out), 2 emergency.
  ...Array.from({ length: 30 }, (_, i) =>
    change(1151 + i, {
      kind: i < 18 ? 'standard' : i < 28 ? 'normal' : 'emergency',
      state: 'closed',
      closeCode: i === 20 ? 'backed_out' : 'successful',
      when: { kind: 'past', daysBeforeT0: 110 - i * 3, start: '19:00', minutes: 120 },
    }),
  ),
  change(1181, { kind: 'normal', state: 'scheduled', when: { kind: 'week', weekday: 'wed', weeksAhead: 0, start: '19:00', minutes: 120 }, maintenanceWindow: true }),
  change(1182, { kind: 'normal', state: 'scheduled', when: { kind: 'week', weekday: 'sat', weeksAhead: 0, start: '08:00', minutes: 240 }, maintenanceWindow: true, team: 'bizapps', owner: 'liam-walsh', service: 'finance-systems' }),
  change(1183, { kind: 'normal', state: 'scheduled', when: { kind: 'week', weekday: 'thu', weeksAhead: 0, start: '18:30', minutes: 150 } }),
  ...Array.from({ length: 4 }, (_, i) => change(1184 + i, { kind: 'standard', state: 'scheduled', when: { kind: 'week', weekday: 'tue', weeksAhead: (1 + (i % 2)) as 1 | 2, start: '18:00', minutes: 60 } })),
  change(1188, { kind: 'normal', state: 'submitted', risk: 'medium', when: { kind: 'week', weekday: 'tue', weeksAhead: 0, start: '19:00', minutes: 120 } }),
  change(1189, { kind: 'normal', state: 'submitted', risk: 'high', when: { kind: 'blackout', start: '19:00', minutes: 180 }, team: 'bizapps', owner: 'liam-walsh', service: 'warehouse-wms' }),
  change(1190, { kind: 'normal', state: 'draft', when: { kind: 'unscheduled' } }),
  change(1191, { kind: 'normal', state: 'draft', when: { kind: 'unscheduled' } }),
  change(1192, { kind: 'emergency', state: 'implementing', risk: 'high', when: { kind: 'live' }, majorIncident: 4, problem: 418 }),
];

const problem = (value: Omit<ProblemContent, 'title' | 'description' | 'priority'> & Partial<ProblemContent>): ProblemContent => ({
  title: `Problem ${value.number}`,
  description: `About problem ${value.number}.`,
  priority: 'P3',
  ...value,
});

const problems: ProblemContent[] = [
  problem({ number: 411, state: 'known_error', owner: 'grace-okafor', team: 'service-desk', service: 'microsoft-365', subcategory: 'outlook', links: [{ source: 'history', count: 14 }], workaroundArticle: 'outlook-password-prompt', raisedDaysBeforeT0: 70 }),
  problem({ number: 412, state: 'known_error', owner: 'ben-carter', team: 'euc', service: 'end-user-devices', subcategory: 'monitor-dock', links: [{ source: 'rollout', count: 6 }], heroes: ['H5'], workaroundArticle: 'dock-black-screen', raisedDaysBeforeT0: 45 }),
  problem({ number: 413, state: 'investigating', owner: 'aisha-rahman', team: 'network', service: 'network-vpn', subcategory: 'wifi', links: [{ source: 'history', count: 7 }], heroes: ['H7'], raisedDaysBeforeT0: 20 }),
  problem({ number: 414, state: 'resolved', owner: 'liam-walsh', team: 'bizapps', service: 'finance-systems', subcategory: 'sage-intacct', links: [{ source: 'major-incident', count: 6 }], majorIncident: 2, raisedDaysBeforeT0: 33 }),
  problem({ number: 415, state: 'investigating', owner: 'daniel-hughes', team: 'network', service: 'network-vpn', subcategory: 'teams', links: [{ source: 'history', count: 5 }], heroes: ['H2'], raisedDaysBeforeT0: 10 }),
  problem({ number: 416, state: 'resolved', owner: 'daniel-hughes', team: 'network', service: 'network-vpn', subcategory: 'site-connectivity', links: [{ source: 'major-incident', count: 14 }], majorIncident: 1, raisedDaysBeforeT0: 60 }),
  problem({ number: 417, state: 'closed', owner: 'chloe-nguyen', team: 'identity', service: 'identity-access', subcategory: 'app-access', links: [{ source: 'major-incident', count: 9 }], majorIncident: 3, raisedDaysBeforeT0: 12 }),
  problem({ number: 418, state: 'investigating', owner: 'daniel-hughes', team: 'network', service: 'network-vpn', subcategory: 'vpn', links: [{ source: 'major-incident', count: 0 }, { source: 'early-vpn', count: 2 }], majorIncident: 4, raisedDaysBeforeT0: 1 }),
];

export const FIXTURE_CONTENT: DemoContent = Object.freeze({
  titles,
  slots,
  replies,
  knowledge,
  people,
  holidays,
  csat,
  heroes,
  changes,
  problems,
});
