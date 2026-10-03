import type { DecisionRow } from '@itsm/sdk';
import type { Tone } from '@itsm/ui';
import { MODE_LABELS, asMode, byFieldOrder, fieldLabel, providerLabel, reasonLabel } from '../../triage.js';

/**
 * AI triage › Decisions in words, and as a file (SPEC §6.1): each recorded
 * decision as a row — when, which ticket, who answered, what it did, how long
 * it took, what it cost, who was passed over — the per-field answers for the
 * drawer, and the CSV a desk downloads to look at them elsewhere.
 *
 * Pure and server-safe. The CSV is built from exactly the rows on screen, so
 * what is downloaded is what was looked at, and its file name says which
 * workspace, which range and which day.
 */

export type DecisionAction = 'record' | 'suggest' | 'apply';

export interface DecisionAnswer {
  readonly question: string;
  readonly label: string;
  /** The answer as the provider gave it: an option's name, a priority, yes or no. */
  readonly value: string;
  readonly confidence: number;
  readonly action: DecisionAction | null;
  /** "Recorded", "Suggested", "Set by AI". */
  readonly actionLabel: string | null;
  /** Why not more — the plan's own reason, in plain words where it can be. */
  readonly why: string | null;
}

export interface DecisionAttempt {
  readonly provider: string;
  readonly providerLabel: string;
  readonly outcome: string;
  readonly outcomeLabel: string;
  readonly reason: string | null;
  readonly reasonLabel: string;
  readonly ms: number;
}

export interface DecisionView extends Record<string, unknown> {
  readonly id: string;
  readonly createdAt: string;
  readonly ticketId: string;
  /** "INC-1042" when the ticket's number is known; null otherwise (the drawer and Open still work by id). */
  readonly ticketNumber: string | null;
  readonly ticketTitle: string | null;
  /** What the Ticket cell says. */
  readonly ticketLabel: string;
  readonly mode: string;
  readonly modeLabel: string;
  readonly outcome: string;
  readonly outcomeLabel: string;
  readonly outcomeTone: Tone;
  readonly provider: string;
  readonly providerLabel: string;
  readonly latencyMs: number;
  /** "320 ms", or "—" when nobody answered (rules take no time worth showing). */
  readonly timeLabel: string;
  readonly costDisplay: string;
  readonly passedOver: number;
  readonly passedOverReasons: readonly string[];
  readonly answers: readonly DecisionAnswer[];
  readonly attempts: readonly DecisionAttempt[];
}

export const OUTCOME_LOOK: Readonly<Record<string, { readonly label: string; readonly tone: Tone }>> = {
  applied: { label: 'Set by AI', tone: 'accent' },
  suggested: { label: 'Suggested', tone: 'info' },
  shadowed: { label: 'Recorded', tone: 'neutral' },
  // Nothing went wrong and nothing is late: a suggestion nobody acted on is neutral (D5, A7 §2.9).
  none: { label: 'Nobody answered', tone: 'neutral' },
};

export function outcomeLook(outcome: string): { readonly label: string; readonly tone: Tone } {
  return OUTCOME_LOOK[outcome] ?? { label: outcome.charAt(0).toUpperCase() + outcome.slice(1), tone: 'neutral' };
}

const ACTION_LABELS: Readonly<Record<DecisionAction, string>> = {
  record: 'Recorded',
  suggest: 'Suggested',
  apply: 'Set by AI',
};

const ATTEMPT_LABELS: Readonly<Record<string, string>> = {
  answered: 'Answered',
  skipped: 'Passed over',
  failed: 'Failed',
};

/** The plan's reason, for a person: thresholds as percentages, field names as the desk says them. */
export function whyText(reason: string): string {
  return reason
    .replace(/\b(0(?:\.\d+)?|1(?:\.0+)?)\b/g, (figure) => `${Math.round(Number(figure) * 100)}%`)
    .replace(/\bcategoryId\b/g, 'category')
    .replace(/\bgroupId\b/g, 'team')
    .replace(/\bmajorIncident\b/g, 'major incident')
    .replace(/^mode is (\w+)$/, (_all, mode: string) => `the desk was in ${MODE_LABELS[asMode(mode)]}`);
}

function answerText(value: unknown): string {
  if (value === null || value === undefined) return 'No answer';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

type Plan = { question?: unknown; action?: unknown; reason?: unknown };

/** The per-field plan the API records beside the answers; tolerant of a row that has none. */
function planOf(row: DecisionRow): Map<string, { action: DecisionAction; reason: string | null }> {
  const plan = (row as DecisionRow & { plan?: unknown }).plan;
  const out = new Map<string, { action: DecisionAction; reason: string | null }>();
  if (!Array.isArray(plan)) return out;
  for (const entry of plan as Plan[]) {
    if (typeof entry?.question !== 'string') continue;
    const action = entry.action === 'record' || entry.action === 'suggest' || entry.action === 'apply' ? entry.action : null;
    if (action) out.set(entry.question, { action, reason: typeof entry.reason === 'string' ? entry.reason : null });
  }
  return out;
}

export function decisionView(row: DecisionRow, tickets: ReadonlyMap<string, { readonly number: string; readonly title: string }> = new Map()): DecisionView {
  const ticket = tickets.get(row.subjectId);
  const plan = planOf(row);
  const answers: DecisionAnswer[] = Object.entries(row.answers ?? {})
    .sort(([a], [b]) => byFieldOrder(a, b))
    .map(([question, answer]) => {
      const planned = plan.get(question);
      return {
        question,
        label: fieldLabel(question),
        value: answerText(answer?.value),
        confidence: typeof answer?.confidence === 'number' ? answer.confidence : 0,
        action: planned?.action ?? null,
        actionLabel: planned ? ACTION_LABELS[planned.action] : null,
        // "The desk was in Suggest" is true of every answer and already in the facts; say only a field's own reason.
        why: planned?.reason && !/^mode is /.test(planned.reason) ? whyText(planned.reason) : null,
      };
    });
  const attempts: DecisionAttempt[] = (row.attempts ?? []).map((attempt) => ({
    provider: attempt.provider,
    providerLabel: providerLabel(attempt.provider),
    outcome: attempt.outcome,
    outcomeLabel: ATTEMPT_LABELS[attempt.outcome] ?? attempt.outcome,
    reason: attempt.reason,
    reasonLabel: reasonLabel(attempt.reason),
    ms: attempt.ms,
  }));
  const passed = attempts.filter((attempt) => attempt.outcome !== 'answered');
  const look = outcomeLook(row.outcome);
  return {
    id: row.id,
    createdAt: row.createdAt,
    ticketId: row.subjectId,
    ticketNumber: ticket?.number ?? null,
    ticketTitle: ticket?.title ?? null,
    ticketLabel: ticket?.number ?? 'A ticket',
    mode: row.mode,
    modeLabel: MODE_LABELS[asMode(row.mode)],
    outcome: row.outcome,
    outcomeLabel: look.label,
    outcomeTone: look.tone,
    provider: row.provider,
    providerLabel: row.provider === 'rules' ? 'Nobody (rules)' : providerLabel(row.provider),
    latencyMs: row.latencyMs,
    timeLabel: row.provider === 'rules' ? '—' : `${row.latencyMs} ms`,
    costDisplay: row.costDisplay,
    passedOver: passed.length,
    passedOverReasons: passed.map((attempt) => `${attempt.providerLabel} — ${attempt.reasonLabel || attempt.outcomeLabel.toLowerCase()}`),
    answers,
    attempts,
  };
}

/** The decisions made within the last `days` days of `now`, newest first as the API sent them. */
export function decisionsWithin<T extends { readonly createdAt: string }>(rows: readonly T[], days: number, now: number): T[] {
  const since = now - days * 86_400_000;
  return rows.filter((row) => {
    const at = Date.parse(row.createdAt);
    return Number.isNaN(at) || at >= since;
  });
}

/** `?days=` on Quality and Decisions: 30, 90 or 180; anything else is 30. */
export const RANGES = [30, 90, 180] as const;
export type RangeDays = (typeof RANGES)[number];

export function rangeFrom(value: string | string[] | undefined): RangeDays {
  const raw = Number(Array.isArray(value) ? value[0] : value);
  return (RANGES as readonly number[]).includes(raw) ? (raw as RangeDays) : 30;
}

/* =========================================================================
 * The CSV
 * ====================================================================== */

/**
 * One cell, quoted when it must be (RFC 4180), and defused when it would be
 * read as a formula by a spreadsheet (`=`, `+`, `-`, `@` first): an answer
 * the provider wrote, or a ticket title a requester wrote, must never run.
 */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const CSV_FIELDS = ['type', 'category', 'group', 'priority', 'majorIncident'];

/**
 * The rows as a CSV file: UTF-8 with a byte-order mark (so a spreadsheet
 * reads "£" as a pound sign), CRLF line ends, one line per decision, with
 * each field's answer and confidence in columns of their own.
 */
export function decisionsCsv(rows: readonly DecisionView[]): string {
  const header = [
    'When (UTC)',
    'Ticket',
    'Ticket title',
    'Mode',
    'Outcome',
    'Answered by',
    'Time (ms)',
    'Cost',
    'Passed over',
    'Why passed over',
    ...CSV_FIELDS.flatMap((field) => [fieldLabel(field), `${fieldLabel(field)} confidence`]),
  ];
  const lines = rows.map((row) => {
    const byField = new Map(row.answers.map((answer) => [answer.question, answer]));
    return [
      row.createdAt,
      row.ticketNumber ?? row.ticketId,
      row.ticketTitle ?? '',
      row.modeLabel,
      row.outcomeLabel,
      row.providerLabel,
      row.provider === 'rules' ? '' : row.latencyMs,
      row.costDisplay,
      row.passedOver,
      row.passedOverReasons.join('; '),
      ...CSV_FIELDS.flatMap((field) => {
        const answer = byField.get(field);
        return answer ? [answer.value, answer.confidence.toFixed(2)] : ['', ''];
      }),
    ]
      .map(csvCell)
      .join(',');
  });
  return `﻿${[header.map(csvCell).join(','), ...lines].join('\r\n')}\r\n`;
}

/** The calendar day in the reader's zone, `2026-09-30`. */
function dayIn(now: number, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now));
    const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((entry) => entry.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  } catch {
    return new Date(now).toISOString().slice(0, 10);
  }
}

/**
 * `ai-triage-decisions-acme-last-30-days-2026-09-30.csv`: which workspace,
 * which range and which day (the reader's), in characters every file system
 * keeps.
 */
export function decisionsCsvFileName({ workspace, days, now, timeZone }: { readonly workspace: string | null; readonly days: number; readonly now: number; readonly timeZone: string }): string {
  const slug = (workspace ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return ['ai-triage-decisions', slug, `last-${days}-days`, dayIn(now, timeZone)].filter(Boolean).join('-') + '.csv';
}
