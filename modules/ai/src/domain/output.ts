import { z } from 'zod';
import type { Capability } from './capabilities.js';

/**
 * Turning what a model said into something the platform will store.
 *
 * The model is asked for JSON and its answer is parsed against a schema per
 * capability. An answer that does not parse is a **failed job**, not a
 * best-effort salvage: half a reply, or a summary with the "next steps" quietly
 * missing, is worse than nothing because it looks complete. The agent sees that
 * the suggestion failed and asks again, which costs a few pence and no trust.
 *
 * This is also the reason the raw completion is kept on the job row: when a
 * prompt starts producing unparseable answers, the evidence of what changed is
 * the text itself, not a stack trace.
 */

const reason = z.string().min(1).max(600);
const confidence = z.number().min(0).max(1);

const replyDraft = z.object({
  text: z.string().min(1).max(8000),
  reason,
  confidence,
});

const ticketSummary = z.object({
  summary: z.string().min(1).max(4000),
  nextSteps: z.array(z.string().min(1).max(300)).max(10).default([]),
  reason,
  confidence,
});

const articleDraft = z.object({
  title: z.string().min(1).max(200),
  summary: z.string().min(1).max(500),
  body: z.array(z.string().min(1).max(4000)).min(1).max(40),
  reason,
  confidence,
});

const similarWork = z.object({
  items: z
    .array(
      z.object({
        kind: z.enum(['ticket', 'known-error', 'article']),
        id: z.string().min(1),
        title: z.string().min(1).max(300),
        ref: z.string().min(1).max(60),
        why: z.string().max(300).default(''),
      }),
    )
    .max(20)
    .default([]),
  reason,
  confidence,
});

const SCHEMAS: Record<Capability, z.ZodTypeAny> = {
  'reply-draft': replyDraft,
  'ticket-summary': ticketSummary,
  'article-draft': articleDraft,
  'similar-work': similarWork,
};

export type ConfidenceBand = 'low' | 'medium' | 'high';

/**
 * A band, not a number.
 *
 * The figure a model reports for its own confidence is not calibrated against
 * anything, and showing it as `0.82` invites a person to treat it as a
 * probability. Three words are what the figure can actually support, and the
 * boundaries are here so the whole product uses the same three.
 */
export function bandOf(value: number): ConfidenceBand {
  if (value >= 0.8) return 'high';
  if (value >= 0.5) return 'medium';
  return 'low';
}

export class UnparseableCompletion extends Error {
  constructor(readonly capability: Capability, readonly detail: string) {
    super(`the model did not answer in the shape ${capability} needs: ${detail}`);
    this.name = 'UnparseableCompletion';
  }
}

export interface ParsedCompletion {
  content: Record<string, unknown>;
  reason: string;
  confidence: ConfidenceBand;
}

/**
 * Parses one completion. Tolerant of a fenced code block around the JSON,
 * because every model does that sometimes and refusing it would be pedantry
 * rather than a control; intolerant of anything else.
 */
export function parseCompletion(capability: Capability, raw: string): ParsedCompletion {
  const text = stripFence(raw).trim();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new UnparseableCompletion(capability, 'it was not JSON');
  }

  const parsed = SCHEMAS[capability].safeParse(value);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.join('.') || 'the answer';
    throw new UnparseableCompletion(capability, `${where}: ${first?.message ?? 'did not match the schema'}`);
  }

  const { reason: why, confidence: score, ...content } = parsed.data as Record<string, unknown> & {
    reason: string;
    confidence: number;
  };
  return { content, reason: why, confidence: bandOf(score) };
}

function stripFence(raw: string): string {
  const fenced = /^\s*```(?:json)?\s*\n([\s\S]*?)\n\s*```\s*$/.exec(raw);
  return fenced ? fenced[1]! : raw;
}

/** A rough token count, for estimating before a real provider reports one. */
export function approximateTokens(text: string): number {
  // Four characters to a token is the usual rule of thumb, and this is only
  // ever an estimate: a real provider reports the figure it charged for, and
  // that figure is what is stored.
  return Math.max(1, Math.ceil(text.length / 4));
}
