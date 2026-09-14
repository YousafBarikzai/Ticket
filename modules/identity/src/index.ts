/** MOD-01 Identity, organisations and access — public interface. */
export { identityManifest } from './manifest.js';
export * as userService from './service/user-service.js';
export { loadActor, resolveActor, type ResolvedActor } from './service/permission-service.js';
export { seedSystemRoles, SYSTEM_ROLES } from './seed/roles.js';
