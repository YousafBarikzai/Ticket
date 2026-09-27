/** MOD-14 Integrations, API and developer platform — public interface. */
export { integrationsManifest } from './manifest.js';
export * as outboxPublisher from './service/outbox-publisher.js';
export * as webhookService from './service/webhook-service.js';
export { signPayload, verifySignature } from './service/webhook-service.js';
export * as credentialService from './service/credential-service.js';
export {
  storeCredential,
  rotateCredential,
  listCredentials,
  deleteCredential,
  rewrapCredentials,
  registerCredentialStore,
  credentialSchema,
  type CredentialSummary,
} from './service/credential-service.js';
export * as gateway from './gateway/gateway.js';
export {
  call,
  GatewayRefusedError,
  CircuitOpenError,
  breakers,
  checkDestination,
  refuseAddress,
  redactBody,
  redactHeaders,
  redactUrl,
  type GatewayRequest,
  type GatewayResponse,
  type GatewayDeps,
} from './gateway/gateway.js';
export { CircuitBreakers, type BreakerOptions, type CircuitState } from './gateway/circuit-breaker.js';
export {
  AWS_ALGORITHM,
  EMPTY_PAYLOAD_SHA256,
  amzDate,
  awsCredentialSchema,
  parseAwsCredential,
  signAwsRequest,
  signingKey,
  uriEncode,
  type AwsCredential,
  type SignedParts,
  type SigningSpec,
} from './gateway/sigv4.js';
export * as actionService from './service/action-service.js';
export {
  createAction,
  publishAction,
  listActions,
  runAction,
  mapResponse,
  recordFailure,
  listErrorQueue,
  replayError,
  dismissError,
  actionSchema,
  httpConfigSchema,
  transformConfigSchema,
  type ActionOutcome,
} from './service/action-service.js';
