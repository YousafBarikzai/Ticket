import { DEMO_COMPANY, demoPersona, type DemoPersonaKey } from '@itsm/contracts/demo';
import type { CastMember, PeopleLibrary, TeamKey } from '../plan/content-types.js';

/**
 * Northwind's named people and the name lists the rest are drawn from
 * (A4 §1.1, §1.2, §1.13.6).
 *
 * The cast is the 43 people the story names: the six directors, the three
 * personas, Emma's six reports, the eleven other IT agents, the hero tickets'
 * requesters and the managers between them and the directors. The planner
 * draws the other 205 of the 248 staff from `firstNames` × `surnames` with
 * the build's seed, so a cast member is the same person in every generation
 * and a generated colleague is too.
 *
 * Everyone is fictional. Common British names are the point — a prospect
 * should recognise the shape of their own staff list — so the content test
 * also checks that no first name and surname here can be paired into a
 * well-known public figure. Every address is `first.last@northwind.example`
 * (RFC 2606: a message to it can never be delivered).
 *
 * The three personas are not typed here: their names, addresses, roles and
 * team come from `DEMO_PERSONAS`, the one table the sign-in, the frames and
 * the worker's repair job also read, so the cast cannot drift from it.
 */

const DOMAIN = DEMO_COMPANY.emailDomain;

/** A persona's cast entry, built from `DEMO_PERSONAS`. */
function persona(key: DemoPersonaKey, story: Pick<CastMember, 'key' | 'function' | 'site' | 'managerKey' | 'storyRole' | 'skills'>): CastMember {
  const found = demoPersona(key);
  if (!found) throw new RangeError(`no demo persona "${key}"`);
  const [firstName = '', ...rest] = found.name.split(' ');
  return {
    ...story,
    firstName,
    lastName: rest.join(' '),
    email: found.email,
    roles: [...found.roles],
    ...(found.team ? { team: { key: found.team.key as TeamKey, lead: found.team.lead } } : {}),
  };
}

export const PEOPLE = {
  cast: [
    /* ---------------------------------------------- Directors (London HQ, A4 §1.1) */
    { key: 'victoria-lane', firstName: 'Victoria', lastName: 'Lane', email: `victoria.lane@${DOMAIN}`, function: 'executive', site: 'london', managerKey: null, storyRole: 'Managing Director' },
    { key: 'richard-hale', firstName: 'Richard', lastName: 'Hale', email: `richard.hale@${DOMAIN}`, function: 'executive', site: 'london', managerKey: 'victoria-lane', storyRole: 'Finance Director; IT reports to him through Jordan' },
    { key: 'mark-ellison', firstName: 'Mark', lastName: 'Ellison', email: `mark.ellison@${DOMAIN}`, function: 'executive', site: 'london', managerKey: 'victoria-lane', storyRole: 'Sales Director; also looks after marketing and field sales' },
    { key: 'gareth-pryce', firstName: 'Gareth', lastName: 'Pryce', email: `gareth.pryce@${DOMAIN}`, function: 'executive', site: 'london', managerKey: 'victoria-lane', storyRole: 'Operations Director; runs the Leeds Distribution Centre and is in Leeds most of the week' },
    { key: 'nadia-begum', firstName: 'Nadia', lastName: 'Begum', email: `nadia.begum@${DOMAIN}`, function: 'executive', site: 'london', managerKey: 'victoria-lane', storyRole: 'Customer Service Director; runs the Bristol Customer Service Hub' },
    { key: 'claire-donovan', firstName: 'Claire', lastName: 'Donovan', email: `claire.donovan@${DOMAIN}`, function: 'executive', site: 'london', managerKey: 'victoria-lane', storyRole: 'HR Director; also looks after legal and procurement' },

    /* ---------------------------------------------- Finance: Emma and her six reports */
    persona('employee', { key: 'emma-clarke', function: 'finance', site: 'london', managerKey: 'richard-hale', storyRole: 'Finance Manager; line manager of six (Employee persona)' }),
    { key: 'marcus-chen', firstName: 'Marcus', lastName: 'Chen', email: `marcus.chen@${DOMAIN}`, function: 'finance', site: 'london', managerKey: 'emma-clarke', storyRole: 'Senior management accountant; has the ThinkPad from the finance refresh' },
    { key: 'olivia-bennett', firstName: 'Olivia', lastName: 'Bennett', email: `olivia.bennett@${DOMAIN}`, function: 'finance', site: 'london', managerKey: 'emma-clarke', storyRole: 'Financial analyst; wants Tableau for the margin dashboards' },
    { key: 'ravi-patel', firstName: 'Ravi', lastName: 'Patel', email: `ravi.patel@${DOMAIN}`, function: 'finance', site: 'london', managerKey: 'emma-clarke', storyRole: 'Accounts payable clerk; picks up supplier remittances' },
    { key: 'kwame-mensah', firstName: 'Kwame', lastName: 'Mensah', email: `kwame.mensah@${DOMAIN}`, function: 'finance', site: 'london', managerKey: 'emma-clarke', storyRole: 'Payroll officer; also sends the supplier payment run at month-end' },
    { key: 'lucy-turner', firstName: 'Lucy', lastName: 'Turner', email: `lucy.turner@${DOMAIN}`, function: 'finance', site: 'london', managerKey: 'emma-clarke', storyRole: 'Credit controller' },
    { key: 'hamza-ali', firstName: 'Hamza', lastName: 'Ali', email: `hamza.ali@${DOMAIN}`, function: 'finance', site: 'london', managerKey: 'emma-clarke', storyRole: 'Assistant accountant; builds the Power BI models' },

    /* ---------------------------------------------- IT: Jordan and the five teams (A4 §1.2) */
    persona('admin', { key: 'jordan-lee', function: 'it', site: 'london', managerKey: 'richard-hale', storyRole: 'IT Service Manager; owns all nine services, in no queue team (Admin persona)' }),
    persona('agent', {
      key: 'alex-morgan',
      function: 'it',
      site: 'london',
      managerKey: 'jordan-lee',
      storyRole: 'Service Desk team lead; late shift, 10:00–18:00 (Agent persona)',
      skills: [
        { key: 'windows', level: 3 },
        { key: 'exchange', level: 3 },
        { key: 'teams', level: 2 },
        { key: 'entra-id', level: 2 },
      ],
    }),
    {
      key: 'priya-shah', firstName: 'Priya', lastName: 'Shah', email: `priya.shah@${DOMAIN}`, function: 'it', site: 'london', managerKey: 'alex-morgan',
      storyRole: 'Service Desk analyst; early shift, 08:00–16:00', roles: ['agent'], team: { key: 'service-desk', lead: false },
      skills: [{ key: 'windows', level: 2 }, { key: 'exchange', level: 2 }, { key: 'teams', level: 3 }, { key: 'printing', level: 1 }],
    },
    {
      key: 'tom-fletcher', firstName: 'Tom', lastName: 'Fletcher', email: `tom.fletcher@${DOMAIN}`, function: 'it', site: 'london', managerKey: 'alex-morgan',
      storyRole: 'Service Desk analyst; late shift, 10:00–18:00; looks after new starters', roles: ['agent'], team: { key: 'service-desk', lead: false },
      skills: [{ key: 'windows', level: 2 }, { key: 'macos', level: 2 }, { key: 'printing', level: 2 }],
    },
    {
      key: 'grace-okafor', firstName: 'Grace', lastName: 'Okafor', email: `grace.okafor@${DOMAIN}`, function: 'it', site: 'london', managerKey: 'alex-morgan',
      storyRole: 'Service Desk analyst; early shift, 08:00–16:00; the team’s Excel and SharePoint expert', roles: ['agent'], team: { key: 'service-desk', lead: false },
      skills: [{ key: 'exchange', level: 2 }, { key: 'teams', level: 2 }, { key: 'windows', level: 1 }],
    },
    {
      key: 'ben-carter', firstName: 'Ben', lastName: 'Carter', email: `ben.carter@${DOMAIN}`, function: 'it', site: 'london', managerKey: 'jordan-lee',
      storyRole: 'End-User Computing lead', roles: ['agent', 'team_lead'], team: { key: 'euc', lead: true },
      skills: [{ key: 'windows', level: 3 }, { key: 'intune', level: 3 }, { key: 'macos', level: 2 }, { key: 'printing', level: 2 }],
    },
    {
      key: 'sofia-rossi', firstName: 'Sofia', lastName: 'Rossi', email: `sofia.rossi@${DOMAIN}`, function: 'it', site: 'london', managerKey: 'ben-carter',
      storyRole: 'End-User Computing engineer; builds the laptops', roles: ['agent'], team: { key: 'euc', lead: false },
      skills: [{ key: 'windows', level: 2 }, { key: 'intune', level: 2 }, { key: 'macos', level: 3 }, { key: 'printing', level: 1 }],
    },
    {
      key: 'daniel-hughes', firstName: 'Daniel', lastName: 'Hughes', email: `daniel.hughes@${DOMAIN}`, function: 'it', site: 'london', managerKey: 'jordan-lee',
      storyRole: 'Network & Infrastructure lead; on call this week; commands MI-0004', roles: ['agent', 'team_lead'], team: { key: 'network', lead: true },
      skills: [{ key: 'vpn', level: 3 }, { key: 'wifi', level: 3 }, { key: 'windows', level: 1 }],
    },
    {
      key: 'aisha-rahman', firstName: 'Aisha', lastName: 'Rahman', email: `aisha.rahman@${DOMAIN}`, function: 'it', site: 'london', managerKey: 'daniel-hughes',
      storyRole: 'Network engineer; owns the Leeds scanner problem; scribe on MI-0004', roles: ['agent'], team: { key: 'network', lead: false },
      skills: [{ key: 'wifi', level: 3 }, { key: 'vpn', level: 2 }, { key: 'wms', level: 1 }],
    },
    {
      key: 'liam-walsh', firstName: 'Liam', lastName: 'Walsh', email: `liam.walsh@${DOMAIN}`, function: 'it', site: 'london', managerKey: 'jordan-lee',
      storyRole: 'Business Applications lead; month-end cover for Sage Intacct', roles: ['agent', 'team_lead'], team: { key: 'bizapps', lead: true },
      skills: [{ key: 'sage-intacct', level: 3 }, { key: 'salesforce-admin', level: 2 }, { key: 'wms', level: 2 }],
    },
    {
      key: 'hannah-becker', firstName: 'Hannah', lastName: 'Becker', email: `hannah.becker@${DOMAIN}`, function: 'it', site: 'london', managerKey: 'liam-walsh',
      storyRole: 'Business applications analyst; Salesforce and BambooHR', roles: ['agent'], team: { key: 'bizapps', lead: false },
      skills: [{ key: 'salesforce-admin', level: 3 }, { key: 'bamboohr', level: 3 }, { key: 'sage-intacct', level: 1 }],
    },
    {
      key: 'chloe-nguyen', firstName: 'Chloe', lastName: 'Nguyen', email: `chloe.nguyen@${DOMAIN}`, function: 'it', site: 'london', managerKey: 'jordan-lee',
      storyRole: 'Identity & Security lead', roles: ['agent', 'team_lead'], team: { key: 'identity', lead: true },
      skills: [{ key: 'entra-id', level: 3 }, { key: 'phishing-triage', level: 2 }, { key: 'intune', level: 2 }],
    },
    {
      key: 'ryan-webb', firstName: 'Ryan', lastName: 'Webb', email: `ryan.webb@${DOMAIN}`, function: 'it', site: 'london', managerKey: 'chloe-nguyen',
      storyRole: 'Security analyst; on security call this week', roles: ['agent'], team: { key: 'identity', lead: false },
      skills: [{ key: 'phishing-triage', level: 3 }, { key: 'entra-id', level: 2 }, { key: 'vpn', level: 1 }],
    },

    /* ---------------------------------------------- Hero requesters outside Emma's team (A4 §1.13.3) */
    { key: 'elena-kovacs', firstName: 'Elena', lastName: 'Kovacs', email: `elena.kovacs@${DOMAIN}`, function: 'sales', site: 'london', managerKey: 'natalie-brooks', storyRole: 'Account manager on the 4th floor; lives on Teams calls' },
    { key: 'james-whitfield', firstName: 'James', lastName: 'Whitfield', email: `james.whitfield@${DOMAIN}`, function: 'sales', site: 'london', managerKey: 'natalie-brooks', storyRole: 'Sales analyst; keeps the forecasts on the S: drive' },
    { key: 'fatima-khan', firstName: 'Fatima', lastName: 'Khan', email: `fatima.khan@${DOMAIN}`, function: 'marketing', site: 'london', managerKey: 'mark-ellison', storyRole: 'Trade marketing lead; reports to Mark Ellison' },
    { key: 'sam-doyle', firstName: 'Sam', lastName: 'Doyle', email: `sam.doyle@${DOMAIN}`, function: 'legal', site: 'london', managerKey: 'aaron-fisher', storyRole: 'Procurement officer; hot-desks on the 3rd floor' },
    { key: 'oliver-grant', firstName: 'Oliver', lastName: 'Grant', email: `oliver.grant@${DOMAIN}`, function: 'warehouse', site: 'leeds', managerKey: 'helen-marsh', storyRole: 'Warehouse shift supervisor, Leeds' },
    { key: 'megan-price', firstName: 'Megan', lastName: 'Price', email: `megan.price@${DOMAIN}`, function: 'marketing', site: 'london', managerKey: 'chris-doherty', storyRole: 'Marketing coordinator; sits by the 3rd-floor printer' },
    { key: 'zara-hussain', firstName: 'Zara', lastName: 'Hussain', email: `zara.hussain@${DOMAIN}`, function: 'hr', site: 'london', managerKey: 'beth-wilson', storyRole: 'HR adviser; approves holiday in BambooHR' },

    /* ---------------------------------------------- Managers between the cast and the directors */
    { key: 'natalie-brooks', firstName: 'Natalie', lastName: 'Brooks', email: `natalie.brooks@${DOMAIN}`, function: 'sales', site: 'london', managerKey: 'mark-ellison', storyRole: 'Head of UK sales' },
    { key: 'sarah-ahmed', firstName: 'Sarah', lastName: 'Ahmed', email: `sarah.ahmed@${DOMAIN}`, function: 'field-sales', site: 'field', managerKey: 'mark-ellison', storyRole: 'Field sales manager, South West' },
    { key: 'chris-doherty', firstName: 'Chris', lastName: 'Doherty', email: `chris.doherty@${DOMAIN}`, function: 'marketing', site: 'london', managerKey: 'mark-ellison', storyRole: 'Marketing manager' },
    { key: 'aaron-fisher', firstName: 'Aaron', lastName: 'Fisher', email: `aaron.fisher@${DOMAIN}`, function: 'legal', site: 'london', managerKey: 'claire-donovan', storyRole: 'Head of legal and procurement' },
    { key: 'beth-wilson', firstName: 'Beth', lastName: 'Wilson', email: `beth.wilson@${DOMAIN}`, function: 'hr', site: 'london', managerKey: 'claire-donovan', storyRole: 'HR manager' },
    { key: 'helen-marsh', firstName: 'Helen', lastName: 'Marsh', email: `helen.marsh@${DOMAIN}`, function: 'warehouse', site: 'leeds', managerKey: 'gareth-pryce', storyRole: 'Warehouse operations manager, Leeds' },
    { key: 'craig-whitworth', firstName: 'Craig', lastName: 'Whitworth', email: `craig.whitworth@${DOMAIN}`, function: 'transport', site: 'leeds', managerKey: 'gareth-pryce', storyRole: 'Transport and logistics manager, Leeds' },
    { key: 'paul-osei', firstName: 'Paul', lastName: 'Osei', email: `paul.osei@${DOMAIN}`, function: 'facilities', site: 'leeds', managerKey: 'gareth-pryce', storyRole: 'Facilities supervisor, Leeds' },
    { key: 'rebecca-shaw', firstName: 'Rebecca', lastName: 'Shaw', email: `rebecca.shaw@${DOMAIN}`, function: 'customer-service', site: 'bristol', managerKey: 'nadia-begum', storyRole: 'Customer service team manager, Bristol' },
    { key: 'joanne-bradshaw', firstName: 'Joanne', lastName: 'Bradshaw', email: `joanne.bradshaw@${DOMAIN}`, function: 'quality', site: 'bristol', managerKey: 'nadia-begum', storyRole: 'Quality and compliance lead, Bristol' },
  ],

  /**
   * First names for the generated staff: common across the UK's ages and
   * backgrounds, as a 248-person distributor's would be.
   */
  firstNames: [
    'Amelia', 'Charlotte', 'Sophie', 'Jessica', 'Lauren', 'Rachel', 'Natasha', 'Holly', 'Bethany', 'Katie',
    'Georgia', 'Abigail', 'Freya', 'Imogen', 'Lily', 'Ruby', 'Isla', 'Poppy', 'Eleanor', 'Harriet',
    'Erin', 'Leah', 'Maisie', 'Ella', 'Siân', 'Cerys', 'Aoife', 'Niamh', 'Anjali', 'Amira',
    'Yasmin', 'Ayesha', 'Zainab', 'Sana', 'Chiamaka', 'Mei', 'Katarzyna', 'Gabriela', 'Kirsty', 'Gemma',
    'Fiona', 'Rhiannon', 'Oliver', 'Charlie', 'Thomas', 'Ethan', 'Callum', 'Connor', 'Josh', 'Max',
    'Rhys', 'Dylan', 'Euan', 'Fraser', 'Kieran', 'Declan', 'Arjun', 'Rohan', 'Imran', 'Bilal',
    'Yusuf', 'Tariq', 'Hassan', 'Kofi', 'Tunde', 'Emeka', 'Chidi', 'Wei', 'Tomasz', 'Piotr',
    'Nathan', 'Dominic', 'Darren', 'Sean',
  ],

  /** Surnames for the generated staff, drawn independently of the first name. */
  surnames: [
    'Taylor', 'Wilson', 'Evans', 'Roberts', 'Walker', 'Wright', 'Robinson', 'Edwards', 'Hall', 'Harris',
    'Jackson', 'Hill', 'Ward', 'Morris', 'Moore', 'Baker', 'Harrison', 'Kelly', 'Bell', 'Scott',
    'Murphy', 'Davies', 'Jenkins', 'Pritchard', 'Rees', 'Byrne', 'Quinn', 'McLean', 'Reid', 'Stewart',
    'Thomson', 'O’Brien', 'Begum', 'Hussain', 'Ahmed', 'Singh', 'Kaur', 'Sharma', 'Mistry', 'Iqbal',
    'Mahmood', 'Okoye', 'Adeyemi', 'Afolabi', 'Owusu', 'Nowak', 'Kowalski', 'Chen', 'Wong', 'Barker',
    'Pearson', 'Fox', 'Rowe', 'Sutton', 'Dixon', 'Kerr', 'Burns', 'Chapman', 'Marshall', 'Atkinson',
    'Booth', 'Palmer', 'Webster', 'Cartwright', 'Holloway', 'Ellis', 'Flynn', 'Lynch', 'Nolan', 'Carroll',
  ],

  monitoring: { firstName: 'Northwind', lastName: 'Monitoring', email: `monitoring@${DOMAIN}` },
} satisfies PeopleLibrary;
