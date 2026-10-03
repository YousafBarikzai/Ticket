import type { DemoContent, ReplyKind, SubcategoryKey, TicketSlot } from './content-types.js';
import { REPLY_SLOTS, TICKET_SLOTS } from './content-types.js';
import type { Stream } from './rng.js';

/**
 * Filling the content library's templates (A4 §1.13).
 *
 * A template may use only the slots its kind names (`TICKET_SLOTS` for
 * titles and descriptions, `{first}` and `{agent}` for replies and CSAT
 * comments). An unknown slot is a content defect, and it throws here, while
 * the plan is made, rather than reaching a ticket as a literal `{room}` — the
 * build's V10 refuses a generation with a brace in any description.
 */

const SLOT = /\{([a-zA-Z]+)\}/g;

export class TemplateError extends Error {}

/** Every `{slot}` a template uses. */
export function slotsIn(template: string): string[] {
  return [...template.matchAll(SLOT)].map((match) => match[1] as string);
}

/** Replaces each `{slot}`; throws on a slot `values` does not name. */
export function fill(template: string, values: Readonly<Record<string, string>>): string {
  const out = template.replace(SLOT, (_, name: string) => {
    const value = values[name];
    if (value === undefined) throw new TemplateError(`template uses {${name}}, which is not available here: "${template}"`);
    return value;
  });
  if (out.includes('{') || out.includes('}')) throw new TemplateError(`template leaves a brace behind: "${template}"`);
  return out;
}

/** The planner's view of the library's words, with the draws that pick them. */
export class Words {
  constructor(
    private readonly content: DemoContent,
    /** Asset tags for `{device}`. */
    private readonly laptopTags: readonly string[],
    /** First names for `{colleague}`. */
    private readonly colleagueNames: readonly string[],
  ) {}

  private ticketSlots(rng: Stream): Record<TicketSlot, string> {
    const slots = this.content.slots;
    return {
      device: rng.pick(this.laptopTags),
      colleague: rng.pick(this.colleagueNames),
      site: rng.pick(slots.site),
      floor: rng.pick(slots.floor),
      app: rng.pick(slots.app),
      error: rng.pick(slots.error),
      since: rng.pick(slots.since),
      room: rng.pick(slots.room),
    };
  }

  /** A title and description for a ticket in `subcategory`; `phoned` prefers the agent's write-up. */
  ticketText(subcategory: SubcategoryKey, rng: Stream, phoned: boolean): { title: string; description: string } {
    const text = this.content.titles[subcategory];
    const values = this.ticketSlots(rng);
    const title = fill(rng.pick(text.titles), values);
    const pool = phoned && text.phoned && text.phoned.length > 0 ? text.phoned : text.descriptions;
    return { title, description: fill(rng.pick(pool), values) };
  }

  /** A reply of `kind`, preferring the subcategory's own bank when it has one. */
  reply(kind: ReplyKind, subcategory: SubcategoryKey, names: { first: string; agent: string }, rng: Stream): string {
    const specific =
      kind === 'firstResponse' || kind === 'update' || kind === 'internalNote' || kind === 'resolution'
        ? this.content.replies.bySubcategory?.[subcategory]?.[kind]
        : undefined;
    const pool = specific && specific.length > 0 && rng.chance(0.6) ? specific : this.content.replies[kind];
    return fill(rng.pick(pool), names);
  }

  /** A CSAT comment in the tone the stars call for. */
  csatComment(stars: number, agent: string, rng: Stream): string {
    const tone = stars >= 4 ? 'positive' : stars === 3 ? 'neutral' : 'negative';
    return fill(rng.pick(this.content.csat[tone]), { agent });
  }

  /** Every template's slots resolve: what V10 relies on, checked once per plan. */
  static assertTemplates(content: DemoContent): void {
    const ticketSlots = new Set<string>(TICKET_SLOTS);
    const replySlots = new Set<string>(REPLY_SLOTS);
    const check = (template: string, allowed: ReadonlySet<string>, where: string) => {
      for (const slot of slotsIn(template)) {
        if (!allowed.has(slot)) throw new TemplateError(`${where} uses {${slot}}, which it may not: "${template}"`);
      }
    };
    for (const [subcategory, text] of Object.entries(content.titles)) {
      for (const template of [...text.titles, ...text.descriptions, ...(text.phoned ?? [])]) check(template, ticketSlots, `titles.${subcategory}`);
    }
    for (const [kind, pool] of Object.entries(content.replies)) {
      if (kind === 'bySubcategory' || !Array.isArray(pool)) continue;
      for (const template of pool as readonly string[]) check(template, replySlots, `replies.${kind}`);
    }
    for (const [subcategory, banks] of Object.entries(content.replies.bySubcategory ?? {})) {
      for (const [kind, pool] of Object.entries(banks ?? {})) {
        for (const template of pool ?? []) check(template, replySlots, `replies.bySubcategory.${subcategory}.${kind}`);
      }
    }
    for (const [tone, pool] of Object.entries(content.csat)) {
      for (const template of pool) check(template, new Set(['agent']), `csat.${tone}`);
    }
  }
}
