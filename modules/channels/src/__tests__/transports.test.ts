import { describe, expect, it } from 'vitest';
import { postmarkTransport } from '../service/postmark.js';
import { microsoftGraphTransport } from '../service/microsoft-graph.js';
import { checkTransportConfig, transportForAccount } from '../service/transport-registry.js';
import { environmentNameFor, missingCredentials, resolveCredential } from '../service/credentials.js';

/**
 * These test the two places a mistake would be expensive: verification, where
 * being wrong means an open door into the ticket system, and configuration,
 * where being wrong means mail silently stops.
 */

describe('credentials by reference', () => {
  it('never reads a secret out of the account configuration', () => {
    // The account's config is tenant-editable JSON. A token in it would be
    // readable by anyone who can configure a mailbox, and would appear in every
    // audit payload and configuration export.
    expect(environmentNameFor('graph-acme')).toBe('ITSM_CREDENTIAL_GRAPH_ACME');
    expect(environmentNameFor('postmark.main')).toBe('ITSM_CREDENTIAL_POSTMARK_MAIN');
  });

  it('reports a missing credential rather than failing later', () => {
    const env = { ITSM_CREDENTIAL_PRESENT: 'x' } as NodeJS.ProcessEnv;
    expect(resolveCredential('present', env)?.value).toBe('x');
    expect(resolveCredential('absent', env)).toBeNull();
    expect(missingCredentials(['present', 'absent'], env)).toEqual(['ITSM_CREDENTIAL_ABSENT']);
  });
});

describe('Postmark inbound verification', () => {
  const secretEnv = 'ITSM_CREDENTIAL_PM_SECRET';

  it('refuses a delivery when no secret is configured', () => {
    // The failure that matters: "no signature configured" must not read as
    // "verified", or the inbound endpoint is open to anyone who finds the URL.
    const transport = postmarkTransport({ tokenRef: 'pm-token', webhookSecretRef: 'nothing-here' });
    expect(transport.verify('{}', {})).toBe(false);
  });

  it('refuses a delivery presenting no secret at all', () => {
    process.env[secretEnv] = 'the-shared-secret';
    try {
      const transport = postmarkTransport({ tokenRef: 'pm-token', webhookSecretRef: 'pm-secret' });
      expect(transport.verify('{}', {})).toBe(false);
    } finally {
      delete process.env[secretEnv];
    }
  });

  it('accepts the configured secret and refuses a wrong one', () => {
    process.env[secretEnv] = 'the-shared-secret';
    try {
      const transport = postmarkTransport({ tokenRef: 'pm-token', webhookSecretRef: 'pm-secret' });
      expect(transport.verify('{}', { 'x-webhook-secret': 'the-shared-secret' })).toBe(true);
      expect(transport.verify('{}', { 'x-webhook-secret': 'the-shared-secrex' })).toBe(false);
      expect(transport.verify('{}', { 'x-webhook-secret': 'the-shared-secret-and-more' })).toBe(false);
    } finally {
      delete process.env[secretEnv];
    }
  });

  it('parses an inbound message into the shape the platform already handles', () => {
    const transport = postmarkTransport({ tokenRef: 'pm-token' });
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
    const transport = postmarkTransport({ tokenRef: 'pm-token' });
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
  const stateEnv = 'ITSM_CREDENTIAL_GRAPH_STATE';
  const options = {
    tenantId: 'entra-tenant',
    clientId: 'client',
    clientSecretRef: 'graph-secret',
    mailbox: 'servicedesk@acme.test',
    clientStateRef: 'graph-state',
  };

  it('refuses a notification with no clientState', () => {
    // Graph does not sign notifications; the echoed clientState is the only
    // thing distinguishing a real one from anybody who guesses the URL.
    process.env[stateEnv] = 'shared-state';
    try {
      const transport = microsoftGraphTransport(options);
      expect(transport.verify(JSON.stringify({ value: [{ resourceData: { id: 'm1' } }] }), {})).toBe(false);
    } finally {
      delete process.env[stateEnv];
    }
  });

  it('accepts a batch where every notification matches', () => {
    process.env[stateEnv] = 'shared-state';
    try {
      const transport = microsoftGraphTransport(options);
      const body = JSON.stringify({ value: [{ clientState: 'shared-state' }, { clientState: 'shared-state' }] });
      expect(transport.verify(body, {})).toBe(true);
    } finally {
      delete process.env[stateEnv];
    }
  });

  it('refuses a batch where one notification is somebody else\'s', () => {
    // Accepting the batch would accept theirs along with ours.
    process.env[stateEnv] = 'shared-state';
    try {
      const transport = microsoftGraphTransport(options);
      const body = JSON.stringify({ value: [{ clientState: 'shared-state' }, { clientState: 'someone-else' }] });
      expect(transport.verify(body, {})).toBe(false);
    } finally {
      delete process.env[stateEnv];
    }
  });

  it('refuses a body that is not a notification at all', () => {
    process.env[stateEnv] = 'shared-state';
    try {
      const transport = microsoftGraphTransport(options);
      expect(transport.verify('not json', {})).toBe(false);
      expect(transport.verify('{}', {})).toBe(false);
    } finally {
      delete process.env[stateEnv];
    }
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
  it('builds the provider the account names', () => {
    expect(transportForAccount({ transport: 'postmark', tokenRef: 'pm' })?.name).toBe('postmark');
    expect(
      transportForAccount({
        transport: 'microsoft-graph',
        graphTenantId: 't',
        clientId: 'c',
        clientSecretRef: 's',
        mailbox: 'a@b.test',
        clientStateRef: 'cs',
      })?.name,
    ).toBe('microsoft-graph');
  });

  it('returns nothing rather than falling back to another provider', () => {
    // A silent fallback would send a tenant's mail through a provider they
    // specifically did not choose — and for the Graph case, that breaks the
    // data-residency commitment that made them choose it.
    expect(transportForAccount({ transport: 'postmark' })).toBeNull();
    expect(transportForAccount({ transport: 'carrier-pigeon' })).toBeNull();
    expect(transportForAccount(null)).toBeNull();
  });

  it('names what is missing before the account is saved', () => {
    const env = {} as NodeJS.ProcessEnv;
    const problems = checkTransportConfig({ transport: 'postmark', tokenRef: 'pm', webhookSecretRef: 'pmw' }, env);
    expect(problems.map((p) => p.message)).toEqual([
      'ITSM_CREDENTIAL_PM is not set in this environment',
      'ITSM_CREDENTIAL_PMW is not set in this environment',
    ]);
  });

  it('warns that a Postmark mailbox without a shared secret will refuse everything', () => {
    const env = { ITSM_CREDENTIAL_PM: 'token' } as NodeJS.ProcessEnv;
    const problems = checkTransportConfig({ transport: 'postmark', tokenRef: 'pm' }, env);
    expect(problems.map((p) => p.code)).toContain('no_inbound_verification');
  });

  it('passes a fully configured Graph mailbox', () => {
    const env = {
      ITSM_CREDENTIAL_GRAPH_SECRET: 'secret',
      ITSM_CREDENTIAL_GRAPH_STATE: 'state',
    } as NodeJS.ProcessEnv;
    const problems = checkTransportConfig(
      {
        transport: 'microsoft-graph',
        graphTenantId: 't',
        clientId: 'c',
        clientSecretRef: 'graph-secret',
        mailbox: 'servicedesk@acme.test',
        clientStateRef: 'graph-state',
      },
      env,
    );
    expect(problems).toEqual([]);
  });
});
