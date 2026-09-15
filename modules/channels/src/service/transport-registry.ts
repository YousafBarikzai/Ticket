import { z } from 'zod';
import { logger, type TenantContext } from '@itsm/platform';
import { emailTransport, type EmailTransport } from './email-transport.js';
import { microsoftGraphTransport, type GraphOptions } from './microsoft-graph.js';
import { postmarkTransport, type PostmarkOptions } from './postmark.js';
import { missingCredentials, resolveCredential } from './credentials.js';

/**
 * Which provider a given mailbox uses (OD-03, closed as "both, per tenant").
 *
 * The choice lives on the channel account rather than in deployment
 * configuration, because it is a customer's decision and not an operator's: one
 * tenant's data-residency commitment should not decide another's mail provider.
 * A tenant whose DPIA requires mail to stay inside their own Microsoft
 * geography picks Graph; everyone else gets Postmark, which is simpler.
 *
 * Secrets are not here. The account names a credential and the value is
 * resolved from the environment (see credentials.ts), so the tenant-editable
 * JSON never holds a token.
 */

export const transportConfigSchema = z.discriminatedUnion('transport', [
  z.object({ transport: z.literal('development') }).passthrough(),
  z
    .object({
      transport: z.literal('postmark'),
      tokenRef: z.string().min(1).max(60),
      webhookSecretRef: z.string().min(1).max(60).optional(),
      apiBase: z.string().url().optional(),
    })
    .passthrough(),
  z
    .object({
      transport: z.literal('microsoft-graph'),
      /** The customer's Entra tenant, which is not this platform's tenant id. */
      graphTenantId: z.string().min(1).max(100),
      clientId: z.string().min(1).max(100),
      clientSecretRef: z.string().min(1).max(60),
      mailbox: z.string().min(3).max(320),
      clientStateRef: z.string().min(1).max(60),
      apiBase: z.string().url().optional(),
      loginBase: z.string().url().optional(),
    })
    .passthrough(),
]);

export type TransportConfig = z.infer<typeof transportConfigSchema>;

/**
 * Builds the transport an account is configured for.
 *
 * Returns null rather than falling back to another provider when the
 * configuration is wrong. A silent fallback would send a tenant's mail through
 * a provider they specifically did not choose, which for the Graph case means
 * breaking the commitment that made them choose it.
 */
export async function transportForAccount(
  config: unknown,
  ctx: TenantContext | null = null,
): Promise<EmailTransport | null> {
  const parsed = transportConfigSchema.safeParse(config);
  if (!parsed.success) {
    logger.warn('a channel account has no usable transport configuration', {
      problems: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    });
    return null;
  }

  switch (parsed.data.transport) {
    case 'development':
      // Registered only outside production (see @itsm/runtime), so in
      // production this resolves to null and mail fails loudly instead of
      // disappearing into a transport that verifies nothing.
      return emailTransport('development') ?? null;

    case 'postmark': {
      // Resolved here, once, so the adapter holds a value rather than a
      // reference: it never reaches for a credential store, never has to be
      // async where the transport interface is synchronous, and can be tested
      // without either.
      const token = await resolveCredential(parsed.data.tokenRef, ctx);
      if (!token) {
        logger.warn('this mailbox names a Postmark token that is not configured', { ref: parsed.data.tokenRef });
        return null;
      }
      const webhookSecret = await resolveCredential(parsed.data.webhookSecretRef, ctx);
      const options: PostmarkOptions = {
        token: token.value,
        ...(webhookSecret ? { webhookSecret: webhookSecret.value } : {}),
        ...(parsed.data.apiBase ? { apiBase: parsed.data.apiBase } : {}),
      };
      return postmarkTransport(options);
    }

    case 'microsoft-graph': {
      const clientSecret = await resolveCredential(parsed.data.clientSecretRef, ctx);
      const clientState = await resolveCredential(parsed.data.clientStateRef, ctx);
      if (!clientSecret || !clientState) {
        logger.warn('this mailbox names Graph credentials that are not configured', {
          missing: [
            clientSecret ? null : parsed.data.clientSecretRef,
            clientState ? null : parsed.data.clientStateRef,
          ].filter(Boolean),
        });
        return null;
      }
      const options: GraphOptions = {
        tenantId: parsed.data.graphTenantId,
        clientId: parsed.data.clientId,
        clientSecret: clientSecret.value,
        mailbox: parsed.data.mailbox,
        clientState: clientState.value,
        ...(parsed.data.apiBase ? { apiBase: parsed.data.apiBase } : {}),
        ...(parsed.data.loginBase ? { loginBase: parsed.data.loginBase } : {}),
      };
      return microsoftGraphTransport(options);
    }
  }
}

export interface ConfigurationProblem {
  code: string;
  message: string;
}

/**
 * What is wrong with an account's transport configuration, before it is saved.
 *
 * Checked at configuration time rather than at the first message, because the
 * symptom of a missing credential is "mail stopped arriving", which nobody
 * notices for a day and nobody can diagnose from the outside.
 */
export async function checkTransportConfig(
  config: unknown,
  ctx: TenantContext | null = null,
): Promise<ConfigurationProblem[]> {
  const parsed = transportConfigSchema.safeParse(config);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => ({
      code: 'invalid',
      message: `${issue.path.join('.') || 'transport'}: ${issue.message}`,
    }));
  }

  const problems: ConfigurationProblem[] = [];
  const refs: (string | undefined)[] =
    parsed.data.transport === 'postmark'
      ? [parsed.data.tokenRef, parsed.data.webhookSecretRef]
      : parsed.data.transport === 'microsoft-graph'
        ? [parsed.data.clientSecretRef, parsed.data.clientStateRef]
        : [];

  for (const name of await missingCredentials(refs, ctx)) {
    problems.push({ code: 'missing_credential', message: `${name} is not set in this environment` });
  }

  if (parsed.data.transport === 'postmark' && !parsed.data.webhookSecretRef) {
    // Postmark does not sign its webhooks, so without a shared secret the
    // inbound endpoint would accept anything. The adapter refuses in that case;
    // saying so here means somebody finds out while configuring rather than
    // when mail silently stops being accepted.
    problems.push({
      code: 'no_inbound_verification',
      message:
        'Postmark does not sign inbound webhooks, so without a webhookSecretRef this mailbox will refuse every delivery',
    });
  }

  if (parsed.data.transport === 'development' && process.env.NODE_ENV === 'production') {
    problems.push({
      code: 'development_transport_in_production',
      message: 'the development transport verifies nothing and is not registered in production',
    });
  }

  return problems;
}
