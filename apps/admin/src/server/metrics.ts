import 'server-only';
import { cache } from 'react';
import { ApiError, MAX_METRIC_BATCH, type Admin, type MetricBatchResult, type MetricQuery, type MetricResult, type ProblemDetails } from '@itsm/sdk';
import type { Problem } from '@itsm/ui';
import { read, type Read } from './read.js';
import { metricPeriod, previousPeriod, type Period, type RangeKey } from './periods.js';

/**
 * Administration's one way of asking for numbers (A7 §2.3, §2.4 rules 2–3).
 *
 * A dashboard asks twenty-odd questions. They go as **one batch** when the API
 * has `POST /analytics/query/batch` (R4, [A8-1]); an API that predates it
 * answers the batch with a 404, and the questions then go **one at a time,
 * never more than six in flight**, so a page cannot flood the API it is
 * waiting on. Either way:
 *
 * - each question's answer is its own `Read`, so one failed question is a
 *   problem on its own card and the other eleven still draw;
 * - identical questions are asked once — within a call, and across calls in
 *   the same request (`cache()`), so two cards that need the same series
 *   share it;
 * - the caller names each question (`id`) and gets a map back by that name,
 *   never a position to keep in step with.
 */

export type NamedQuery = MetricQuery & { readonly id: string };

/** The questions in flight at once when the batch route is missing (A7 §2.4 rule 2). */
export const FALLBACK_CONCURRENCY = 6;

/** A question as a stable key: the same question asked twice is one key, whatever order its fields were written in. */
export function queryKey(query: MetricQuery): string {
  const sorted = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sorted);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([key, entry]) => key !== 'id' && entry !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, entry]) => [key, sorted(entry)]),
      );
    }
    return value;
  };
  return JSON.stringify(sorted(query));
}

function problemOf(details: ProblemDetails | undefined): Problem {
  const code = details?.type ? details.type.split('/').pop() : undefined;
  return {
    status: typeof details?.status === 'number' ? details.status : 500,
    ...(code && code !== 'about:blank' ? { code } : {}),
    ...(details?.title ? { title: details.title } : {}),
    ...(details?.detail ? { detail: details.detail } : {}),
  };
}

function fromBatch(entry: MetricBatchResult | undefined): Read<MetricResult> {
  if (entry?.ok) return { ok: true, value: entry.result };
  const problem = problemOf(entry?.ok === false ? entry.problem : undefined);
  return { ok: false, message: problem.detail ?? problem.title ?? 'The question could not be answered.', problem };
}

/** Runs `tasks` with at most `limit` of them in flight, keeping their order. */
export async function inParallel<T>(tasks: readonly (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const index = next;
      next += 1;
      results[index] = await tasks[index]!();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

/** Whether the API answered a batch with "no such route": an API from before R4. */
function batchMissing(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 405);
}

/** Per request: the answers already asked for, by API client, then by question. */
const requestAnswers = cache((): WeakMap<object, Map<string, Promise<Read<MetricResult>>>> => new WeakMap());

function answersFor(api: object): Map<string, Promise<Read<MetricResult>>> {
  const all = requestAnswers();
  let answers = all.get(api);
  if (!answers) {
    answers = new Map();
    all.set(api, answers);
  }
  return answers;
}

async function askAll(api: Admin, questions: readonly MetricQuery[]): Promise<Read<MetricResult>[]> {
  const insights = api.observe.insights;
  if (typeof insights.queryBatch === 'function') {
    try {
      const answers: Read<MetricResult>[] = [];
      for (let start = 0; start < questions.length; start += MAX_METRIC_BATCH) {
        const chunk = questions.slice(start, start + MAX_METRIC_BATCH);
        const results = await insights.queryBatch(chunk.map((question, index) => ({ ...question, id: `q${start + index}` })));
        for (let index = 0; index < chunk.length; index += 1) answers.push(fromBatch(results[index]));
      }
      return answers;
    } catch (error) {
      if (!batchMissing(error)) {
        // The whole call failed (a 403 for the reader, the API away): every question shares that answer.
        const failed = await read<MetricResult>(() => Promise.reject(error));
        return questions.map(() => failed);
      }
    }
  }
  return inParallel(
    questions.map((question) => () => read(() => insights.query(question))),
    FALLBACK_CONCURRENCY,
  );
}

/**
 * Every question answered, by its `id`. Questions this request has already
 * asked reuse that answer; the rest go out together.
 */
export async function metricBatch(api: Admin, queries: readonly NamedQuery[]): Promise<ReadonlyMap<string, Read<MetricResult>>> {
  const answers = answersFor(api);
  const fresh: { key: string; query: MetricQuery }[] = [];
  const keys = queries.map((named) => {
    const { id: _id, ...query } = named;
    const key = queryKey(query);
    if (!answers.has(key) && !fresh.some((entry) => entry.key === key)) fresh.push({ key, query });
    return key;
  });

  if (fresh.length > 0) {
    const pending = askAll(
      api,
      fresh.map((entry) => entry.query),
    );
    fresh.forEach((entry, index) => answers.set(entry.key, pending.then((all) => all[index]!)));
  }

  const out = new Map<string, Read<MetricResult>>();
  await Promise.all(
    queries.map(async (named, index) => {
      out.set(named.id, await answers.get(keys[index]!)!);
    }),
  );
  return out;
}

/**
 * A question and the same question over the previous period of the same
 * length, for a delta (A7 §2.4 rule 3): `<id>` and `<id>:previous`.
 */
export function withPrevious(query: NamedQuery, period: RangeKey | Period, now: Date = new Date()): [NamedQuery, NamedQuery] {
  const current: NamedQuery = { ...query, ...metricPeriod(period, now) };
  const before = previousPeriod(period, now);
  const { series: _series, bucket: _bucket, ...rest } = query;
  return [current, { ...rest, id: `${query.id}:previous`, range: 'custom', from: before.from, to: before.to }];
}

/** A result's single value, or `null` when it failed or held none. */
export function valueOf(answer: Read<MetricResult> | undefined): number | null {
  return answer?.ok && typeof answer.value.value === 'number' && Number.isFinite(answer.value.value) ? answer.value.value : null;
}

/** A result's series as numbers, gaps kept as `null`; empty when it failed. */
export function seriesOf(answer: Read<MetricResult> | undefined): (number | null)[] {
  return answer?.ok ? (answer.value.series ?? []).map((point) => (typeof point.value === 'number' ? point.value : null)) : [];
}
