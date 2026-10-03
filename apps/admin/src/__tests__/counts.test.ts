import { describe, expect, it, vi } from 'vitest';
import { ApiError, type Admin, type TicketFilter } from '@itsm/sdk';

vi.mock('server-only', () => ({}));

const { countBy, countText, countTickets, noneLabel } = await import('../server/counts.js');

/**
 * Exact counts for tiles and strips (A7 §2.4 rule 9, §11.1): "999+" when the
 * API stopped counting; breakdowns from grouped counts when the API has them,
 * one count per key when it does not; "No team" for the group without one.
 */

function fake(options: { grouped?: 'works' | 'missing' | 'forbidden'; capped?: (filter: TicketFilter) => boolean } = {}) {
  const ticketCount = vi.fn(async (filter: TicketFilter) => ({ count: options.capped?.(filter) ? 1000 : (filter.priority?.length ?? 0) + (filter.group ? 10 : 0) + 7, capped: options.capped?.(filter) ?? false }));
  const ticketCounts = vi.fn(async (groupBy: string) => {
    if (options.grouped === 'missing') throw new ApiError(404, { type: 'about:blank', title: 'Not Found', status: 404, correlationId: 'c-1' }, 'Not Found');
    if (options.grouped === 'forbidden') throw new ApiError(403, { type: 'https://itsm.example/problems/forbidden', title: 'Forbidden', status: 403, correlationId: 'c-1' }, 'Forbidden');
    return {
      groupBy,
      groups: [
        { key: 'team-network', count: 27 },
        { key: null, count: 4 },
        { key: 'team-apps', count: 9 },
      ],
      total: 40,
      applied: ['statusCategory'],
    };
  });
  return { api: { observe: { ticketCount, ticketCounts } } as unknown as Admin, ticketCount, ticketCounts };
}

describe('a count as a tile shows it', () => {
  it('reads "999+" when the API stopped counting, and the number otherwise', () => {
    expect(countText({ value: 1000, capped: true })).toBe('999+');
    expect(countText({ value: 1204, capped: false })).toBe('1,204');
    expect(countText({ value: 0, capped: false })).toBe('0');
  });

  it('keeps the API’s capped flag', async () => {
    const { api } = fake({ capped: () => true });
    expect(await countTickets(api, { statusCategory: 'open,paused' })).toEqual({ ok: true, value: { value: 1000, capped: true } });
  });
});

describe('breakdowns', () => {
  it('asks grouped counts once and labels the group without a team "No team"', async () => {
    const { api, ticketCounts, ticketCount } = fake({ grouped: 'works' });
    const answer = await countBy(api, { statusCategory: 'open,paused' }, 'group', undefined, (key) => (key === 'team-network' ? 'Network' : null));
    expect(ticketCounts).toHaveBeenCalledTimes(1);
    expect(ticketCount).not.toHaveBeenCalled();
    expect(answer).toMatchObject({
      ok: true,
      value: {
        exact: true,
        groups: [
          { key: 'team-network', label: 'Network', value: 27 },
          { key: null, label: 'No team', value: 4 },
          { key: 'team-apps', label: 'team-apps', value: 9 },
        ],
      },
    });
  });

  it('answers in the order of the keys asked, zeros included', async () => {
    const { api } = fake({ grouped: 'works' });
    const answer = await countBy(api, {}, 'group', ['team-apps', 'team-hr']);
    expect(answer.ok && answer.value.groups.map((group) => [group.key, group.value])).toEqual([
      ['team-apps', 9],
      ['team-hr', 0],
    ]);
  });

  it('falls back to one count per key when grouped counts are missing', async () => {
    const { api, ticketCount } = fake({ grouped: 'missing' });
    const answer = await countBy(api, { statusCategory: 'open,paused' }, 'priority', ['P1', 'P2', 'P3', 'P4']);
    expect(ticketCount).toHaveBeenCalledTimes(4);
    expect(ticketCount).toHaveBeenCalledWith({ statusCategory: 'open,paused', priority: 'P2' });
    expect(answer.ok && answer.value.groups.map((group) => group.key)).toEqual(['P1', 'P2', 'P3', 'P4']);
  });

  it('counts "nobody assigned" in the fallback, and says when any key stopped counting', async () => {
    const { api, ticketCount } = fake({ grouped: 'missing', capped: (filter) => filter.assignee === 'none' });
    const answer = await countBy(api, {}, 'assignee', [null, 'u-1']);
    expect(ticketCount).toHaveBeenCalledWith({ assignee: 'none' });
    expect(answer).toMatchObject({ ok: true, value: { exact: false, groups: [{ key: null, label: 'Unassigned', capped: true }, { key: 'u-1' }] } });
  });

  it('passes a refusal on rather than counting key by key', async () => {
    const { api, ticketCount } = fake({ grouped: 'forbidden' });
    const answer = await countBy(api, {}, 'group', ['team-apps']);
    expect(answer).toMatchObject({ ok: false, problem: { status: 403 } });
    expect(ticketCount).not.toHaveBeenCalled();
  });

  it('names every dimension’s "none"', () => {
    expect(noneLabel('group')).toBe('No team');
    expect(noneLabel('assignee')).toBe('Unassigned');
    expect(noneLabel('service')).toBe('No service');
    expect(noneLabel('priority')).toBe('None');
  });
});
