import { describe, expect, it } from 'vitest';
import { slackTransport } from '../service/slack.js';
import { teamsTransport } from '../service/teams.js';
import { parseAction, parseMessage, parseSlash } from '../domain/chat-commands.js';
import { guardChat } from '../domain/chat-guard.js';

/**
 * Parsing, not sending. What each provider puts on the wire is fixed by them
 * and the interesting failures are all in reading it: the wrong identifier for
 * a person, a thread key that starts a new thread every time, a button payload
 * taken on trust.
 */

const slack = slackTransport({ botTokenRef: 'slack-bot', signingSecretRef: 'slack-signing', botUserId: 'U0DESK' });
const teams = teamsTransport({ secretRef: 'teams-secret' });

describe('the Slack adapter', () => {
  const event = (over: Record<string, unknown> = {}, envelope: Record<string, unknown> = {}) =>
    slack.parseInbound(
      { event: { type: 'message', user: 'U0ALICE', channel: 'C0HELP', ts: '1700.1', text: 'hello', ...over }, event_id: 'Ev1', ...envelope },
      {},
    );

  it('reads a channel message', () => {
    const parsed = event();
    expect(parsed?.fromAddress).toBe('U0ALICE');
    expect(parsed?.roomId).toBe('C0HELP');
    expect(parsed?.channel).toBe('slack');
  });

  it('de-duplicates on the delivery id, because Slack re-delivers', () => {
    // Slack retries on any non-2xx and on its own timeout, so the same message
    // arrives more than once and the id is what stops a duplicate ticket.
    expect(event()?.externalMessageId).toBe('Ev1');
  });

  it('threads a reply at the message when there is no thread yet', () => {
    // Without this every reply starts its own thread and the conversation
    // scatters down the channel.
    expect(event()?.threadId).toBe('1700.1');
    expect(event({ thread_ts: '1699.0' })?.threadId).toBe('1699.0');
  });

  it('knows a direct message from a channel one', () => {
    expect(event({ channel_type: 'im' })?.chat.direct).toBe(true);
    expect(event()?.chat.direct).toBe(false);
  });

  it('detects a mention from the text rather than from membership', () => {
    // Being in a channel is not being spoken to, and the authorization list
    // says only that the bot can see the message.
    expect(event({ text: '<@U0DESK> my laptop died' })?.chat.mentioned).toBe(true);
    expect(event({ text: 'unrelated chatter' })?.chat.mentioned).toBe(false);
  });

  it('carries the bot id through so the guard can drop it', () => {
    expect(event({ bot_id: 'B0DEPLOY', user: undefined })?.chat.botId).toBe('B0DEPLOY');
  });

  it('reads a slash command as addressed wherever it was typed', () => {
    const parsed = slack.parseInbound({ command: '/ticket', text: 'printer jammed', user_id: 'U0ALICE', channel_id: 'C0HELP', trigger_id: 'T1' }, {});
    expect(parsed?.slashText).toBe('printer jammed');
    expect(parsed?.chat.mentioned).toBe(true);
    expect(parseSlash({ text: parsed!.slashText! }).kind).toBe('createTicket');
  });

  it('reads an interactive button and hands the payload on to be validated', () => {
    const payload = JSON.stringify({
      user: { id: 'U0ALICE' },
      channel: { id: 'C0HELP' },
      container: { message_ts: '1700.1' },
      actions: [{ value: JSON.stringify({ action: 'approve', subjectId: '00000000-0000-4000-8000-000000000001' }) }],
      trigger_id: 'T2',
    });
    const parsed = slack.parseInbound({ payload }, {});
    expect(parseAction(parsed?.action)).toEqual({
      kind: 'decideApproval',
      approvalId: '00000000-0000-4000-8000-000000000001',
      decision: 'approved',
    });
  });

  it('refuses a button whose value is not the JSON the desk writes', () => {
    const payload = JSON.stringify({
      user: { id: 'U0ALICE' },
      channel: { id: 'C0HELP' },
      actions: [{ value: 'approve-everything' }],
    });
    expect(slack.parseInbound({ payload }, {})).toBeNull();
  });

  it('returns nothing rather than half a message when a field is missing', () => {
    expect(slack.parseInbound({ event: { type: 'message', text: 'x' } }, {})).toBeNull();
    expect(slack.parseInbound({}, {})).toBeNull();
    expect(slack.parseInbound({ payload: 'not json' }, {})).toBeNull();
  });

  it('refuses to verify when the signing secret is not configured', () => {
    // The dangerous default: an unconfigured account accepting everything.
    expect(slack.verify({ rawBody: '{}', headers: {}, url: 'https://x.test/hook' }).ok).toBe(false);
  });
});

describe('the Teams adapter', () => {
  const activity = (over: Record<string, unknown> = {}) =>
    teams.parseInbound(
      {
        type: 'message',
        id: 'A1',
        from: { id: 'bot-scoped-id', aadObjectId: 'aad-alice', name: 'Alice', userPrincipalName: 'alice@acme.example' },
        conversation: { id: 'C1', conversationType: 'channel' },
        text: '<at>Service Desk</at> printer jammed',
        ...over,
      },
      {},
    );

  it('identifies a person by their directory object id, not the bot-scoped one', () => {
    // `from.id` changes if the bot is reinstalled, which would orphan every
    // linked identity.
    expect(activity()?.fromAddress).toBe('aad-alice');
  });

  it('carries the principal name as an email the directory vouched for', () => {
    const parsed = activity();
    expect(parsed?.identity.email).toBe('alice@acme.example');
    expect(parsed?.identity.emailVerified).toBe(true);
  });

  it('does not claim verification without a directory id', () => {
    expect(activity({ from: { id: 'anon', userPrincipalName: 'x@acme.example' } })?.identity.emailVerified).toBe(false);
  });

  it('treats a personal conversation as direct', () => {
    expect(activity({ conversation: { id: 'C1', conversationType: 'personal' } })?.chat.direct).toBe(true);
    expect(activity()?.chat.direct).toBe(false);
  });

  it('threads on the root activity', () => {
    expect(activity()?.threadId).toBe('A1');
    expect(activity({ replyToId: 'A0' })?.threadId).toBe('A0');
  });

  it('reads an Adaptive Card action', () => {
    const parsed = teams.parseInbound(
      {
        type: 'invoke',
        id: 'A2',
        from: { aadObjectId: 'aad-alice' },
        conversation: { id: 'C1', conversationType: 'personal' },
        value: { action: { data: { action: 'reject', subjectId: '00000000-0000-4000-8000-000000000002' } } },
      },
      {},
    );
    expect(parseAction(parsed?.action)).toEqual({
      kind: 'decideApproval',
      approvalId: '00000000-0000-4000-8000-000000000002',
      decision: 'rejected',
    });
  });

  it('strips the mention so the ticket is not titled with the bot’s name', () => {
    const parsed = activity();
    expect(parseMessage({ text: parsed!.body! })).toMatchObject({ kind: 'createTicket', subject: 'printer jammed' });
  });

  it('returns nothing for an activity it cannot place', () => {
    expect(teams.parseInbound({ type: 'message' }, {})).toBeNull();
    expect(teams.parseInbound({}, {})).toBeNull();
  });

  it('refuses to verify without a configured secret', () => {
    expect(teams.verify({ rawBody: '{}', headers: { authorization: 'HMAC abc' }, url: 'https://x.test' }).ok).toBe(false);
  });
});

describe('the adapters feed the guard the signals it needs', () => {
  it('lets the guard drop the desk’s own Slack message', () => {
    const parsed = slack.parseInbound(
      { event: { type: 'message', user: 'U0DESK', channel: 'C0HELP', ts: '1700.2', text: 'Thanks, raised REQ-000123.' }, event_id: 'Ev2' },
      {},
    );
    const verdict = guardChat(parsed!.chat, {
      ownBotUserId: 'U0DESK',
      maxBytes: 10_000,
      recentFromSender: 0,
      maxPerSenderPerHour: 30,
    });
    expect(verdict.reason).toBe('loop_detected');
  });
});
