import { DEMO_COMPANY, DEMO_PERSONAS, DEMO_SD_HEROES } from '@itsm/contracts/demo';
import { isSafeHref } from '@itsm/contracts/links';
import { describe, expect, it } from 'vitest';
import { CHANGES } from '../content/changes.js';
import { CSAT_VERBATIMS } from '../content/csat.js';
import { HEROES } from '../content/heroes.js';
import { BANK_HOLIDAYS } from '../content/holidays.js';
import { KNOWLEDGE } from '../content/knowledge.js';
import { PEOPLE } from '../content/people.js';
import { PROBLEMS } from '../content/problems.js';
import { REPLIES } from '../content/replies.js';
import { SLOTS, TITLES } from '../content/titles.js';
import {
  FIRST_CHANGE_NUMBER,
  HERO_KEYS,
  KNOWLEDGE_KEYS,
  LAST_CHANGE_NUMBER,
  LIVE_INCIDENT_ARTICLE,
  PROBLEM_NUMBERS,
  REPLY_KINDS,
  REPLY_SLOTS,
  SERVICE_KEYS,
  STORY_CAST_KEYS,
  SUBCATEGORY_KEYS,
  TEAM_KEYS,
  TICKET_SLOTS,
  categoryOfSubcategory,
  type CastMember,
  type DemoContent,
  type HeroContent,
  type TeamKey,
} from '../plan/content-types.js';

/**
 * The content library (A4 §1.13, SPEC WP-52b): the words a person would have
 * written, held to the rules the build's V10 and the story rely on. Every
 * check walks the whole library, so a line added later is held to the same
 * rules as the ones here today.
 */

const LIBRARY = {
  titles: TITLES,
  slots: SLOTS,
  replies: REPLIES,
  knowledge: KNOWLEDGE,
  people: PEOPLE,
  holidays: BANK_HOLIDAYS,
  csat: CSAT_VERBATIMS,
  heroes: HEROES,
  changes: CHANGES,
  problems: PROBLEMS,
} satisfies DemoContent;

/** Every string in a value, with where it sits. */
function stringsIn(value: unknown, path = ''): { path: string; text: string }[] {
  if (typeof value === 'string') return [{ path, text: value }];
  if (Array.isArray(value)) return value.flatMap((item, index) => stringsIn(item, `${path}[${index}]`));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, item]) => stringsIn(item, path ? `${path}.${key}` : key));
  return [];
}

/** Every `href` in a value, with where it sits. */
function hrefsIn(value: unknown, path = ''): { path: string; href: unknown }[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => hrefsIn(item, `${path}[${index}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) =>
      key === 'href' ? [{ path: `${path}.href`, href: item }] : hrefsIn(item, path ? `${path}.${key}` : key),
    );
  }
  return [];
}

const ALL_STRINGS = stringsIn(LIBRARY);
const SLOT = /\{([a-zA-Z]+)\}/g;
const slotsOf = (text: string) => [...text.matchAll(SLOT)].map((match) => match[1] as string);
/** The text with its permitted slots removed: whatever braces are left are defects. */
const withoutSlots = (text: string, allowed: readonly string[]) =>
  text.replace(SLOT, (whole, name: string) => (allowed.includes(name) ? '' : whole));

const castByKey = new Map<string, CastMember>(PEOPLE.cast.map((member) => [member.key, member]));
const fullName = (member: { firstName: string; lastName: string }) => `${member.firstName} ${member.lastName}`;
const teamOf = (key: string): TeamKey | undefined => castByKey.get(key)?.team?.key;

describe('the whole library', () => {
  it('is written in British English', () => {
    // A4 §1.13's list, and the other spellings a US-trained writer reaches for.
    const american: readonly RegExp[] = [
      /\bcolor(s|ed|ing|ful)?\b/i,
      /\borganiz/i,
      /\b(center|centers|centered)\b/i,
      /\bfavorite/i,
      /\bcancel(ed|ing)\b/i,
      /\blicenses?\b/i,
      /\bbehavior/i,
      /\b(analyz|realiz|apologiz|authoriz|customiz|prioritiz|optimiz|recogniz|summariz|minimiz|maximiz|utiliz|categoriz|synchroniz|finaliz|standardiz)/i,
      /\bcatalogs?\b/i,
      /\bgray\b/i,
      /\b(traveled|traveling|traveler)\b/i,
      /\b(labeled|labeling|modeled|modeling)\b/i,
      /\b(fulfill|fulfills|fulfillment)\b/i,
      /\b(enroll|enrollment)\b/i,
      /\b(defense|offense)\b/i,
      /\b(mom|vacation|cell ?phone|zip ?code|gotten|toward|percent|aluminum)\b/i,
    ];
    const found = ALL_STRINGS.flatMap(({ path, text }) => american.filter((pattern) => pattern.test(text)).map((pattern) => `${path}: ${pattern} in “${text}”`));
    expect(found).toEqual([]);
  });

  it('uses typographic apostrophes and quotation marks, as the product copy does', () => {
    const straight = ALL_STRINGS.filter(({ text }) => /['"]/.test(text)).map(({ path, text }) => `${path}: ${text}`);
    expect(straight).toEqual([]);
  });

  it('has no doubled, leading or trailing spaces', () => {
    // An article's line is made of inline runs ("Open ", bold "Company Portal", " and …"),
    // so its runs are joined before they are checked.
    const run = /\.body\[\d+\]\.(content|items\[\d+\])\[\d+\]\.text$/;
    const lines = KNOWLEDGE.flatMap((article) =>
      article.body.flatMap((block, index) =>
        (block.type === 'paragraph' ? [block.content] : block.items).map((line) => ({
          path: `${article.key}.body[${index}]`,
          text: line.map((inline) => inline.text).join(''),
        })),
      ),
    );
    const untidy = [...ALL_STRINGS.filter(({ path }) => !run.test(path)), ...lines].filter(({ text }) => /  |^\s|\s$/.test(text)).map(({ path }) => path);
    expect(untidy).toEqual([]);
  });

  it('gives every e-mail address on northwind.example (RFC 2606), so nothing can ever be delivered', () => {
    const addresses = ALL_STRINGS.flatMap(({ path, text }) =>
      [...text.matchAll(/[A-Za-z0-9.’+_-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*/g)].map((match) => ({ path, address: match[0] })),
    );
    expect(addresses.length).toBeGreaterThan(48);
    const elsewhere = addresses.filter(({ address }) => !address.endsWith(`@${DEMO_COMPANY.emailDomain}`));
    expect(elsewhere).toEqual([]);
  });

  it('names the company exactly as “Northwind Traders (UK)” wherever it gives the full name', () => {
    expect(DEMO_COMPANY.name).toBe('Northwind Traders (UK)');
    const mentions = ALL_STRINGS.flatMap(({ path, text }) => [...text.matchAll(/Northwind\s+Trad\w*(\s*\(?UK\)?)?/g)].map((match) => ({ path, said: match[0] })));
    expect(mentions.length).toBeGreaterThan(0);
    expect(mentions.filter(({ said }) => said !== DEMO_COMPANY.name)).toEqual([]);
  });

  it('links only to https: or mailto: addresses, all of them fictional (D23)', () => {
    const links = hrefsIn(LIBRARY);
    expect(links.length).toBeGreaterThan(0);
    for (const { path, href } of links) {
      expect(isSafeHref(href), path).toBe(true);
      const url = new URL(href as string);
      if (url.protocol === 'mailto:') expect(url.pathname.endsWith(`@${DEMO_COMPANY.emailDomain}`), path).toBe(true);
      else {
        expect(url.protocol, path).toBe('https:');
        expect(url.hostname.endsWith('.example'), path).toBe(true);
      }
    }
    // And no link hides in plain text either.
    expect(ALL_STRINGS.filter(({ text }) => /\b(?:https?|ftp|file):\/\/|\b(?:javascript|data|vbscript):\S/i.test(text)).map(({ path }) => path)).toEqual([]);
  });

  it('leaves no brace that a template fill would not consume (V10)', () => {
    const allowedAt = (path: string): readonly string[] => {
      if (path.startsWith('titles.')) return TICKET_SLOTS;
      if (path.startsWith('replies.')) return REPLY_SLOTS;
      if (path.startsWith('csat.')) return ['agent'];
      // A hero's description, thread and resolution note are filled with the
      // requester's and the assignee's first names; its title is not filled.
      if (/^heroes\[\d+\]\.(description|resolutionNote|thread\[\d+\]\.body)$/.test(path)) return REPLY_SLOTS;
      return [];
    };
    const defects = ALL_STRINGS.filter(({ path, text }) => /[{}]/.test(withoutSlots(text, allowedAt(path)))).map(({ path, text }) => `${path}: ${text}`);
    expect(defects).toEqual([]);
  });

  it('names no well-known public figure, in the content or in any pairing of the name lists', () => {
    const named = ALL_STRINGS.flatMap(({ path, text }) =>
      WELL_KNOWN.filter((name) => new RegExp(`\\b${name}\\b`, 'i').test(text)).map((name) => `${path}: ${name}`),
    );
    expect(named).toEqual([]);
    expect(PEOPLE.cast.map(fullName).filter((name) => WELL_KNOWN.includes(name.toLowerCase()))).toEqual([]);
    const pairs = PEOPLE.firstNames.flatMap((first) =>
      PEOPLE.surnames.filter((last) => WELL_KNOWN.includes(`${first} ${last}`.toLowerCase())).map((last) => `${first} ${last}`),
    );
    expect(pairs).toEqual([]);
  });

  it('keeps within the lengths the product accepts', () => {
    for (const { path, text } of ALL_STRINGS) {
      if (/\.title$|titles\[\d+\]$/.test(path)) expect(text.length, path).toBeLessThanOrEqual(200);
      expect(text.length, path).toBeLessThanOrEqual(20_000);
    }
  });
});

describe('titles and slots', () => {
  it('covers every subcategory with at least 12 titles and 4 description templates (A4 §1.13.1)', () => {
    expect(Object.keys(TITLES).sort()).toEqual([...SUBCATEGORY_KEYS].sort());
    for (const subcategory of SUBCATEGORY_KEYS) {
      const text = TITLES[subcategory];
      expect(text.titles.length, subcategory).toBeGreaterThanOrEqual(12);
      expect(new Set(text.titles).size, `${subcategory} titles are unique`).toBe(text.titles.length);
      expect(text.descriptions.length, subcategory).toBeGreaterThanOrEqual(4);
      expect(new Set(text.descriptions).size, `${subcategory} descriptions are unique`).toBe(text.descriptions.length);
    }
  });

  it('writes the phoned-in templates as the agent’s note of the call', () => {
    for (const subcategory of SUBCATEGORY_KEYS) {
      for (const note of TITLES[subcategory].phoned ?? []) expect(note, subcategory).toMatch(/^(Called in|Phoned the desk)\b/);
    }
  });

  it('fills every template from the slot bank without leaving a brace behind', () => {
    const sample: Record<string, readonly string[]> = { ...SLOTS, device: ['NW-LT-0241'], colleague: ['Rachel'] };
    for (const subcategory of SUBCATEGORY_KEYS) {
      const text = TITLES[subcategory];
      for (const template of [...text.titles, ...text.descriptions, ...(text.phoned ?? [])]) {
        for (const slot of slotsOf(template)) expect(TICKET_SLOTS as readonly string[], `${subcategory}: {${slot}}`).toContain(slot);
        // Every value of every slot the template uses.
        for (let i = 0; i < 8; i += 1) {
          const filled = template.replace(SLOT, (_, name: string) => {
            const values = sample[name] as readonly string[];
            return values[i % values.length] as string;
          });
          expect(filled, template).not.toMatch(/[{}]/);
          // A slot value never starts a sentence: they are written in lower case or as names.
          expect(filled[0], template).toBe(filled[0]?.toUpperCase());
        }
      }
    }
  });

  it('offers values for every slot the content supplies, unique within each bank', () => {
    for (const [slot, values] of Object.entries(SLOTS)) {
      expect(values.length, slot).toBeGreaterThanOrEqual(3);
      expect(new Set(values).size, slot).toBe(values.length);
    }
    expect([...SLOTS.room].sort()).toEqual(['Aire', 'Avon', 'Severn', 'Thames']);
  });
});

describe('replies', () => {
  const agentKinds = ['firstResponse', 'update', 'clarifying', 'thirdParty', 'internalNote', 'resolution', 'isItFixed'] as const;
  const requesterKinds = ['requesterPositive', 'requesterMoreInfo', 'requesterFrustrated', 'reopen', 'cancelled'] as const;

  it('has at least three of every kind, and nothing else', () => {
    expect(REPLIES.update.length).toBeGreaterThanOrEqual(8);
    for (const kind of REPLY_KINDS) {
      expect(REPLIES[kind].length, kind).toBeGreaterThanOrEqual(3);
      expect(new Set(REPLIES[kind]).size, kind).toBe(REPLIES[kind].length);
    }
    expect([...agentKinds, ...requesterKinds].sort()).toEqual([...REPLY_KINDS].sort());
  });

  it('gives every subcategory its own first answers, updates, notes and resolutions', () => {
    const banks = REPLIES.bySubcategory ?? {};
    expect(Object.keys(banks).sort()).toEqual([...SUBCATEGORY_KEYS].sort());
    for (const subcategory of SUBCATEGORY_KEYS) {
      const own = banks[subcategory] ?? {};
      for (const kind of ['firstResponse', 'internalNote', 'resolution'] as const) {
        expect(own[kind]?.length ?? 0, `${subcategory}.${kind}`).toBeGreaterThanOrEqual(2);
      }
      // A ticket draws several updates, so a short bank repeats itself within one thread.
      expect(own.update?.length ?? 0, `${subcategory}.update`).toBeGreaterThanOrEqual(4);
    }
  });

  it('lets agents greet the requester and requesters thank the agent, never the other way round', () => {
    const agentLines = [
      ...agentKinds.flatMap((kind) => REPLIES[kind]),
      ...Object.values(REPLIES.bySubcategory ?? {}).flatMap((banks) => Object.values(banks ?? {}).flat()),
    ];
    for (const line of agentLines) expect(line, line).not.toContain('{agent}');
    for (const line of requesterKinds.flatMap((kind) => REPLIES[kind])) expect(line, line).not.toContain('{first}');
  });
});

describe('CSAT comments', () => {
  it('holds about 80 comments in three tones, mostly positive as real surveys are (A4 §1.13.5)', () => {
    const counts = Object.fromEntries(Object.entries(CSAT_VERBATIMS).map(([tone, lines]) => [tone, lines.length]));
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    expect(total).toBeGreaterThanOrEqual(75);
    expect(total).toBeLessThanOrEqual(90);
    expect(counts.positive).toBeGreaterThan(counts.neutral as number);
    expect(counts.neutral).toBeGreaterThanOrEqual(10);
    expect(counts.negative).toBeGreaterThanOrEqual(10);
    for (const lines of Object.values(CSAT_VERBATIMS)) expect(new Set(lines).size).toBe(lines.length);
  });

  it('uses only the resolver’s first name', () => {
    for (const line of Object.values(CSAT_VERBATIMS).flat()) for (const slot of slotsOf(line)) expect(slot).toBe('agent');
  });
});

describe('people', () => {
  it('has the 43 named people of the story, every key the planner needs among them (A4 §1.13.6)', () => {
    expect(PEOPLE.cast).toHaveLength(43);
    expect(new Set(PEOPLE.cast.map((member) => member.key)).size).toBe(43);
    for (const key of STORY_CAST_KEYS) expect(castByKey.has(key), key).toBe(true);
  });

  it('keys and addresses everyone as first-last and first.last@northwind.example', () => {
    const plain = (name: string) => name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
    for (const member of PEOPLE.cast) {
      expect(member.key, member.key).toBe(`${plain(member.firstName)}-${plain(member.lastName)}`);
      expect(member.email, member.key).toBe(`${plain(member.firstName)}.${plain(member.lastName)}@${DEMO_COMPANY.emailDomain}`);
    }
    expect(new Set(PEOPLE.cast.map(fullName)).size).toBe(43);
    expect(PEOPLE.monitoring).toEqual({ firstName: 'Northwind', lastName: 'Monitoring', email: `monitoring@${DEMO_COMPANY.emailDomain}` });
  });

  it('gives each persona exactly the name, address, roles and team of DEMO_PERSONAS', () => {
    for (const persona of DEMO_PERSONAS) {
      const member = PEOPLE.cast.find((candidate) => candidate.email === persona.email);
      expect(member, persona.key).toBeDefined();
      expect(fullName(member as CastMember)).toBe(persona.name);
      expect([...((member as CastMember).roles ?? ['requester'])].sort()).toEqual([...persona.roles].sort());
      expect((member as CastMember).team ?? null).toEqual(persona.team ?? null);
    }
  });

  it('staffs the five teams as A4 §1.2 does, one lead each', () => {
    const members = (team: TeamKey) => PEOPLE.cast.filter((member) => member.team?.key === team).map((member) => `${member.key}${member.team?.lead ? '*' : ''}`);
    expect(Object.fromEntries(TEAM_KEYS.map((team) => [team, members(team)]))).toEqual({
      'service-desk': ['alex-morgan*', 'priya-shah', 'tom-fletcher', 'grace-okafor'],
      euc: ['ben-carter*', 'sofia-rossi'],
      network: ['daniel-hughes*', 'aisha-rahman'],
      bizapps: ['liam-walsh*', 'hannah-becker'],
      identity: ['chloe-nguyen*', 'ryan-webb'],
    });
    for (const member of PEOPLE.cast.filter((candidate) => candidate.team)) {
      const roles = [...(member.roles ?? [])].sort();
      expect(roles, member.key).toEqual(member.team?.lead ? ['agent', 'team_lead'] : ['agent']);
      const skills = member.skills ?? [];
      expect(skills.length, member.key).toBeGreaterThanOrEqual(2);
      expect(skills.length, member.key).toBeLessThanOrEqual(5);
      expect(new Set(skills.map((skill) => skill.key)).size, member.key).toBe(skills.length);
    }
    // Jordan Lee is in no queue team (A4 §1.2), and nobody outside IT has a skill.
    expect(castByKey.get('jordan-lee')?.team).toBeUndefined();
    for (const member of PEOPLE.cast.filter((candidate) => !candidate.team)) expect(member.skills ?? [], member.key).toEqual([]);
  });

  it('wires the reporting lines the approval policies follow (A4 §1.1)', () => {
    const managerOf = (key: string) => castByKey.get(key)?.managerKey;
    expect(PEOPLE.cast.filter((member) => member.managerKey === null).map((member) => member.key)).toEqual(['victoria-lane']);
    for (const member of PEOPLE.cast) {
      if (member.managerKey !== null) expect(castByKey.has(member.managerKey), `${member.key} → ${member.managerKey}`).toBe(true);
      // No loops: everyone reaches the Managing Director.
      let cursor: string | null | undefined = member.key;
      for (let step = 0; step < 10 && cursor; step += 1) cursor = managerOf(cursor);
      expect(cursor ?? null, member.key).toBeNull();
    }
    expect(['marcus-chen', 'olivia-bennett', 'ravi-patel', 'kwame-mensah', 'lucy-turner', 'hamza-ali'].map(managerOf)).toEqual(Array(6).fill('emma-clarke'));
    expect(managerOf('emma-clarke')).toBe('richard-hale');
    expect(managerOf('jordan-lee')).toBe('richard-hale');
    for (const member of PEOPLE.cast.filter((candidate) => candidate.team)) {
      const lead = PEOPLE.cast.find((candidate) => candidate.team?.key === member.team?.key && candidate.team?.lead) as CastMember;
      expect(member.managerKey, member.key).toBe(member.team?.lead ? 'jordan-lee' : lead.key);
    }
  });

  it('fits the cast inside the headcount of each site and function (A4 §1.1)', () => {
    const headcount: Record<string, number> = {
      'london/executive': 6, 'london/finance': 24, 'london/sales': 30, 'london/marketing': 14, 'london/hr': 10, 'london/legal': 12, 'london/it': 13,
      'leeds/warehouse': 62, 'leeds/transport': 16, 'leeds/facilities': 4, 'bristol/customer-service': 36, 'bristol/quality': 5, 'field/field-sales': 16,
    };
    expect(Object.values(headcount).reduce((sum, n) => sum + n, 0)).toBe(248);
    const cast: Record<string, number> = {};
    for (const member of PEOPLE.cast) cast[`${member.site}/${member.function}`] = (cast[`${member.site}/${member.function}`] ?? 0) + 1;
    for (const [cell, people] of Object.entries(cast)) expect(people, cell).toBeLessThanOrEqual(headcount[cell] ?? 0);
    // IT is the cast and only the cast: Jordan and the twelve agents.
    expect(cast['london/it']).toBe(13);
  });

  it('draws the other 205 from lists long enough to stay unique', () => {
    for (const list of [PEOPLE.firstNames, PEOPLE.surnames]) {
      expect(list.length).toBeGreaterThanOrEqual(60);
      expect(new Set(list).size).toBe(list.length);
      for (const name of list) expect(name, name).toMatch(/^\p{Lu}[\p{L}’-]+$/u);
    }
    const castNames = new Set(PEOPLE.cast.map((member) => fullName(member).toLowerCase()));
    const free = PEOPLE.firstNames.length * PEOPLE.surnames.length - [...castNames].length;
    expect(free).toBeGreaterThan(20 * 205);
  });
});

describe('heroes', () => {
  const byKey = new Map<string, HeroContent>(HEROES.map((hero) => [hero.key, hero]));
  const hero = (key: string) => byKey.get(key) as HeroContent;

  it('tells every hero once, under a presenter’s name', () => {
    expect(HEROES.map((h) => h.key).sort()).toEqual([...HERO_KEYS].sort());
    expect(new Set(HEROES.map((h) => h.name)).size).toBe(HEROES.length);
    for (const h of HEROES) expect(h.name, h.key).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('routes every DEMO_SD_HEROES hero through the Service Desk, and the rest to the team that works them (R8, X-B2)', () => {
    for (const key of DEMO_SD_HEROES) expect(hero(key).team, key).toBe('service-desk');
    expect(Object.fromEntries(HEROES.filter((h) => !(DEMO_SD_HEROES as readonly string[]).includes(h.key)).map((h) => [h.key, h.team]))).toEqual({
      H6: 'bizapps',
      H7: 'network',
      H13: 'network',
      E2: 'euc',
    });
  });

  it('makes E3 a desk-equipment request the Service Desk owns, with End-User Computing doing the work', () => {
    const e3 = hero('E3');
    expect(e3).toMatchObject({ type: 'request', requestItem: 'desk-equipment', team: 'service-desk', status: 'new', requester: 'emma-clarke' });
    expect(e3.tasks?.map((task) => task.team)).toEqual(['euc']);
  });

  it('names only the cast, and assigns each hero to someone in its team', () => {
    for (const h of HEROES) {
      for (const key of [h.requester, h.assignee, h.assignedBy, h.approver].filter((k): k is string => typeof k === 'string')) {
        expect(castByKey.has(key), `${h.key}: ${key}`).toBe(true);
      }
      for (const message of h.thread) {
        if (message.author !== 'requester' && message.author !== 'assignee') expect(castByKey.has(message.author), `${h.key}: ${message.author}`).toBe(true);
      }
      if (h.assignee) expect(teamOf(h.assignee), h.key).toBe(h.team);
      expect(categoryOfSubcategory(h.subcategory), h.key).toBeTruthy();
    }
  });

  it('gives Alex Morgan the first screen A4 §1.12 describes', () => {
    const open = HEROES.filter((h) => h.assignee === 'alex-morgan' && h.status !== 'resolved');
    expect(open.map((h) => h.key).sort()).toEqual(['A1', 'A2', 'A3', 'A4', 'H1', 'H2', 'H3', 'H4', 'H5']);
    const byPriority = (p: string) => open.filter((h) => h.priority === p).length;
    expect([byPriority('P2'), byPriority('P3'), byPriority('P4')]).toEqual([2, 4, 3]);
    expect(open.filter((h) => h.status.startsWith('pending_')).map((h) => `${h.key}:${h.status}`).sort()).toEqual([
      'A4:pending_third_party',
      'H3:pending_requester',
      'H4:pending_approval',
    ]);
    // H1's customer replied last; H5 was handed to Alex by Priya; A3 is new but his.
    expect(hero('H1').thread.at(-1)?.author).toBe('requester');
    expect(hero('H5')).toMatchObject({ status: 'new', assignedBy: 'priya-shah', problem: 412 });
    expect(hero('A3')).toMatchObject({ status: 'new', priority: 'P2' });
    // The Service Desk's unassigned heroes, and the one he resolved.
    expect(HEROES.filter((h) => h.team === 'service-desk' && h.assignee === null).map((h) => h.key).sort()).toEqual(['H10', 'H8', 'H9']);
    expect(HEROES.filter((h) => h.assignee === 'alex-morgan' && h.status === 'resolved').map((h) => h.key)).toEqual(['H12']);
  });

  it('gives Emma Clarke her four open requests and one “Is it fixed?” (A4 §1.12)', () => {
    const emma = HEROES.filter((h) => h.requester === 'emma-clarke');
    expect(Object.fromEntries(emma.map((h) => [h.key, h.status]))).toEqual({
      H11: 'in_progress',
      E1: 'pending_requester',
      E2: 'in_progress',
      E3: 'new',
      E4: 'resolved',
    });
    expect(hero('E1').assignee).toBe('grace-okafor');
    expect(hero('E4').assignee).toBe('grace-okafor');
    expect(hero('E2')).toMatchObject({ requestItem: 'laptop', approver: 'richard-hale', team: 'euc' });
    const tasks = hero('H11').tasks ?? [];
    expect([tasks.filter((task) => task.done).length, tasks.length]).toEqual([2, 4]);
    expect(hero('H11')).toMatchObject({ requestItem: 'new-starter', assignee: 'tom-fletcher' });
  });

  it('asks each approval of the requester’s line manager', () => {
    for (const h of HEROES.filter((candidate) => candidate.approver)) {
      expect(castByKey.get(h.requester)?.managerKey, h.key).toBe(h.approver);
    }
    expect(hero('H4')).toMatchObject({ status: 'pending_approval', approver: 'mark-ellison', requestItem: 'salesforce-licence' });
  });

  it('carries a sample AI suggestion on H5 and H8 only, and a resolution note on every resolved hero', () => {
    expect(HEROES.filter((h) => h.aiSuggestion).map((h) => h.key).sort()).toEqual(['H5', 'H8']);
    for (const h of HEROES) expect(Boolean(h.resolutionNote), h.key).toBe(h.status === 'resolved');
  });

  it('never lets an unanswered hero carry an answer', () => {
    for (const h of (HEROES as readonly HeroContent[]).filter((candidate) => candidate.status === 'new')) {
      expect(h.thread.filter((message) => message.author !== 'requester' && message.visibility === 'public'), h.key).toEqual([]);
    }
  });

  it('agrees with the problems about which heroes they explain', () => {
    const fromHeroes = HEROES.filter((h) => h.problem).map((h) => `${h.key}→${h.problem}`).sort();
    const fromProblems = PROBLEMS.flatMap((problem) => (problem.heroes ?? []).map((key) => `${key}→${problem.number}`)).sort();
    expect(fromHeroes).toEqual(fromProblems);
    expect(fromHeroes).toEqual(['H2→415', 'H5→412', 'H7→413']);
  });

  it('fills the custom fields with the values the field definitions offer (A4 §1.3)', () => {
    for (const h of HEROES) {
      if (h.custom?.site) expect(['London HQ', 'Leeds DC', 'Bristol hub', 'Remote'], h.key).toContain(h.custom.site);
      if (h.custom?.assetTag) {
        expect(h.custom.assetTag, h.key).toMatch(/^NW-LT-\d{4}$/);
        // 245 laptops, NW-LT-0001 … NW-LT-0245 (A4 §1.6).
        expect(Number(h.custom.assetTag.slice(6)), h.key).toBeLessThanOrEqual(245);
      }
      if (h.custom?.affectedUsers !== undefined) expect(h.custom.affectedUsers, h.key).toBeLessThanOrEqual(250);
    }
  });
});

describe('knowledge', () => {
  const byKey = new Map(KNOWLEDGE.map((article) => [article.key as string, article]));
  const published = KNOWLEDGE.filter((article) => article.state === 'published');

  it('holds the 24 published articles, one draft and one in review (A4 §1.5)', () => {
    expect(KNOWLEDGE.map((article) => article.key).sort()).toEqual([...KNOWLEDGE_KEYS].sort());
    expect(published).toHaveLength(24);
    expect(published.filter((article) => article.audience === 'all')).toHaveLength(18);
    expect(KNOWLEDGE.filter((article) => article.state !== 'published').map((article) => `${article.key}:${article.state}`).sort()).toEqual([
      'expenses-sage:in_review',
      'ricoh-printers:draft',
    ]);
  });

  it('keeps the six runbooks internal and everything else for all staff', () => {
    for (const article of KNOWLEDGE) {
      const runbook = article.key.startsWith('rb-');
      expect(article.category === 'runbooks', article.key).toBe(runbook);
      expect(article.audience, article.key).toBe(runbook ? 'internal' : 'all');
    }
  });

  it('reuses the portal seed’s eight articles verbatim and writes the other eighteen', () => {
    expect(KNOWLEDGE.filter((article) => article.reused).map((article) => article.key).sort()).toEqual([
      'email-on-phone',
      'mapped-drive-missing',
      'office-wifi',
      'outlook-password-prompt',
      'password-policy',
      'printer-offline',
      'travel-devices',
      'vpn-from-home',
    ]);
  });

  it('shows the reading counts and helpfulness a used knowledge base has', () => {
    for (const article of published) {
      expect(article.helpfulPercent, article.key).toBeGreaterThanOrEqual(78);
      expect(article.helpfulPercent, article.key).toBeLessThanOrEqual(94);
      if (article.key !== LIVE_INCIDENT_ARTICLE) {
        expect(article.publishedDaysAgo, article.key).toBeGreaterThan(0);
        expect(article.publishedDaysAgo, article.key).toBeLessThanOrEqual(270);
      }
    }
    for (const article of KNOWLEDGE.filter((candidate) => candidate.state !== 'published')) {
      expect([article.views, article.helpfulPercent], article.key).toEqual([0, 0]);
    }
    // Emma's "Popular answers" (A4 §1.12): the three most read, for all staff.
    const views = (article: (typeof KNOWLEDGE)[number]) => (typeof article.views === 'number' ? article.views : article.views.night);
    const popular = [...published].filter((article) => article.audience === 'all').sort((a, b) => views(b) - views(a)).slice(0, 3);
    expect(popular.map((article) => `${article.key}:${views(article)}`)).toEqual(['vpn-from-home:412', 'authenticator-new-phone:351', 'dock-black-screen:268']);
    expect(byKey.get(LIVE_INCIDENT_ARTICLE)?.views).toEqual({ day: 37, night: 84 });
  });

  it('gives the live incident’s article its three steps and its closing line (A4 §1.5)', () => {
    const article = byKey.get(LIVE_INCIDENT_ARTICLE);
    const text = (inlines: readonly { text: string }[]) => inlines.map((inline) => inline.text).join('');
    const list = article?.body.find((block) => block.type === 'list');
    expect(list?.type === 'list' && list.ordered).toBe(true);
    expect(list?.type === 'list' ? list.items.map(text) : []).toEqual([
      'Disconnect, then sign out of the VPN client.',
      'Open Microsoft Authenticator and approve the pending request.',
      'Connect again and choose Northwind-Remote-2.',
    ]);
    const last = article?.body.at(-1);
    expect(last?.type === 'paragraph' ? text(last.content) : '').toBe(
      'If it still fails, you don’t need to raise a ticket — we’re already working on it. Follow MI-0004 on the status page.',
    );
  });

  it('builds every body from well-formed blocks, and every field from what the API accepts', () => {
    for (const article of KNOWLEDGE) {
      expect(article.key).toMatch(/^[a-z][a-z0-9-]{1,62}$/);
      expect(article.summary.length, article.key).toBeLessThanOrEqual(500);
      expect(article.keywords.length, article.key).toBeLessThanOrEqual(20);
      for (const keyword of article.keywords) expect(keyword.length, article.key).toBeLessThanOrEqual(60);
      if (article.service) expect(SERVICE_KEYS as readonly string[], article.key).toContain(article.service);
      expect(article.body.length, article.key).toBeGreaterThan(0);
      for (const block of article.body) {
        const lines = block.type === 'paragraph' ? [block.content] : block.items;
        expect(lines.length, article.key).toBeGreaterThan(0);
        for (const line of lines) for (const inline of line) expect(inline.text.length, article.key).toBeGreaterThan(0);
      }
    }
  });

  it('names only articles that exist when the story points people at one', () => {
    const titles = new Set(KNOWLEDGE.map((article) => article.title));
    const quoted = [...HEROES.flatMap((h) => [h.aiSuggestion ?? '', ...h.thread.map((m) => m.body)]), ...PROBLEMS.map((p) => p.workaround ?? '')]
      .flatMap((text) => [...text.matchAll(/(?:article|steps in|workaround in|point them to|See) “([^”]+)”/g)].map((match) => match[1] as string));
    expect(quoted.length).toBeGreaterThanOrEqual(6);
    for (const title of quoted) expect(titles.has(title), title).toBe(true);
    for (const problem of PROBLEMS) {
      if (problem.workaroundArticle) expect(byKey.get(problem.workaroundArticle)?.state, `PRB-0${problem.number}`).toBe('published');
    }
  });
});

describe('problems', () => {
  it('numbers the eight PRB-0411 … PRB-0418 in the states A4 §1.9.1 gives', () => {
    expect(PROBLEMS.map((problem) => problem.number)).toEqual([...PROBLEM_NUMBERS]);
    expect(PROBLEMS.map((problem) => problem.state)).toEqual([
      'known_error',
      'known_error',
      'investigating',
      'resolved',
      'investigating',
      'resolved',
      'closed',
      'investigating',
    ]);
    expect(Object.fromEntries(PROBLEMS.filter((p) => p.majorIncident).map((p) => [p.number, p.majorIncident]))).toEqual({ 414: 2, 416: 1, 417: 3, 418: 4 });
  });

  it('links the incidents A4 §1.9.1 counts, and is owned by someone in its team', () => {
    const linked = Object.fromEntries(PROBLEMS.map((p) => [p.number, p.links.map((link) => `${link.source}:${link.count}`).join(' ')]));
    expect(linked).toEqual({
      411: 'history:14',
      412: 'rollout:6',
      413: 'history:7',
      414: 'major-incident:6',
      415: 'history:5',
      416: 'major-incident:14',
      417: 'major-incident:9',
      418: 'major-incident:18 early-vpn:2',
    });
    for (const problem of PROBLEMS) expect(teamOf(problem.owner), `PRB-0${problem.number}`).toBe(problem.team);
  });

  it('gives each known error a workaround, and each resolved or closed problem a root cause', () => {
    for (const problem of PROBLEMS) {
      if (problem.state === 'known_error') expect(problem.workaround && problem.workaroundArticle, `PRB-0${problem.number}`).toBeTruthy();
      if (problem.state === 'resolved' || problem.state === 'closed') expect(problem.rootCause, `PRB-0${problem.number}`).toBeTruthy();
      expect(problem.raisedDaysBeforeT0, `PRB-0${problem.number}`).toBeLessThanOrEqual(119);
    }
  });
});

describe('changes', () => {
  const byNumber = new Map(CHANGES.map((change) => [change.number, change]));
  const count = <T>(items: readonly T[], key: (item: T) => string) =>
    items.reduce<Record<string, number>>((acc, item) => ({ ...acc, [key(item)]: (acc[key(item)] ?? 0) + 1 }), {});

  it('numbers the 42 changes CHG-1151 … CHG-1192 in order', () => {
    expect(CHANGES.map((change) => change.number)).toEqual(Array.from({ length: 42 }, (_, i) => FIRST_CHANGE_NUMBER + i));
    expect(CHANGES.at(-1)?.number).toBe(LAST_CHANGE_NUMBER);
  });

  it('stands where A4 §1.9.2 says at T0', () => {
    expect(count(CHANGES, (change) => change.state)).toEqual({ closed: 30, scheduled: 7, submitted: 2, draft: 2, implementing: 1 });
    const closed = CHANGES.filter((change) => change.state === 'closed');
    expect(count(closed, (change) => change.kind)).toEqual({ standard: 18, normal: 10, emergency: 2 });
    expect(closed.filter((change) => change.closeCode === 'backed_out').map((change) => change.title)).toEqual(['Leeds core switch firmware 17.9']);
    for (const change of CHANGES) expect(change.closeCode !== undefined, `CHG-${change.number}`).toBe(change.state === 'closed');

    const thisWeek = CHANGES.filter((change) => change.state === 'scheduled' && change.when.kind === 'week' && change.when.weeksAhead === 0);
    expect(thisWeek.map((change) => change.title)).toEqual([
      'Firewall firmware 9.1.4 — Leeds',
      'Sage Intacct 2026 R4 upgrade',
      'Wi-Fi access point replacement — London 4th floor',
    ]);
    expect(CHANGES.filter((change) => change.maintenanceWindow).map((change) => change.number)).toEqual([1181, 1182]);
    const later = CHANGES.filter((change) => change.state === 'scheduled' && change.when.kind === 'week' && change.when.weeksAhead > 0);
    expect(later.map((change) => change.kind)).toEqual(['standard', 'standard', 'standard', 'standard']);
  });

  it('puts two changes in front of the CAB, one of them inside the month-end blackout', () => {
    const cab = CHANGES.filter((change) => change.state === 'submitted');
    expect(cab.map((change) => [change.title, change.kind, change.risk, change.owner, change.when.kind])).toEqual([
      ['Guest Wi-Fi segmentation — London', 'normal', 'medium', 'daniel-hughes', 'week'],
      ['Move the WMS database to the new SQL cluster', 'normal', 'high', 'liam-walsh', 'blackout'],
    ]);
    expect(cab[0]?.when).toMatchObject({ weekday: 'tue', weeksAhead: 0, start: '19:00' });
    for (const change of CHANGES.filter((candidate) => candidate.state === 'draft')) expect(change.when.kind, `CHG-${change.number}`).toBe('unscheduled');
  });

  it('makes CHG-1192 the live incident’s emergency change', () => {
    expect(byNumber.get(1192)).toMatchObject({
      kind: 'emergency',
      state: 'implementing',
      risk: 'high',
      when: { kind: 'live' },
      majorIncident: 4,
      problem: 418,
    });
  });

  it('runs inside the change windows, oldest first, owned by someone in the team', () => {
    const minutesOf = (wall: string) => Number(wall.slice(0, 2)) * 60 + Number(wall.slice(3));
    let previous = Number.POSITIVE_INFINITY;
    for (const change of CHANGES) {
      expect(teamOf(change.owner), `CHG-${change.number}`).toBe(change.team);
      if (change.problem) expect(PROBLEM_NUMBERS as readonly number[]).toContain(change.problem);
      const when = change.when;
      if (when.kind === 'past') {
        expect(when.daysBeforeT0, `CHG-${change.number}`).toBeLessThan(previous);
        expect(when.daysBeforeT0).toBeGreaterThanOrEqual(1);
        expect(when.daysBeforeT0).toBeLessThanOrEqual(119);
        previous = when.daysBeforeT0;
      }
      if ((when.kind === 'past' || when.kind === 'week' || when.kind === 'blackout') && change.kind !== 'emergency') {
        const start = minutesOf(when.start);
        const end = start + when.minutes;
        const saturday = when.kind === 'week' && when.weekday === 'sat';
        if (saturday) expect([start >= 8 * 60, end <= 18 * 60], `CHG-${change.number}`).toEqual([true, true]);
        else expect([start >= 18 * 60, end <= 22 * 60], `CHG-${change.number}`).toEqual([true, true]);
      }
    }
  });
});

describe('holidays in the library', () => {
  it('is the table holidays.test.ts checks', () => {
    expect(LIBRARY.holidays).toBe(BANK_HOLIDAYS);
  });
});

/**
 * Well-known people whose names are built from common British first names and
 * surnames: the pairs a seeded draw could produce by accident. The cast's own
 * names are fixed by the SPEC and `DEMO_PERSONAS` and are not listed here.
 */
const WELL_KNOWN: readonly string[] = [
  // Politics and public life
  'tony blair', 'gordon brown', 'david cameron', 'theresa may', 'boris johnson', 'liz truss', 'rishi sunak', 'keir starmer', 'john major',
  'margaret thatcher', 'winston churchill', 'nick clegg', 'ed miliband', 'david miliband', 'jeremy corbyn', 'jeremy hunt', 'michael gove',
  'sadiq khan', 'andy burnham', 'rachel reeves', 'angela rayner', 'yvette cooper', 'priti patel', 'sajid javid', 'matt hancock', 'dominic raab',
  'dominic cummings', 'nigel farage', 'diane abbott', 'jess phillips', 'wes streeting', 'george osborne', 'ed balls', 'alastair campbell',
  'peter mandelson', 'nicola sturgeon', 'stephen lawrence', 'stephen ward', 'leanne wood', 'kate middleton', 'alan turing', 'charlie spencer',
  // Broadcasting and comedy
  'david attenborough', 'stephen fry', 'hugh laurie', 'graham norton', 'jeremy clarkson', 'richard hammond', 'james may', 'jeremy paxman',
  'andrew marr', 'huw edwards', 'fiona bruce', 'fiona phillips', 'nick robinson', 'laura kuenssberg', 'holly willoughby', 'phillip schofield',
  'claudia winkleman', 'tess daly', 'zoe ball', 'greg james', 'chris evans', 'chris moyles', 'kirsty young', 'clare balding', 'gabby logan',
  'sue barker', 'matthew wright', 'matthew kelly', 'neil fox', 'charlie brooker', 'charlie cooper', 'peter kay', 'ricky gervais', 'jimmy carr',
  'alan carr', 'david mitchell', 'robert webb', 'david walliams', 'james corden', 'jack whitehall', 'rowan atkinson', 'sian lloyd', 'siân lloyd',
  'alice roberts', 'brian cox', 'colin baker', 'graham chapman',
  // Music
  'george harrison', 'paul mccartney', 'john lennon', 'mick jagger', 'elton john', 'david bowie', 'amy winehouse', 'lily allen', 'ed sheeran',
  'harry styles', 'adele adkins', 'sam smith', 'chris martin', 'neil young', 'george young', 'alice cooper', 'tom jones', 'charlotte church',
  'katherine jenkins', 'ellie goulding', 'lewis capaldi', 'noel gallagher', 'liam gallagher', 'damon albarn', 'nicola roberts', 'george burns',
  // Film and television
  'emma watson', 'emma thompson', 'emma stone', 'kate winslet', 'keira knightley', 'helen mirren', 'judi dench', 'maggie smith', 'michael caine',
  'anthony hopkins', 'idris elba', 'tom hardy', 'tom holland', 'tom hiddleston', 'daniel craig', 'daniel radcliffe', 'colin firth', 'hugh grant',
  'sean bean', 'sean connery', 'sean hayes', 'patrick stewart', 'andrew scott', 'luke evans', 'owen wilson', 'sophie turner', 'callum turner',
  'katie holmes', 'jamie bell', 'jamie dornan', 'cillian murphy', 'matt smith', 'david tennant', 'thomas gibson', 'joshua jackson',
  'jennifer lawrence', 'matthew perry', 'tom cruise', 'rachel green', 'dominic cooper', 'gemma collins',
  // Sport
  'david beckham', 'victoria beckham', 'harry kane', 'wayne rooney', 'gary lineker', 'alan shearer', 'steven gerrard', 'frank lampard',
  'john terry', 'rio ferdinand', 'paul scholes', 'gary neville', 'bobby moore', 'jordan henderson', 'jordan pickford', 'kyle walker',
  'john stones', 'luke shaw', 'harry maguire', 'phil foden', 'jude bellingham', 'declan rice', 'marcus rashford', 'raheem sterling',
  'jack grealish', 'bukayo saka', 'mason mount', 'jamie vardy', 'jamie carragher', 'gareth southgate', 'gareth bale', 'ryan giggs',
  'graham taylor', 'graham hill', 'damon hill', 'lewis hamilton', 'jenson button', 'andy murray', 'emma raducanu', 'tom daley', 'chris hoy',
  'mo farah', 'jessica ennis', 'laura kenny', 'jason kenny', 'kelly holmes', 'colin jackson', 'joshua kerr', 'laura davies', 'ben stokes',
  'joe root', 'james anderson', 'stuart broad', 'jonny wilkinson', 'owen farrell',
  // Business and technology
  'richard branson', 'alan sugar', 'james dyson', 'bill gates', 'steve jobs', 'tim cook', 'elon musk', 'jeff bezos', 'mark zuckerberg',
  'satya nadella', 'sundar pichai', 'larry ellison', 'warren buffett', 'joshua wong', 'andrew young',
  // Food
  'jamie oliver', 'gordon ramsay', 'nigella lawson', 'mary berry', 'paul hollywood', 'rick stein', 'tom kerridge', 'james martin',
  // Infamous
  'jimmy savile', 'rolf harris', 'gary glitter', 'harold shipman', 'fred west', 'rose west', 'ian huntley', 'peter sutcliffe',
  'myra hindley', 'ian brady', 'stuart hall',
];
