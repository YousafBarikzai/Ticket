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
