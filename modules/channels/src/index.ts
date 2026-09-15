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

// ---- MOD-03-E2 chat channels (PH-4) ----------------------------------------
export {
  MAX_SIGNATURE_AGE_SECONDS,
  constantTimeEquals as constantTimeCompareSecrets,
  timingSafeCompare,
  verifyMetaSignature,
  verifySlackSignature,
  verifyTeamsSignature,
  verifyTwilioSignature,
  type VerificationFailure,
  type VerificationResult,
} from './domain/signatures.js';
export { guardChat, type ChatEvent, type ChatGuardOptions, type ChatGuardVerdict } from './domain/chat-guard.js';
export {
  VERIFICATION_METHODS,
  canAutoLink,
  isVerificationMethod,
  permits,
  type IdentityState,
  type PolicyVerdict,
  type VerificationMethod,
} from './domain/identity-policy.js';
export {
  actionPayloadSchema,
  findTicketRef,
  parseAction,
  parseMessage,
  parseSlash,
  stripMention,
  titleFrom,
} from './domain/chat-commands.js';
export {
  chatTransport,
  clearChatTransports,
  registerChatTransport,
  registeredChatTransports,
  type ChatIdentityHint,
  type ChatTransport,
  type OutboundChat,
  type ParsedChat,
} from './service/chat-transport.js';
export { slackTransport, type SlackOptions } from './service/slack.js';
export { teamsTransport, type TeamsOptions } from './service/teams.js';
export { clientCredentialsToken, type TokenRequest } from './service/aad-token.js';
