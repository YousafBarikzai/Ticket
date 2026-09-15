import { beforeEach, describe, expect, it } from 'vitest';
import { environmentResolver, registerSecretResolver, resetSecretResolvers } from '@itsm/platform';
import { postmarkTransport } from '../service/postmark.js';
import { microsoftGraphTransport } from '../service/microsoft-graph.js';
import { checkTransportConfig, transportForAccount } from '../service/transport-registry.js';
import { environmentNameFor } from '../service/credentials.js';

/**
 * These test the two places a mistake would be expensive: verification, where
 * being wrong means an open door into the ticket system, and configuration,
 * where being wrong means mail silently stops.
 */

describe('credentials by reference', () => {
  it('never reads a secret out of the account configuration', () => {
    // The account's config is tenant-editable JSON. A token in it would be
    // readable by anyone who can configure a mailbox, and would appear in every
    // audit payload and configuration export — so the config holds a name and
    // the platform resolves it (Phase 4 put an encrypted store in front of the
    // environment without this file changing).
    expect(environmentNameFor('graph-acme')).toBe('ITSM_CREDENTIAL_GRAPH_ACME');
    expect(environmentNameFor('postmark.main')).toBe('ITSM_CREDENTIAL_POSTMARK_MAIN');
  });
});

describe('Postmark inbound verification', () => {
  it('refuses a delivery when no secret is configured', () => {
    // The failure that matters: "no signature configured" must not read as
    // "verified", or the inbound endpoint is open to anyone who finds the URL.
    const transport = postmarkTransport({ token: 'pm-token' });
    expect(transport.verify('{}', {})).toBe(false);
  });

  it('refuses a delivery presenting no secret at all', () => {
      const transport = postmarkTransport({ token: 'pm-token', webhookSecret: 'the-shared-secret' });
      expect(transport.verify('{}', {})).toBe(false);
  });

  it('accepts the configured secret and refuses a wrong one', () => {
      const transport = postmarkTransport({ token: 'pm-token', webhookSecret: 'the-shared-secret' });
      expect(transport.verify('{}', { 'x-webhook-secret': 'the-shared-secret' })).toBe(true);
      expect(transport.verify('{}', { 'x-webhook-secret': 'the-shared-secrex' })).toBe(false);
      expect(transport.verify('{}', { 'x-webhook-secret': 'the-shared-secret-and-more' })).toBe(false);
  });

  it('parses an inbound message into the shape the platform already handles', () => {
    const transport = postmarkTransport({ token: 'pm-token' });
    const parsed = transport.parseInbound({
      MessageID: 'pm-1',
      FromFull: { Email: 'Ada@Example.TEST' },
      Subject: 'VPN again',
      TextBody: 'It is still broken.',
      Headers: [{ Name: 'In-Reply-To', Value: '<abc@itsm>' }],
    }, {});
    expect(parsed).toMatchObject({
      channel: 'email',
      externalMessageId: 'pm-1',
      // Lower-cased, because address comparison downstream is exact.
      fromAddress: 'ada@example.test',
      subject: 'VPN again',
      body: 'It is still broken.',
    });
    expect(parsed?.headers['in-reply-to']).toBe('<abc@itsm>');
  });

  it('falls back to the HTML body when there is no text part', () => {
    const transport = postmarkTransport({ token: 'pm-token' });
    const parsed = transport.parseInbound({
      MessageID: 'pm-2',
      FromFull: { Email: 'ada@example.test' },
      HtmlBody: '<p>Line one</p><p>Line&nbsp;two</p><script>ignored()</script>',
    }, {});
    expect(parsed?.body).toContain('Line one');
    expect(parsed?.body).toContain('Line two');
    expect(parsed?.body).not.toContain('ignored');
  });
});

describe('Microsoft Graph notification verification', () => {
  const options = {
    tenantId: 'entra-tenant',
    clientId: 'client',
    clientSecret: 'graph-secret',
    mailbox: 'servicedesk@acme.test',
    clientState: 'shared-state',
  };

  it('refuses a notification with no clientState', () => {
    // Graph does not sign notifications; the echoed clientState is the only
    // thing distinguishing a real one from anybody who guesses the URL.
      const transport = microsoftGraphTransport(options);
      expect(transport.verify(JSON.stringify({ value: [{ resourceData: { id: 'm1' } }] }), {})).toBe(false);
  });

  it('accepts a batch where every notification matches', () => {
      const transport = microsoftGraphTransport(options);
      const body = JSON.stringify({ value: [{ clientState: 'shared-state' }, { clientState: 'shared-state' }] });
      expect(transport.verify(body, {})).toBe(true);
  });

  it('refuses a batch where one notification is somebody else\'s', () => {
    // Accepting the batch would accept theirs along with ours.
      const transport = microsoftGraphTransport(options);
      const body = JSON.stringify({ value: [{ clientState: 'shared-state' }, { clientState: 'someone-else' }] });
      expect(transport.verify(body, {})).toBe(false);
  });

  it('refuses a body that is not a notification at all', () => {
      const transport = microsoftGraphTransport(options);
      expect(transport.verify('not json', {})).toBe(false);
      expect(transport.verify('{}', {})).toBe(false);
  });

  it('turns a notification into a pointer, because it carries no message', () => {
    const transport = microsoftGraphTransport(options);
    const parsed = transport.parseInbound({
      value: [{ resource: 'users/x/messages/m1', resourceData: { id: 'm1' }, clientState: 's' }],
    }, {});
    expect(parsed?.externalMessageId).toBe('m1');
    // No sender and no body: Graph tells you something changed, not what.
    expect(parsed?.fromAddress).toBe('');
    expect(parsed?.body).toBeNull();
  });
});

describe('choosing a transport per tenant', () => {
  // The platform resolves credential references through registered resolvers,
  // which `bootstrapModules` wires up at boot. A unit test has to do the same,
  // and the fact that nothing resolves without one is the point: a deployment
  // that forgets is a deployment where every credential is missing, loudly.
  beforeEach(() => {
    resetSecretResolvers();
    registerSecretResolver('environment', environmentResolver);
  });

  const env = (extra: Record<string, string> = {}) => {
    for (const [key, value] of Object.entries(extra)) process.env[key] = value;
    return () => {
      for (const key of Object.keys(extra)) delete process.env[key];
    };
  };

  it('builds the provider the account names', async () => {
    const cleanup = env({
      ITSM_CREDENTIAL_PM: 'token',
      ITSM_CREDENTIAL_GS: 'secret',
      ITSM_CREDENTIAL_GC: 'state',
    });
    try {
      expect((await transportForAccount({ transport: 'postmark', tokenRef: 'pm' }))?.name).toBe('postmark');
      expect(
        (
          await transportForAccount({
            transport: 'microsoft-graph',
            graphTenantId: 't',
            clientId: 'c',
            clientSecretRef: 'gs',
            mailbox: 'a@b.test',
            clientStateRef: 'gc',
          })
        )?.name,
      ).toBe('microsoft-graph');
    } finally {
      cleanup();
    }
  });

  it('returns nothing rather than falling back to another provider', async () => {
    // A silent fallback would send a tenant's mail through a provider they
    // specifically did not choose — and for the Graph case, that breaks the
    // data-residency commitment that made them choose it.
    expect(await transportForAccount({ transport: 'postmark' })).toBeNull();
    expect(await transportForAccount({ transport: 'carrier-pigeon' })).toBeNull();
    expect(await transportForAccount(null)).toBeNull();
  });

  it('returns nothing when the credential it names is not configured', async () => {
    // Rather than building a transport that will fail on its first send with a
    // message nobody can act on.
    expect(await transportForAccount({ transport: 'postmark', tokenRef: 'not-configured' })).toBeNull();
  });

  it('names what is missing before the account is saved', async () => {
    const problems = await checkTransportConfig({
      transport: 'postmark',
      tokenRef: 'absent-one',
      webhookSecretRef: 'absent-two',
    });
    expect(problems.map((p) => p.message)).toEqual([
      'ITSM_CREDENTIAL_ABSENT_ONE is not set in this environment',
      'ITSM_CREDENTIAL_ABSENT_TWO is not set in this environment',
    ]);
  });

  it('warns that a Postmark mailbox without a shared secret will refuse everything', async () => {
    const cleanup = env({ ITSM_CREDENTIAL_PM: 'token' });
    try {
      const problems = await checkTransportConfig({ transport: 'postmark', tokenRef: 'pm' });
      expect(problems.map((p) => p.code)).toContain('no_inbound_verification');
    } finally {
      cleanup();
    }
  });

  it('passes a fully configured Graph mailbox', async () => {
    const cleanup = env({ ITSM_CREDENTIAL_GRAPH_SECRET: 'secret', ITSM_CREDENTIAL_GRAPH_STATE: 'state' });
    try {
      const problems = await checkTransportConfig({
        transport: 'microsoft-graph',
        graphTenantId: 't',
        clientId: 'c',
        clientSecretRef: 'graph-secret',
        mailbox: 'servicedesk@acme.test',
        clientStateRef: 'graph-state',
      });
      expect(problems).toEqual([]);
    } finally {
      cleanup();
    }
  });
});
