/** MOD-03 Omnichannel — public interface (docs/architecture/04 §3). */
export { channelsManifest } from './manifest.js';
export * as inboundService from './service/inbound-service.js';
export { acceptInbound, normalise, execute, resolveAccountTenant, type ParsedInbound } from './service/inbound-service.js';
export {
  registerEmailTransport,
  emailTransport,
  registeredEmailTransports,
  developmentTransport,
  verifyHmac,
  constantTimeEquals,
  type EmailTransport,
  type OutboundEmail,
  type ProviderRef,
} from './service/email-transport.js';
export { postmarkTransport, type PostmarkOptions } from './service/postmark.js';
export {
  microsoftGraphTransport,
  fetchGraphMessage,
  renewGraphSubscription,
  type GraphOptions,
} from './service/microsoft-graph.js';
export {
  transportForAccount,
  checkTransportConfig,
  transportConfigSchema,
  type TransportConfig,
  type ConfigurationProblem,
} from './service/transport-registry.js';
export {
  resolveCredential,
  missingCredentials,
  environmentNameFor,
  type ResolvedCredential,
} from './service/credentials.js';
export {
  CHANNELS,
  channelCommandSchema,
  requiresVerifiedIdentity,
  UNVERIFIED_COMMANDS,
  REJECTION_REASONS,
  type Channel,
  type ChannelCommand,
  type RejectionReason,
} from './domain/commands.js';
export { guardInbound, type GuardVerdict, type InboundCandidate } from './domain/loop-guard.js';
export {
  resolveThread,
  stripQuotedReply,
  subjectToken,
  parseReferences,
  outboundSubject,
  outboundMessageId,
  TICKET_HEADER,
  type ThreadMatch,
} from './domain/threading.js';
export { seedChannelDefaults } from './seed/defaults.js';
import './handlers/index.js';
