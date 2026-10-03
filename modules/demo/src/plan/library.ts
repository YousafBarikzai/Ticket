import type { DemoContent } from './content-types.js';
import { CHANGES } from '../content/changes.js';
import { CSAT_VERBATIMS } from '../content/csat.js';
import { HEROES } from '../content/heroes.js';
import { BANK_HOLIDAYS } from '../content/holidays.js';
import { KNOWLEDGE } from '../content/knowledge.js';
import { PEOPLE } from '../content/people.js';
import { PROBLEMS } from '../content/problems.js';
import { REPLIES } from '../content/replies.js';
import { SLOTS, TITLES } from '../content/titles.js';

/**
 * The content library, assembled (A4 §1.13). Imported by file, one export per
 * module, exactly as `content-types.ts` names them.
 *
 * Only `plan.ts` imports this, and only the build job reaches `plan.ts`,
 * through `await import(...)`: the API process registers the demo module's
 * manifest and must never evaluate several hundred kilobytes of story to do
 * it (A4 §2.2).
 */
export const DEMO_CONTENT: DemoContent = Object.freeze({
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
});
