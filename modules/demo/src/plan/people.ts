import { DEMO_COMPANY, DEMO_PERSONAS } from '@itsm/contracts/demo';
import type { CastMember, DemoContent, FunctionKey, SiteKey, TeamKey } from './content-types.js';
import { STORY_CAST_KEYS, TEAM_KEYS } from './content-types.js';
import { TEAM_NAMES } from './model.js';
import { streamFor } from './rng.js';
import { NORTHWIND_CALENDAR_KEY } from './calendar.js';
import { dayNumber, DAY_MS } from './time.js';
import type { PlannedPerson, PlannedTeam } from './types.js';

/**
 * Northwind's 248 staff and the monitoring account (A4 §1.1, §1.13.6).
 *
 * The fixed cast comes from the content library; everyone else is drawn from
 * its lists of common British names with the plan's seed, unique, never
 * colliding with the cast, at `first.last@northwind.example` (a digit added on
 * a clash). Nobody here depends on T0, so a colleague is the same person in
 * every generation.
 */

/** Headcount by site and function (A4 §1.1): 248 in all. */
export const HEADCOUNT: readonly { readonly site: SiteKey; readonly function: FunctionKey; readonly people: number }[] = Object.freeze([
  { site: 'london', function: 'executive', people: 6 },
  { site: 'london', function: 'finance', people: 24 },
  { site: 'london', function: 'sales', people: 30 },
  { site: 'london', function: 'marketing', people: 14 },
  { site: 'london', function: 'hr', people: 10 },
  { site: 'london', function: 'legal', people: 12 },
  { site: 'london', function: 'it', people: 13 },
  { site: 'leeds', function: 'warehouse', people: 62 },
  { site: 'leeds', function: 'transport', people: 16 },
  { site: 'leeds', function: 'facilities', people: 4 },
  { site: 'bristol', function: 'customer-service', people: 36 },
  { site: 'bristol', function: 'quality', people: 5 },
  { site: 'field', function: 'field-sales', people: 16 },
]);

export const STAFF_TOTAL = 248;

/** Each function's director, to whom a generated team's manager reports. */
const DIRECTOR_OF: Readonly<Record<FunctionKey, string>> = Object.freeze({
  executive: 'victoria-lane',
  finance: 'richard-hale',
  sales: 'mark-ellison',
  marketing: 'mark-ellison',
  'field-sales': 'mark-ellison',
  hr: 'claire-donovan',
  legal: 'claire-donovan',
  it: 'jordan-lee',
  warehouse: 'gareth-pryce',
  transport: 'gareth-pryce',
  facilities: 'gareth-pryce',
  'customer-service': 'nadia-begum',
  quality: 'nadia-begum',
});

/** Join dates are fixed calendar days, so the People page reads the same every night. */
const JOINED_FROM = dayNumber('2015-01-05');
const JOINED_TO = dayNumber('2026-04-30');

export class ContentError extends Error {}

function joinedAt(seed: number, key: string): number {
  const rng = streamFor(seed, 'joined', key);
  const day = rng.int(JOINED_FROM, JOINED_TO);
  // Mid-morning on the day they started.
  return day * DAY_MS + rng.int(8 * 60, 11 * 60) * 60_000;
}

function emailFor(first: string, last: string, taken: Set<string>): string {
  const base = `${first}.${last}`
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z.]/g, '');
  for (let n = 1; ; n += 1) {
    const local = n === 1 ? base : `${base}${n}`;
    const email = `${local}@${DEMO_COMPANY.emailDomain}`;
    if (!taken.has(email)) {
      taken.add(email);
      return email;
    }
  }
}

/** Checks the cast against what the story needs of it; throws a `ContentError` naming the gap. */
export function assertCast(content: DemoContent): void {
  const byKey = new Map(content.people.cast.map((member) => [member.key, member]));
  for (const key of STORY_CAST_KEYS) {
    if (!byKey.has(key)) throw new ContentError(`the cast has no "${key}", whom the story needs`);
  }
  for (const persona of DEMO_PERSONAS) {
    const member = content.people.cast.find((candidate) => candidate.email === persona.email);
    if (!member) throw new ContentError(`no cast member has the persona e-mail ${persona.email}`);
    if (`${member.firstName} ${member.lastName}` !== persona.name) throw new ContentError(`${persona.email} must be named ${persona.name}`);
    const roles = [...(member.roles ?? ['requester'])].sort().join(',');
    if (roles !== [...persona.roles].sort().join(',')) throw new ContentError(`${persona.name} must hold exactly ${persona.roles.join(' + ')}`);
    if (persona.team && (member.team?.key !== persona.team.key || member.team.lead !== persona.team.lead)) {
      throw new ContentError(`${persona.name} must be ${persona.team.lead ? 'lead of' : 'in'} ${persona.team.key}`);
    }
  }
  for (const team of TEAM_KEYS) {
    const leads = content.people.cast.filter((member) => member.team?.key === team && member.team.lead);
    if (leads.length !== 1) throw new ContentError(`team ${team} needs exactly one lead, has ${leads.length}`);
  }
}

export interface PlannedOrganisation {
  readonly people: readonly PlannedPerson[];
  readonly teams: readonly PlannedTeam[];
}

/** Everyone, cast first, then the generated staff in a fixed order, then monitoring. */
export function planPeople(content: DemoContent, seed: number): PlannedOrganisation {
  assertCast(content);
  const taken = new Set<string>();
  const people: PlannedPerson[] = [];
  const castNames = new Set<string>();

  for (const member of content.people.cast) {
    taken.add(member.email.toLowerCase());
    castNames.add(`${member.firstName} ${member.lastName}`.toLowerCase());
    const persona = DEMO_PERSONAS.find((candidate) => candidate.email === member.email);
    people.push(castPerson(member, seed, persona?.key));
  }

  // Generated staff fill each (site, function) cell up to its headcount.
  const generatedTotal = Math.max(0, STAFF_TOTAL - content.people.cast.length);
  const cells = HEADCOUNT.map((cell) => ({
    ...cell,
    open: Math.max(0, cell.people - content.people.cast.filter((m) => m.site === cell.site && m.function === cell.function).length),
  }));
  const rng = streamFor(seed, 'people');
  const used = new Set<string>(castNames);
  let index = 0;
  for (const cell of cells) {
    let managerKey: string | null = null;
    for (let i = 0; i < cell.open && index < generatedTotal; i += 1) {
      let first = '';
      let last = '';
      for (let attempt = 0; attempt < 500; attempt += 1) {
        first = rng.pick(content.people.firstNames);
        last = rng.pick(content.people.surnames);
        if (!used.has(`${first} ${last}`.toLowerCase())) break;
      }
      used.add(`${first} ${last}`.toLowerCase());
      index += 1;
      const key = `gen-${String(index).padStart(3, '0')}`;
      // One generated manager per ten people, reporting to the function's director.
      const isManager = i % 10 === 0;
      const reportsTo: string = isManager || managerKey === null ? DIRECTOR_OF[cell.function] : managerKey;
      people.push({
        key,
        firstName: first,
        lastName: last,
        email: emailFor(first, last, taken),
        function: cell.function,
        site: cell.site,
        managerKey: reportsTo,
        roles: ['requester'],
        skills: [],
        createdAt: joinedAt(seed, key),
        kind: 'generated',
      });
      if (isManager) managerKey = key;
    }
  }

  const monitoring = content.people.monitoring;
  people.push({
    key: 'monitoring',
    firstName: monitoring.firstName,
    lastName: monitoring.lastName,
    email: monitoring.email,
    function: 'it',
    site: 'london',
    managerKey: null,
    roles: ['requester'],
    skills: [],
    createdAt: joinedAt(seed, 'monitoring'),
    kind: 'monitoring',
  });

  const teams: PlannedTeam[] = TEAM_KEYS.map((team) => {
    const members = people.filter((person) => person.team?.key === team);
    const lead = members.find((person) => person.team?.lead) as PlannedPerson;
    return {
      key: team,
      name: TEAM_NAMES[team],
      lead: lead.key,
      members: [lead.key, ...members.filter((person) => person.key !== lead.key).map((person) => person.key)],
      calendarKey: NORTHWIND_CALENDAR_KEY,
    };
  });

  return { people, teams };
}

function castPerson(member: CastMember, seed: number, persona: PlannedPerson['persona']): PlannedPerson {
  return {
    key: member.key,
    firstName: member.firstName,
    lastName: member.lastName,
    email: member.email,
    function: member.function,
    site: member.site,
    managerKey: member.managerKey,
    roles: [...(member.roles ?? ['requester'])],
    ...(member.team ? { team: { key: member.team.key, lead: member.team.lead } } : {}),
    skills: [...(member.skills ?? [])],
    createdAt: joinedAt(seed, member.key),
    ...(persona ? { persona } : {}),
    kind: 'cast',
  };
}

/** The agents of a team who take work from its queue: never Alex (his queue is the story's) nor anyone outside IT. */
export function workersOf(team: PlannedTeam, excluded: ReadonlySet<string>): string[] {
  const workers = team.members.filter((key) => !excluded.has(key));
  return workers.length > 0 ? workers : [...team.members];
}

export type { TeamKey };
