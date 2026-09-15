import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { transaction, withContext } from '@itsm/platform';
import { invitationService } from '@itsm/module-feedback';
import { registerChatTransport, handleChat, type ChatTransport, type OutboundChat, type ParsedChat } from '@itsm/module-channels';
import {
  closeHarness,
  contextFor,
  createTestTenant,
  deleteTestTenant,
  drainEvents,
  request,
  type TestTenant,
} from '../support/harness.js';

/**
 * Feedback surveys (MOD-18).
 *
 * The unit tests prove the scoring and the document rules. This proves the
 * loop: a ticket resolves, exactly one person is asked, the link in their
 * inbox opens a page that works without a session, their answer is stored
 * against the version they saw, the score reaches MOD-12, and nobody is asked
 * twice in a week. And the thread: a survey posted into a chat conversation is
 * answered by the requester's button and refused from anybody else's.
 */

let tenant: TestTenant;

beforeAll(async () => {
  tenant = await createTestTenant('feedback');
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('feedback');
  await closeHarness();
});

function ctx() {
  return contextFor(tenant.id);
}

async function read<T>(fn: (tx: Parameters<Parameters<typeof transaction>[1]>[0]) => Promise<T>): Promise<T> {
  const context = ctx();
  return withContext(context, () => transaction(context, fn));
}

/** Raises a ticket for the requester and resolves it as the agent. */
async function raiseAndResolve(title: string, requesterToken = tenant.people.requester!.token): Promise<string> {
  const created = await request<{ id: string }>('/api/v1/tickets', {
    method: 'POST',
    token: requesterToken,
    body: { type: 'incident', title, priority: 'P3' },
  });
  expect(created.status).toBe(201);
  await drainEvents(tenant.id);
  for (const to of ['in_progress', 'resolved']) {
    const moved = await request(`/api/v1/tickets/${created.body.id}/transitions`, {
      method: 'POST',
      token: tenant.people.agent!.token,
      body: { to, reason: 'survey test' },
    });
    expect([200, 201]).toContain(moved.status);
    await drainEvents(tenant.id);
  }
  return created.body.id;
}

function linkFrom(body: string): string {
  const match = /https?:\/\/\S+\/api\/v1\/public\/surveys\/(\S+)/.exec(body);
  expect(match).not.toBeNull();
  return match![1]!;
}

describe('what a tenant starts with', () => {
  it('has a published default survey with three triggers', async () => {
    const response = await request<{ status: string; version: number; triggers: { kind: string }[] }>('/api/v1/surveys/csat', {
      token: tenant.people.admin!.token,
    });
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('published');
    expect(response.body.version).toBe(1);
    expect(response.body.triggers.map((trigger) => trigger.kind).sort()).toEqual(['incident.major.resolved', 'request.fulfilled', 'ticket.resolved']);
  });
});

describe('a resolved ticket', () => {
  let ticketId: string;
  let token: string;

  it('asks the requester once, by notification, with a link', async () => {
    ticketId = await raiseAndResolve('Survey: the printer was fixed');

    const invitations = await request<{ data: { id: string; status: string; recipientId: string }[] }>(`/api/v1/survey-invitations?ticketId=${ticketId}`, {
      token: tenant.people.admin!.token,
    });
    expect(invitations.body.data).toHaveLength(1);
    expect(invitations.body.data[0]!.recipientId).toBe(tenant.people.requester!.id);
    expect(invitations.body.data[0]!.status).toBe('pending');

    const notification = await read((tx) =>
      tx.notification.findFirst({ where: { recipientId: tenant.people.requester!.id, templateKey: 'survey.invited' }, orderBy: { createdAt: 'desc' } }),
    );
    expect(notification).not.toBeNull();
    token = linkFrom(notification!.body);
  });

  it('opens the page from the link with no session at all', async () => {
    const json = await request<{ status: string; survey: { key: string; version: number }; questions: { field: string }[] }>(`/api/v1/public/surveys/${token}`);
    expect(json.status).toBe(200);
    expect(json.body.status).toBe('pending');
    expect(json.body.survey).toMatchObject({ key: 'csat', version: 1 });
    expect(json.body.questions.map((question) => question.field)).toEqual(['rating', 'comment']);

    const html = await request<string>(`/api/v1/public/surveys/${token}`, { headers: { accept: 'text/html' } });
    expect(html.status).toBe(200);
    expect(String(html.headers['content-type'])).toContain('text/html');
    expect(html.body).toContain('<form method="post"');
    expect(html.body).toContain('name="rating"');
  });

  it('refuses a link somebody has tampered with', async () => {
    const [encoded, signature] = token.split('.');
    const forged = await request(`/api/v1/public/surveys/${encoded}.${signature!.slice(0, -2)}zz`);
    expect(forged.status).toBe(404);
  });

  it('records the answer against the version shown, and scores it for MOD-12', async () => {
    const answered = await request<{ ok: boolean; score: number; thanks: string }>(`/api/v1/public/surveys/${token}`, {
      method: 'POST',
      body: { rating: 4, comment: 'Quick, and they explained what went wrong.' },
    });
    expect(answered.status).toBe(200);
    expect(answered.body.score).toBe(75);
    expect(answered.body.thanks).toContain('Thank you');

    const responses = await request<{ data: { score: number; scale: string; comment: string; via: string }[] }>(`/api/v1/survey-responses?ticketId=${ticketId}`, {
      token: tenant.people.admin!.token,
    });
    expect(responses.body.data).toHaveLength(1);
    expect(responses.body.data[0]).toMatchObject({ score: 75, scale: '1-5', via: 'portal' });

    await drainEvents(tenant.id);
    const fact = await read((tx) => tx.factSurvey.findFirst({ where: { ticketId } }));
    expect(fact).not.toBeNull();
    expect(fact!.score).toBe(75);
  });

  it('will not take a second answer', async () => {
    const again = await request(`/api/v1/public/surveys/${token}`, { method: 'POST', body: { rating: 1 } });
    expect(again.status).toBe(403);
    const page = await request<{ status: string }>(`/api/v1/public/surveys/${token}`);
    expect(page.body.status).toBe('responded');
  });

  it('names the question when an answer does not fit', async () => {
    const fresh = await raiseAndResolve('Survey: a second ticket for validation', tenant.people.otherRequester!.token);
    const notification = await read((tx) =>
      tx.notification.findFirst({ where: { recipientId: tenant.people.otherRequester!.id, templateKey: 'survey.invited' }, orderBy: { createdAt: 'desc' } }),
    );
    const other = linkFrom(notification!.body);
    const bad = await request<{ error?: unknown; message?: string }>(`/api/v1/public/surveys/${other}`, { method: 'POST', body: { comment: 'forgot the rating' } });
    expect(bad.status).toBe(422);
    expect(JSON.stringify(bad.body)).toContain('rating');
    expect(fresh).toBeTruthy();
  });

  it('does not ask the same person again inside the throttle window', async () => {
    const second = await raiseAndResolve('Survey: the same requester, a day later');
    const invitations = await request<{ data: unknown[] }>(`/api/v1/survey-invitations?ticketId=${second}`, { token: tenant.people.admin!.token });
    // Asked about the first ticket minutes ago; the window is seven days.
    expect(invitations.body.data).toHaveLength(0);
  });

  it('does not ask a person who resolved their own ticket', async () => {
    const created = await request<{ id: string }>('/api/v1/tickets', {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: { type: 'incident', title: 'Survey: admin sorts their own', priority: 'P4' },
    });
    await drainEvents(tenant.id);
    for (const to of ['in_progress', 'resolved']) {
      await request(`/api/v1/tickets/${created.body.id}/transitions`, { method: 'POST', token: tenant.people.admin!.token, body: { to, reason: 'self' } });
      await drainEvents(tenant.id);
    }
    const invitations = await request<{ data: unknown[] }>(`/api/v1/survey-invitations?ticketId=${created.body.id}`, { token: tenant.people.admin!.token });
    expect(invitations.body.data).toHaveLength(0);
  });
});

describe('who may see what', () => {
  it('lets a lead see responses about their own team only', async () => {
    const response = await request<{ data: unknown[] }>('/api/v1/survey-responses', { token: tenant.people.lead!.token });
    expect(response.status).toBe(200);
    // The tickets above were unrouted, so the lead's team has none.
    expect(response.body.data).toEqual([]);
  });

  it('keeps survey design to managers', async () => {
    const refused = await request('/api/v1/surveys', {
      method: 'POST',
      token: tenant.people.lead!.token,
      body: { key: 'nps', name: 'NPS', document: { title: 'x', schema: { type: 'object', properties: {} }, ui: { elements: [] } } },
    });
    expect(refused.status).toBe(403);
  });
});

describe('in the thread', () => {
  const sent: OutboundChat[] = [];
  let ticketId: string;
  let invitationId: string;

  const fake: ChatTransport = {
    name: 'slack',
    channel: 'slack',
    verify: () => ({ ok: true }),
    parseInbound: () => null,
    async send(message) {
      sent.push(message);
      return { messageId: `m-${sent.length}` };
    },
  };

  /**
   * A message in the ticket's thread, as a transport would parse it. Neither a
   * direct message nor a mention: a reply inside a thread the desk opened is
   * addressed by being in the thread, which is the case this exercises.
   */
  function parsed(overrides: { senderExternalId: string; body?: string; action?: unknown }): ParsedChat {
    const text = overrides.body ?? '';
    return {
      channel: 'slack',
      externalMessageId: `evt-${Math.random().toString(36).slice(2)}`,
      fromAddress: overrides.senderExternalId,
      subject: null,
      body: text,
      headers: {},
      sizeBytes: Buffer.byteLength(text),
      raw: {},
      chat: { senderId: overrides.senderExternalId, text, direct: false, mentioned: false, sizeBytes: Buffer.byteLength(text) },
      identity: { externalId: overrides.senderExternalId, email: null, emailVerified: false, displayName: 'Someone' },
      threadId: 'thread-1',
      roomId: 'C-ROOM',
      ...(overrides.action !== undefined ? { action: overrides.action } : {}),
    };
  }

  it('posts the survey into the ticket\'s conversation, with buttons', async () => {
    registerChatTransport(fake);
    const context = ctx();

    // A Slack account, a conversation for a ticket, and the requester linked.
    ticketId = await raiseAndResolve('Survey: raised from Slack', tenant.people.otherRequester!.token);
    // The other requester was asked minutes ago about the validation ticket, so
    // this one was throttled; clear that so the thread test has an invitation.
    await read((tx) => tx.surveyInvitation.updateMany({ where: { recipientId: tenant.people.otherRequester!.id }, data: { sentAt: new Date(Date.now() - 30 * 24 * 3600 * 1000) } }));

    await read(async (tx) => {
      const account = await tx.channelAccount.create({
        data: { id: '44444444-4444-4444-8444-444444444444', tenantId: tenant.id, channel: 'slack', key: 'slack-test', name: 'Slack', address: 'slack-test', config: { transport: 'slack' } as never },
      });
      await tx.conversation.create({
        data: { id: '55555555-5555-4555-8555-555555555555', tenantId: tenant.id, accountId: account.id, channel: 'slack', ticketId, externalThreadId: 'thread-1', state: { roomId: 'C-ROOM' } as never },
      });
      await tx.channelIdentity.create({
        data: { id: '66666666-6666-4666-8666-666666666666', tenantId: tenant.id, channel: 'slack', accountId: account.id, externalId: 'U-REQUESTER', userId: tenant.people.otherRequester!.id, verified: true, method: 'one_time_code' } as never,
      });
    });

    // Ask directly for this ticket, then post it the way the job would.
    const invited = await withContext(context, () =>
      transaction(context, (tx) => invitationService.inviteForTrigger(context, tx, 'ticket.resolved', { ticketId, actorId: null })),
    );
    expect(invited.invited).toBe(true);
    invitationId = invited.invitationId!;

    const posted = await withContext(context, () => invitationService.postToChat(context, invitationId));
    expect(posted.posted).toBe(true);
    expect(sent.at(-1)?.roomId).toBe('C-ROOM');
    expect(sent.at(-1)?.actions?.map((action) => action.label)).toEqual(['1', '2', '3', '4', '5']);
  });

  it('refuses a rating from somebody who is not the requester', async () => {
    // A button press carries its label as the text, as the Slack transport
    // parses it; the guard refuses an empty message before anything else.
    const outcome = await handleChat(
      parsed({ senderExternalId: 'U-SOMEBODY-ELSE', body: '5', action: { action: 'custom', name: 'survey', data: { invitationId, value: 5 } } }),
      'slack-test',
    );
    expect(outcome.reply).toContain('only they can answer');
    const invitation = await read((tx) => tx.surveyInvitation.findFirst({ where: { id: invitationId } }));
    expect(invitation!.status).toBe('pending');
  });

  it('takes the requester\'s typed reply as the answer', async () => {
    const outcome = await handleChat(parsed({ senderExternalId: 'U-REQUESTER', body: '4' }), 'slack-test');
    expect(outcome.status).toBe('accepted');
    const response = await read((tx) => tx.surveyResponse.findFirst({ where: { invitationId } }));
    expect(response).not.toBeNull();
    expect(response!.score).toBe(75);
    expect(response!.via).toBe('slack');
  });
});

// Last, because publishing a new version changes what every later ask looks
// like: a 0–10 scale has no buttons (eleven is a keyboard, not a question) and
// a "4" typed against it scores 40, which the thread tests above must not see.
describe('designing a survey', () => {
  it('publishes a new version without touching answers already given', async () => {
    const patched = await request(`/api/v1/surveys/csat`, {
      method: 'PATCH',
      token: tenant.people.admin!.token,
      body: {
        document: {
          title: 'How did we do?',
          thanks: 'Thanks!',
          schema: {
            type: 'object',
            properties: { rating: { type: 'integer', title: 'Rate us', minimum: 0, maximum: 10 } },
            required: ['rating'],
          },
          ui: { elements: [{ kind: 'field', field: 'rating', label: 'Rate us', control: 'number' }] },
          scoring: { field: 'rating', min: 0, max: 10 },
        },
      },
    });
    expect(patched.status).toBe(200);

    const published = await request<{ version: number }>(`/api/v1/surveys/csat/publish`, { method: 'POST', token: tenant.people.admin!.token });
    expect(published.status).toBe(200);
    expect(published.body.version).toBe(2);

    // The earlier response still says 1–5, because that is what was asked.
    const responses = await request<{ data: { scale: string }[] }>('/api/v1/survey-responses?survey=csat', { token: tenant.people.admin!.token });
    expect(responses.body.data.every((row) => row.scale === '1-5')).toBe(true);
  });

  it('refuses to publish a document that does not hang together', async () => {
    await request(`/api/v1/surveys/csat`, {
      method: 'PATCH',
      token: tenant.people.admin!.token,
      body: {
        document: {
          title: 'Broken',
          schema: { type: 'object', properties: { rating: { type: 'string', title: 'Rate us' } }, required: ['rating'] },
          ui: { elements: [{ kind: 'field', field: 'rating', label: 'Rate us', control: 'text' }] },
          scoring: { field: 'rating', min: 1, max: 5 },
        },
      },
    });
    const published = await request(`/api/v1/surveys/csat/publish`, { method: 'POST', token: tenant.people.admin!.token });
    expect(published.status).toBe(422);
  });
});
