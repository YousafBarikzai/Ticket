import { describe, expect, it, vi } from 'vitest';
import { ApiError, type Admin, type MetricQuery, type MetricResult } from '@itsm/sdk';

vi.mock('server-only', () => ({}));

const { FALLBACK_CONCURRENCY, inParallel, metricBatch, queryKey, seriesOf, valueOf, withPrevious } = await import('../server/metrics.js');

/**
 * One way of asking for numbers (A7 §2.4 rules 2–3, §11.1): the batch when
 * the API has it, at most six in flight when it does not, every identical
 * question asked once, and one failed question failing only itself.
 */

const NOW = new Date('2026-10-02T10:04:00Z');

function result(value: number, key = 'tickets.created'): MetricResult {
  return { metric: { key, name: key, unit: 'count', aggregate: 'count', fact: 'ticket' }, period: { from: '2026-09-03', to: '2026-10-03' }, value, source: 'facts' };
}

function apiError(status: number): ApiError {
  return new ApiError(status, { type: `https://itsm.example/problems/${status === 404 ? 'not_found' : 'forbidden'}`, title: 'No', status, correlationId: 'c-1' }, 'No');
}

interface Fake {
  readonly api: Admin;
  readonly query: ReturnType<typeof vi.fn>;
  readonly batch: ReturnType<typeof vi.fn>;
  inFlight: number;
  peak: number;
}

function fake(options: { batch?: 'works' | 'missing' | 'absent' | 'forbidden'; fail?: string } = {}): Fake {
  const state = { inFlight: 0, peak: 0 } as Fake;
  const answer = (question: MetricQuery): MetricResult => {
    if (question.metricKey === options.fail) throw apiError(404);
    return result(question.metricKey.length, question.metricKey);
  };
  const query = vi.fn(async (question: MetricQuery) => {
    state.inFlight += 1;
    state.peak = Math.max(state.peak, state.inFlight);
    await new Promise((resolve) => setTimeout(resolve, 2));
    state.inFlight -= 1;
    return answer(question);
  });
  const batch = vi.fn(async (questions: (MetricQuery & { id?: string })[]) => {
    if (options.batch === 'missing') throw apiError(404);
    if (options.batch === 'forbidden') throw apiError(403);
    return questions.map((question) =>
      question.metricKey === options.fail
        ? { id: question.id, ok: false as const, problem: { type: 'https://itsm.example/problems/unknown_metric', title: 'No such metric', status: 404 } }
        : { id: question.id, ok: true as const, result: answer(question) },
    );
  });
  const insights = options.batch === 'absent' ? { query } : { query, queryBatch: batch };
  return Object.assign(state, { api: { observe: { insights } } as unknown as Admin, query, batch });
}

const questions = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `m${index}`, metricKey: `metric.${index}`, range: '30d' as const }));

describe('asking in one batch', () => {
  it('uses the batch route when the API has it, and answers by name', async () => {
    const api = fake();
    const answers = await metricBatch(api.api, [
      { id: 'raised', metricKey: 'tickets.created', range: '30d' },
      { id: 'sla', metricKey: 'sla.attainment', range: '30d' },
    ]);
    expect(api.batch).toHaveBeenCalledTimes(1);
    expect(api.query).not.toHaveBeenCalled();
    expect(valueOf(answers.get('raised'))).toBe('tickets.created'.length);
    expect(answers.get('sla')).toMatchObject({ ok: true });
  });

  it('splits more than thirty questions into batches of thirty', async () => {
    const api = fake();
    const answers = await metricBatch(api.api, questions(45));
    expect(api.batch).toHaveBeenCalledTimes(2);
    expect(api.batch.mock.calls[0]![0]).toHaveLength(30);
    expect(answers.size).toBe(45);
  });

  it('fails one question on its own card, and answers the rest', async () => {
    const api = fake({ fail: 'metric.1' });
    const answers = await metricBatch(api.api, questions(3));
    expect(answers.get('m0')).toMatchObject({ ok: true });
    expect(answers.get('m1')).toMatchObject({ ok: false, problem: { status: 404, code: 'unknown_metric' } });
    expect(answers.get('m2')).toMatchObject({ ok: true });
  });

  it('gives every question the whole call’s refusal when the batch itself is refused', async () => {
    const api = fake({ batch: 'forbidden' });
    const answers = await metricBatch(api.api, questions(2));
    expect([...answers.values()].every((answer) => !answer.ok && answer.problem.status === 403)).toBe(true);
    expect(api.query).not.toHaveBeenCalled();
  });
});

describe('without the batch route', () => {
  it('falls back to one question at a time when the API answers the batch with a 404', async () => {
    const api = fake({ batch: 'missing' });
    const answers = await metricBatch(api.api, questions(4));
    expect(api.query).toHaveBeenCalledTimes(4);
    expect(answers.get('m3')).toMatchObject({ ok: true });
  });

  it('never has more than six questions in flight', async () => {
    const api = fake({ batch: 'absent' });
    await metricBatch(api.api, questions(20));
    expect(api.query).toHaveBeenCalledTimes(20);
    expect(api.peak).toBeLessThanOrEqual(FALLBACK_CONCURRENCY);
    expect(api.peak).toBeGreaterThan(1);
  });

  it('keeps one failure to its own question', async () => {
    const api = fake({ batch: 'absent', fail: 'metric.0' });
    const answers = await metricBatch(api.api, questions(2));
    expect(answers.get('m0')).toMatchObject({ ok: false });
    expect(answers.get('m1')).toMatchObject({ ok: true });
  });
});

describe('asking a question once', () => {
  it('asks identical questions once, whatever their names and field order', async () => {
    const api = fake({ batch: 'absent' });
    const answers = await metricBatch(api.api, [
      { id: 'tile', metricKey: 'tickets.created', range: '30d', series: true },
      { id: 'card', series: true, range: '30d', metricKey: 'tickets.created' },
      { id: 'other', metricKey: 'tickets.resolved', range: '30d' },
    ]);
    expect(api.query).toHaveBeenCalledTimes(2);
    expect(answers.get('tile')).toEqual(answers.get('card'));
    expect(queryKey({ metricKey: 'a', range: '7d' })).toBe(queryKey({ range: '7d', metricKey: 'a' }));
    expect(queryKey({ metricKey: 'a', range: '7d' })).not.toBe(queryKey({ metricKey: 'a', range: '30d' }));
  });
});

describe('deltas and readers', () => {
  it('pairs a question with the previous period of the same length, without its series', () => {
    const [current, previous] = withPrevious({ id: 'reply', metricKey: 'tickets.first_response', series: true, bucket: 'day' }, '30d', NOW);
    expect(current).toMatchObject({ id: 'reply', range: '30d', series: true });
    expect(previous).toEqual({ id: 'reply:previous', metricKey: 'tickets.first_response', range: 'custom', from: '2026-08-04T00:00:00.000Z', to: '2026-09-03T00:00:00.000Z' });
  });

  it('reads a value or a series, and nothing from a failure', () => {
    expect(valueOf({ ok: true, value: result(12) })).toBe(12);
    expect(valueOf({ ok: true, value: { ...result(0), value: null } })).toBeNull();
    expect(valueOf({ ok: false, message: 'x', problem: { status: 500 } })).toBeNull();
    expect(seriesOf({ ok: true, value: { ...result(0), series: [{ at: 'a', value: 2 }, { at: 'b', value: null }] } })).toEqual([2, null]);
    expect(seriesOf(undefined)).toEqual([]);
  });

  it('keeps order when it runs tasks in parallel', async () => {
    const order = await inParallel([3, 1, 2].map((delay) => () => new Promise<number>((resolve) => setTimeout(() => resolve(delay), delay))), 2);
    expect(order).toEqual([3, 1, 2]);
  });
});
